import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_PLANNING_HANDOFF_COMPILER_PROFILE,
  PLANNING_HANDOFF_COMPILER_PROFILES,
  PLANNING_HANDOFF_CONTRACT_VERSION,
  PLANNING_HANDOFF_DEFAULT_COMPILER_PROFILE_ID,
  SUPPORTED_PACKET_CONTRACT_VERSIONS_V1,
  assertPlanningHandoff,
  buildPlanningHandoff,
  canonicalizePlanningHandoff,
  classifyFreshnessGateResult,
  fingerprintPlanningHandoff,
  validatePlanningHandoff,
} from "../src/spec-studio-planning-handoff.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "fixtures", "spec-studio-planning-handoff");

function loadJson(name) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function minimalInput() {
  return {
    packet: loadJson("greenfield-minimal.packet.json"),
    lockedArtifact: loadJson("greenfield-minimal.locked-artifact.json"),
    auditState: loadJson("greenfield-minimal.audit-state.json"),
  };
}

function updateInput() {
  return {
    packet: loadJson("update-minimal.packet.json"),
    lockedArtifact: loadJson("update-minimal.locked-artifact.json"),
    auditState: loadJson("update-minimal.audit-state.json"),
  };
}

function expectBuildErrorCode(input, code) {
  assert.throws(
    () => buildPlanningHandoff(input),
    (error) => {
      const codes = error.details?.errors?.map((entry) => entry.code) ?? [];
      assert.ok(
        codes.includes(code),
        `expected ${code} in ${JSON.stringify(codes)}`,
      );
      return true;
    },
  );
}

test("v1 constants and default compiler profile are frozen", () => {
  assert.equal(PLANNING_HANDOFF_CONTRACT_VERSION, "semantix.planning-handoff.v1");
  assert.equal(
    PLANNING_HANDOFF_DEFAULT_COMPILER_PROFILE_ID,
    "semantix.planning-handoff.v1.profile.1",
  );
  assert.deepEqual(DEFAULT_PLANNING_HANDOFF_COMPILER_PROFILE, {
    id: "semantix.planning-handoff.v1.profile.1",
    contractVersion: "semantix.planning-handoff.v1",
    mapperVersion: "semantix.planning-handoff.mapper.v1",
    validatorVersion: "semantix.planning-handoff.validator.v1",
    canonicalizationVersion: "semantix.canonical-json.v1",
  });
  assert.deepEqual([...SUPPORTED_PACKET_CONTRACT_VERSIONS_V1], [
    "semantix.phalanx.spec-studio.v1",
  ]);
  assert.equal(Object.isFrozen(DEFAULT_PLANNING_HANDOFF_COMPILER_PROFILE), true);
  assert.equal(Object.isFrozen(PLANNING_HANDOFF_COMPILER_PROFILES), true);
  assert.equal(Object.isFrozen(SUPPORTED_PACKET_CONTRACT_VERSIONS_V1), true);
});

