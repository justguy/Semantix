import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyVerifierPolicy,
  createConstraintIR,
  createVerifierInput,
  ValidationError,
} from "../src/contracts.js";
import { RuntimeRegistry } from "../src/runtime-registry.js";

const verifierDriftCorpus = JSON.parse(
  readFileSync(new URL("./fixtures/verifier-drift-corpus.json", import.meta.url), "utf8"),
);

const VERIFIER_DRIFT_CLASSES = new Set([
  "provider_output_drift",
  "policy_threshold_drift",
  "missing_evidence_drift",
  "expected_migration_drift",
]);

function withoutUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(withoutUndefined);
  }
  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entryValue]) => entryValue !== undefined)
      .map(([key, entryValue]) => [key, withoutUndefined(entryValue)]),
  );
}

function verifierDecisionSnapshot(result) {
  return withoutUndefined({
    status: result.status,
    policyState: result.policyState,
    riskFlags: result.riskFlags,
    evidence: result.evidence,
  });
}

test("verifier input contract carries contradiction, entailment, groundedness, and similarity checks", () => {
  const constraintIR = createConstraintIR({
    id: "constraint.verifier.evidence",
    sourceRef: "constraint verifier",
    target: {
      kind: "semantic_output",
      nodeId: "node.semantic.generate",
    },
    verifier: {
      mode: "advisory",
      checks: [
        { id: "check.contradiction", kind: "contradiction", threshold: 0.1 },
        { id: "check.entailment", kind: "entailment", threshold: 0.8 },
        { id: "check.groundedness", kind: "groundedness", threshold: 0.85 },
        { id: "check.similarity", kind: "similarity", threshold: 0.75 },
      ],
    },
  });

  const input = createVerifierInput({
    runId: "run-verifier-input",
    node: { id: "node.semantic.generate" },
    constraintIR,
    subject: { summary: "candidate output" },
    reference: { summary: "approved context" },
  });

  assert.equal(input.constraintIrId, constraintIR.id);
  assert.deepEqual(
    input.checks.map((check) => check.kind),
    ["contradiction", "entailment", "groundedness", "similarity"],
  );
  assert.deepEqual(
    input.checks.map((check) => check.comparator),
    ["lte", "gte", "gte", "gte"],
  );
});

test("verifier drift corpus records explicit policy inputs and expected decisions", () => {
  assert.equal(verifierDriftCorpus.schemaVersion, 1);
  assert.equal(verifierDriftCorpus.corpusId, "semantix-verifier-drift-v1");
  assert.ok(verifierDriftCorpus.fixtures.length >= 4);

  const fixtureIds = new Set();
  const coveredDriftClasses = new Set();
  for (const fixture of verifierDriftCorpus.fixtures) {
    assert.equal(fixtureIds.has(fixture.id), false, `${fixture.id} must be unique`);
    fixtureIds.add(fixture.id);
    assert.ok(VERIFIER_DRIFT_CLASSES.has(fixture.driftClass), `${fixture.id} has an unknown drift class`);
    coveredDriftClasses.add(fixture.driftClass);
    assert.match(fixture.migration.id, /^stx-p2-012\./);
    assert.ok(fixture.migration.reason);
    assert.ok(["advisory", "required"].includes(fixture.policy.mode));
    assert.ok(fixture.providerResult);
    assert.ok(Array.isArray(fixture.expected.riskFlags), `${fixture.id} must record expected risk flags`);

    for (const check of fixture.policy.checks) {
      assert.ok(check.kind, `${fixture.id} must record check kind`);
      assert.equal(typeof check.threshold, "number", `${fixture.id} must record threshold`);
      assert.ok(["gte", "lte"].includes(check.comparator), `${fixture.id} must record comparator`);
    }
  }

  assert.ok(coveredDriftClasses.has("provider_output_drift"));
  assert.ok(coveredDriftClasses.has("policy_threshold_drift"));
  assert.ok(coveredDriftClasses.has("missing_evidence_drift"));
});