test("minimal greenfield locked packet builds a valid planner handoff", () => {
  const handoff = buildPlanningHandoff(minimalInput());

  assert.equal(handoff.contractVersion, PLANNING_HANDOFF_CONTRACT_VERSION);
  assert.match(handoff.handoffId, /^handoff:[0-9a-f]{64}$/);
  assert.match(handoff.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.equal(handoff.lockedArtifactId, "locked_artifact:lia-greenfield-minimal");
  assert.equal(handoff.sourcePacket.sessionId, "spec_greenfield_minimal");
  assert.equal(handoff.sourcePacket.contentHash, handoff.inputHashes.packet.value);
  assert.equal(handoff.mode, "new");

  assert.equal(handoff.requirements.length, 1);
  assert.equal(handoff.requirements[0].id, "requirement:req-hero-actions");
  assert.equal(handoff.acceptanceCriteria.length, 1);
  assert.equal(handoff.assumptions.length, 1);
  assert.equal(handoff.evidence.length, 1);
  assert.equal(handoff.provenanceRecords.length, 2);
  assert.equal(handoff.capabilityScopes.length, 1);
  assert.equal(handoff.decisionAudit.length, 2);
  assert.equal(handoff.freshnessGate.evidenceRefs.length, 1);
  assert.equal(handoff.plannerInputs.featureChecklistSeeds.length, 1);
  assert.equal(handoff.verificationObligations.length, 2);
  assert.deepEqual(
    handoff.plannerInputs.featureChecklistSeeds[0].verificationObligationRefs,
    [
      "verification_obligation:acceptance:req-hero-actions:acceptance",
      "verification_obligation:requirement:req-hero-actions",
    ],
  );

  const validation = validatePlanningHandoff(handoff);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.doesNotThrow(() => assertPlanningHandoff(handoff));
  assert.equal(fingerprintPlanningHandoff(handoff), handoff.fingerprint);
});

test("minimal update locked packet preserves target surfaces and safety obligations", () => {
  const handoff = buildPlanningHandoff(updateInput());

  assert.equal(handoff.mode, "update");
  assert.deepEqual(handoff.targetSurfaces.map((surface) => surface.id), [
    "target_surface:surface-storefront-hero",
  ]);
  assert.deepEqual(handoff.requirements.map((requirement) => requirement.id), [
    "requirement:req-refresh-hero-copy",
  ]);
  assert.deepEqual(
    handoff.negativeRequirements.map((requirement) => requirement.id),
    ["negative_requirement:req-no-public-publish"],
  );

  const requirementObligation = handoff.verificationObligations.find(
    (obligation) => obligation.id === "verification_obligation:requirement:req-refresh-hero-copy",
  );
  const acceptanceObligation = handoff.verificationObligations.find(
    (obligation) =>
      obligation.id ===
      "verification_obligation:acceptance:req-refresh-hero-copy:acceptance",
  );
  const negativeObligation = handoff.verificationObligations.find(
    (obligation) => obligation.id === "verification_obligation:negative:req-no-public-publish",
  );
  const doNotChangeObligation = handoff.verificationObligations.find(
    (obligation) => obligation.id === "verification_obligation:do_not_change:boundary-checkout-unchanged",
  );
  const compatibilityObligation = handoff.verificationObligations.find(
    (obligation) =>
      obligation.id === "verification_obligation:compatibility:boundary-existing-css-contract",
  );

  assert.equal(handoff.verificationObligations.length, 5);
  assert.equal(requirementObligation.kind, "requirement");
  assert.equal(acceptanceObligation.kind, "acceptance");
  assert.equal(negativeObligation.kind, "negative");
  assert.equal(doNotChangeObligation.kind, "do_not_change");
  assert.equal(compatibilityObligation.kind, "compatibility");

  assert.deepEqual(negativeObligation.sourceRefs, [
    "negative_requirement:req-no-public-publish",
  ]);
  assert.deepEqual(negativeObligation.relatedRequirementRefs, [
    "requirement:req-refresh-hero-copy",
  ]);
  assert.deepEqual(negativeObligation.relatedObligationRefs, [
    requirementObligation.id,
  ]);

  for (const obligation of [doNotChangeObligation, compatibilityObligation]) {
    assert.deepEqual(obligation.relatedRequirementRefs, [
      "requirement:req-refresh-hero-copy",
    ]);
    assert.deepEqual(obligation.relatedObligationRefs, [
      requirementObligation.id,
    ]);
  }

  assert.deepEqual(
    requirementObligation.relatedObligationRefs,
    [
      acceptanceObligation.id,
      compatibilityObligation.id,
      doNotChangeObligation.id,
      negativeObligation.id,
    ].sort(),
  );
  assert.deepEqual(handoff.plannerInputs.doNotChangeBoundaryRefs, [
    "boundary:boundary-checkout-unchanged",
  ]);
  assert.deepEqual(handoff.plannerInputs.compatibilityBoundaryRefs, [
    "boundary:boundary-existing-css-contract",
  ]);

  const validation = validatePlanningHandoff(handoff);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("identical inputs produce byte-identical canonical JSON and fingerprint", () => {
  const first = buildPlanningHandoff(minimalInput());
  const second = buildPlanningHandoff(minimalInput());

  assert.equal(canonicalizePlanningHandoff(first), canonicalizePlanningHandoff(second));
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(first.handoffId, second.handoffId);
  assert.deepEqual(first.inputHashes, second.inputHashes);
});

test("omitted and explicit default compiler profile normalize to the same buildInput hash", () => {
  const omitted = buildPlanningHandoff(minimalInput());
  const explicit = buildPlanningHandoff({
    ...minimalInput(),
    compilerProfileId: PLANNING_HANDOFF_DEFAULT_COMPILER_PROFILE_ID,
  });

  assert.equal(
    omitted.inputHashes.buildInput.value,
    explicit.inputHashes.buildInput.value,
  );
  assert.equal(canonicalizePlanningHandoff(omitted), canonicalizePlanningHandoff(explicit));
});

test("reordered packet and audit arrays do not change canonical handoff bytes", () => {
  const baseInput = minimalInput();
  const reordered = deepClone(baseInput);
  reordered.packet.requirements = [...reordered.packet.requirements].reverse();
  reordered.packet.findings = [...reordered.packet.findings].reverse();
  reordered.auditState.decisions = [...reordered.auditState.decisions].reverse();
  reordered.auditState.provenanceRecords = [
    ...reordered.auditState.provenanceRecords,
  ].reverse();
  reordered.auditState.sensitivityClassifications = [
    ...reordered.auditState.sensitivityClassifications,
  ].reverse();

  assert.equal(
    canonicalizePlanningHandoff(buildPlanningHandoff(baseInput)),
    canonicalizePlanningHandoff(buildPlanningHandoff(reordered)),
  );
});

test("unsafe or unsupported inputs fail closed with stable error codes", () => {
  const missingAcceptance = minimalInput();
  delete missingAcceptance.packet.requirements[0].acceptance;
  expectBuildErrorCode(missingAcceptance, "must_requirement_missing_acceptance");

  const unresolvedBlocker = minimalInput();
  unresolvedBlocker.packet.findings.push({
    id: "finding:blocker-open",
    kind: "gap",
    raisedBy: "semantix",
    ref: "req-hero-actions",
    resolved: false,
    section: "scope",
    sev: "blocker",
    text: "Button destination is still unresolved.",
  });
  expectBuildErrorCode(unresolvedBlocker, "unresolved_blocker");

  const degraded = minimalInput();
  degraded.packet.source = "phalanx-degraded";
  expectBuildErrorCode(degraded, "packet_source_not_semantix");

  const unsupportedPacket = minimalInput();
  unsupportedPacket.packet.contractVersion = "semantix.phalanx.spec-studio.v2";
  expectBuildErrorCode(unsupportedPacket, "unsupported_packet_contract_version");

  const unsupportedProfile = {
    ...minimalInput(),
    compilerProfileId: "semantix.planning-handoff.v1.profile.999",
  };
  expectBuildErrorCode(unsupportedProfile, "unsupported_compiler_profile");

  const updateWithoutTargets = updateInput();
  updateWithoutTargets.packet.existingSystemContext.targetSurfaces = [];
  expectBuildErrorCode(updateWithoutTargets, "update_target_surfaces_missing");

  const updateWithoutBoundaries = updateInput();
  updateWithoutBoundaries.packet.existingSystemContext.doNotChange = [];
  updateWithoutBoundaries.packet.existingSystemContext.compatibilityRequirements = [];
  expectBuildErrorCode(updateWithoutBoundaries, "update_boundaries_missing");
});

test("missing audit authority fields fail closed", () => {
  const noDecisionAudit = minimalInput();
  noDecisionAudit.auditState.decisions = [];
  expectBuildErrorCode(noDecisionAudit, "decision_audit_missing");

  const noGovernance = minimalInput();
  delete noGovernance.auditState.governance;
  expectBuildErrorCode(noGovernance, "governance_missing");

  const noDataPolicy = minimalInput();
  delete noDataPolicy.auditState.dataPolicy;
  expectBuildErrorCode(noDataPolicy, "data_policy_missing");

  const noCapabilityScope = minimalInput();
  noCapabilityScope.auditState.capabilityScopes = [];
  expectBuildErrorCode(noCapabilityScope, "capability_scopes_missing");
});

test("locked artifact must bind the packet hash, identity, and governing lock decision", () => {
  const cases = [
    [(input) => delete input.lockedArtifact.packetContentHash, "locked_artifact_packet_hash_missing"],
    [(input) => { input.lockedArtifact.packetContentHash = `sha256:${"0".repeat(64)}`; }, "locked_artifact_packet_hash_mismatch"],
    [(input) => { input.lockedArtifact.sessionId = "another-session"; }, "lock_packet_identity_mismatch"],
    [(input) => { input.lockedArtifact.packetRef = "packet:another-session:9"; }, "lock_packet_identity_mismatch"],
    [(input) => { input.auditState.lockMetadata.sourcePacket.iteration += 1; }, "lock_packet_identity_mismatch"],
    [(input) => { input.lockedArtifact.lockDecisionRef = "decision:unrelated"; }, "lock_decision_identity_mismatch"],
    [(input) => { input.lockedArtifact.lockedByActorRef = "actor:unrelated"; }, "lock_decision_identity_mismatch"],
  ];
  for (const [mutate, code] of cases) {
    const input = minimalInput();
    mutate(input);
    expectBuildErrorCode(input, code);
  }
});

test("handoff rejects secret and unauthorized sensitive persistence", () => {
  for (const classification of ["secret", "unknown", "confidential", "pii", "regulated"]) {
    const input = minimalInput();
    input.auditState.sensitivityClassifications.find(
      (entry) => entry.fieldRef === "/packet/originalUserRequest",
    ).sensitivity.classification = classification;
    expectBuildErrorCode(input, classification === "secret"
      ? "secret_persistence_forbidden"
      : "sensitive_persistence_unauthorized");
  }
  const input = minimalInput();
  input.auditState.evidence[0].sensitivity.classification = "secret";
  expectBuildErrorCode(input, "secret_persistence_forbidden");
});

test("standalone validation enforces governance, data policy, and evidence coverage", () => {
  for (const [field, code] of [["governance", "governance_missing"], ["dataPolicy", "data_policy_missing"]]) {
    const handoff = buildPlanningHandoff(minimalInput());
    delete handoff[field];
    handoff.fingerprint = fingerprintPlanningHandoff(handoff);
    const result = validatePlanningHandoff(handoff);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === code));
  }
  const input = minimalInput();
  input.auditState.freshnessGate.evidenceRefs = [];
  expectBuildErrorCode(input, "freshness_gate_evidence_missing");
});

test("standalone validation reports malformed collections without throwing", () => {
  for (const requirements of [{}, [null], ["requirement"]]) {
    const handoff = buildPlanningHandoff(minimalInput());
    handoff.requirements = requirements;
    assert.equal(validatePlanningHandoff(handoff).ok, false);
  }
});

test("freshness classification is pure and deterministic", () => {
  const handoff = buildPlanningHandoff(minimalInput());
  const evidenceRef = "evidence:ev-user-answers";

  const clean = classifyFreshnessGateResult(handoff, {
    handoffId: handoff.handoffId,
    checkedAt: "2026-05-17T16:05:00.000Z",
    observations: [
      {
        evidenceRef,
        observedFreshness: {
          kind: "external_timestamp",
          value: "2026-05-17T16:00:00.000Z",
        },
        sourceIdentity: "verified",
        lockedEvidence: "resolvable",
      },
    ],
  });
  assert.equal(clean.state, "clean_resume");
  assert.equal(clean.evidenceResults[0].reason, "exact_match");

  const soft = classifyFreshnessGateResult(handoff, {
    handoffId: handoff.handoffId,
    checkedAt: "2026-05-17T16:05:00.000Z",
    observations: [
      {
        evidenceRef,
        observedFreshness: {
          kind: "external_timestamp",
          value: "2026-05-17T16:01:00.000Z",
        },
        sourceIdentity: "verified",
        lockedEvidence: "resolvable",
      },
    ],
  });
  assert.equal(soft.state, "soft_stale");

  const hard = classifyFreshnessGateResult(handoff, {
    handoffId: handoff.handoffId,
    checkedAt: "2026-05-17T16:05:00.000Z",
    observations: [
      {
        evidenceRef,
        observedFreshness: {
          kind: "external_timestamp",
          value: "2026-05-17T16:00:00.000Z",
        },
        sourceIdentity: "changed",
        lockedEvidence: "resolvable",
      },
    ],
  });
  assert.equal(hard.state, "hard_stale");
  assert.equal(hard.evidenceResults[0].reason, "source_identity_unverified");

  assert.deepEqual(
    classifyFreshnessGateResult(handoff, {
      handoffId: handoff.handoffId,
      checkedAt: "2026-05-17T16:05:00.000Z",
      observations: clean.evidenceResults.map((result) => ({
        evidenceRef: result.evidenceRef,
        observedFreshness: result.observedFreshness,
        sourceIdentity: "verified",
        lockedEvidence: "resolvable",
      })),
    }),
    clean,
  );
});

test("builder import guard excludes LLM, IO, server, clock, and random dependencies", () => {
  const source = readFileSync(
    join(__dirname, "..", "src", "spec-studio-planning-handoff.js"),
    "utf8",
  );

  assert.doesNotMatch(source, /node:fs|node:net|node:http|node:https|node:child_process/);
  assert.doesNotMatch(source, /fetch\s*\(|XMLHttpRequest|WebSocket/);
  assert.doesNotMatch(source, /Date\.now|new Date|Math\.random|randomUUID/);
  assert.doesNotMatch(source, /spec-studio-llm|http\/server|file-run-store|repo-reader/);
});