test("verifier drift corpus locks Semantix policy decisions", async (t) => {
  for (const fixture of verifierDriftCorpus.fixtures) {
    await t.test(fixture.id, () => {
      const result = applyVerifierPolicy({
        policy: fixture.policy,
        providerResult: fixture.providerResult,
      });

      assert.equal(result.enforcement.owner, "policy");
      assert.equal(result.advisory, true);
      assert.deepEqual(verifierDecisionSnapshot(result), fixture.expected);
    });
  }
});

test("verifier unavailable is Semantix policy evidence, not provider authority", () => {
  const result = applyVerifierPolicy({
    policy: {
      mode: "required",
      checks: [{ id: "check.groundedness", kind: "groundedness", failureSeverity: "hard" }],
    },
    providerResult: {
      providerId: "verifier.local",
      status: "unavailable",
      error: "socket closed",
    },
  });

  assert.equal(result.status, "unavailable");
  assert.equal(result.policyState, "block");
  assert.equal(result.enforcement.owner, "policy");
  assert.equal(result.evidence[0].providerStatus, "unavailable");
  assert.equal(result.evidence[0].policyState, "block");
});

test("verifier concern produces review_required according to advisory policy", () => {
  const result = applyVerifierPolicy({
    policy: {
      mode: "advisory",
      checks: [
        {
          id: "check.groundedness",
          kind: "groundedness",
          threshold: 0.9,
          failureSeverity: "soft",
        },
      ],
    },
    providerResult: {
      providerId: "verifier.local",
      status: "available",
      checks: [
        {
          id: "check.groundedness",
          kind: "groundedness",
          score: 0.62,
          advisoryState: "concern",
          message: "The claim is weakly grounded.",
        },
      ],
    },
  });

  assert.equal(result.status, "concern");
  assert.equal(result.policyState, "review_required");
  assert.deepEqual(result.riskFlags, ["verifier_concern"]);
  assert.equal(result.evidence[0].providerAdvisoryState, "concern");
  assert.equal(result.evidence[0].policyState, "review_required");
});

test("provider block advice is downgraded or blocked only by Semantix verifier policy", () => {
  const providerResult = {
    providerId: "verifier.local",
    status: "available",
    policyState: "pass",
    checks: [
      {
        id: "check.contradiction",
        kind: "contradiction",
        score: 0.93,
        advisoryState: "block",
        message: "The answer contradicts the supplied source.",
      },
    ],
  };
  const check = {
    id: "check.contradiction",
    kind: "contradiction",
    threshold: 0.2,
    failureSeverity: "hard",
  };

  const advisory = applyVerifierPolicy({
    policy: {
      mode: "advisory",
      checks: [check],
    },
    providerResult,
  });
  const required = applyVerifierPolicy({
    policy: {
      mode: "required",
      checks: [check],
    },
    providerResult,
  });

  assert.equal(advisory.policyState, "review_required");
  assert.equal(advisory.evidence[0].providerAdvisoryState, "block");
  assert.equal(required.policyState, "block");
  assert.equal(required.evidence[0].providerAdvisoryState, "block");
});

test("verifier provider adapters must expose verifierCall but remain non-runtime providers", async () => {
  const registry = new RuntimeRegistry();

  assert.throws(
    () =>
      registry.registerProviderAdapter({
        id: "verifier.missing-hook",
        providerKind: "verifier",
        async getCapabilities() {
          return {};
        },
        async healthCheck() {
          return { healthy: true };
        },
      }),
    ValidationError,
  );

  const adapter = registry.registerProviderAdapter({
    id: "verifier.local",
    providerKind: "verifier",
    async getCapabilities() {
      return { checks: ["groundedness"] };
    },
    async healthCheck() {
      return { healthy: true };
    },
    async verifierCall(input) {
      return {
        providerId: "verifier.local",
        status: "available",
        checks: input.checks.map((check) => ({
          id: check.id,
          kind: check.kind,
          score: 1,
          advisoryState: "pass",
        })),
      };
    },
  });

  assert.equal(adapter.providerKind, "verifier");
  assert.equal(registry.listRuntimeAdapters().length, 0);
  assert.equal(registry.listProviderAdapters().length, 1);
});
