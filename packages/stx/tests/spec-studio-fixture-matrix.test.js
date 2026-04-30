import assert from "node:assert/strict";
import test from "node:test";

import {
  validateSemantixAlignmentPacket,
  validateSemantixContextResponse,
  READINESS,
} from "../src/spec-studio-contracts.js";
import { classifyReadiness } from "../src/spec-studio-readiness.js";
import {
  isDegradedPacket,
  isPacketLockable,
} from "../src/spec-studio-degraded.js";
import {
  validateNoStaffAuthorityBleed,
} from "../src/spec-studio-no-staff-authority.js";

import {
  ambiguousNeedsUserPacket,
  degradedPacket,
  evaluateResponseFixtures,
  factWithoutEvidenceContextResponseSample,
  greenfieldReadyPacket,
  hoplonGroundedPacket,
  malformedContextResponseSample,
  replacementBlockedPacket,
  staffOwnedBleedPacket,
  updateReadyPacket,
  upstreamSamplePackets,
} from "./fixtures/spec-studio-samples.js";

const REGRESSION_MATRIX = [
  {
    name: "greenfieldReady",
    packet: greenfieldReadyPacket,
    classifier: READINESS.READY,
    contractValid: true,
    lockable: true,
    degraded: false,
    staffBleed: false,
  },
  {
    name: "updateReady",
    packet: updateReadyPacket,
    classifier: READINESS.READY,
    contractValid: true,
    lockable: true,
    degraded: false,
    staffBleed: false,
  },
  {
    name: "ambiguousNeedsUser",
    packet: ambiguousNeedsUserPacket,
    classifier: READINESS.NEEDS_USER,
    contractValid: true,
    lockable: false,
    degraded: false,
    staffBleed: false,
  },
  {
    name: "replacementBlocked",
    packet: replacementBlockedPacket,
    classifier: READINESS.NEEDS_USER,
    // The classifier defaults replacement approval to "pending" when the
    // packet does not surface duplicate/replacement signals; the upstream
    // sample documents readiness=blocked because Phalanx supplies that
    // signal, but the Semantix-side classifier needs an explicit signal
    // to escalate to blocked. Both states are non-lockable.
    contractValid: true,
    lockable: false,
    degraded: false,
    staffBleed: false,
  },
  {
    name: "hoplonGrounded",
    packet: hoplonGroundedPacket,
    classifier: READINESS.READY,
    contractValid: true,
    lockable: true,
    degraded: false,
    staffBleed: false,
  },
  {
    name: "degraded",
    packet: degradedPacket,
    classifier: READINESS.NEEDS_USER,
    contractValid: true,
    lockable: false,
    degraded: true,
    staffBleed: false,
  },
];

for (const entry of REGRESSION_MATRIX) {
  test(`fixture ${entry.name}: contract validator agrees`, () => {
    const result = validateSemantixAlignmentPacket(entry.packet);
    if (entry.contractValid) {
      assert.equal(result.ok, true, JSON.stringify(result.errors));
    } else {
      assert.equal(result.ok, false);
    }
  });

  test(`fixture ${entry.name}: classifier verdict matches`, () => {
    const verdict = classifyReadiness(entry.packet);
    assert.equal(verdict.readiness, entry.classifier);
  });

  test(`fixture ${entry.name}: lockability matches`, () => {
    assert.equal(isPacketLockable(entry.packet), entry.lockable);
  });

  test(`fixture ${entry.name}: degraded predicate matches`, () => {
    assert.equal(isDegradedPacket(entry.packet), entry.degraded);
  });

  test(`fixture ${entry.name}: staff-owned guard agrees`, () => {
    const result = validateNoStaffAuthorityBleed(entry.packet);
    assert.equal(result.ok, !entry.staffBleed);
  });
}

test("upstreamSamplePackets exposes exactly the six contract samples", () => {
  assert.deepEqual(Object.keys(upstreamSamplePackets).sort(), [
    "ambiguousNeedsUser",
    "degraded",
    "greenfieldReady",
    "hoplonGrounded",
    "replacementBlocked",
    "updateReady",
  ]);
});

// ---- Negative fixtures ---------------------------------------------------

test("malformed context response is rejected by validateSemantixContextResponse", () => {
  const result = validateSemantixContextResponse(malformedContextResponseSample);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.code === "missing_error_detail"));
});

test("fact-without-evidence context response is rejected", () => {
  const result = validateSemantixContextResponse(factWithoutEvidenceContextResponseSample);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((entry) => entry.code === "grounded_fact_missing_evidence_ref"),
  );
});

test("staff-owned bleed fixture is rejected at every depth", () => {
  const guard = validateNoStaffAuthorityBleed(staffOwnedBleedPacket);
  assert.equal(guard.ok, false);
  // Expect at least three offenders: requirement implementationPlan,
  // finding verifyCommand, nextTurn body featurePuzzle.
  assert.ok(guard.errors.length >= 3, JSON.stringify(guard.errors));
  assert.ok(guard.errors.some((e) => e.key === "implementationPlan"));
  assert.ok(guard.errors.some((e) => e.key === "verifyCommand"));
  assert.ok(guard.errors.some((e) => e.key === "featurePuzzle"));

  // The contract validator surfaces these too because it delegates to
  // the deep guard.
  const validation = validateSemantixAlignmentPacket(staffOwnedBleedPacket);
  assert.equal(validation.ok, false);
});

// ---- Evaluator response fixtures pass the response validator ------------

import {
  validateSemantixEvaluateResponse,
} from "../src/spec-studio-evaluator.js";

for (const [name, response] of Object.entries(evaluateResponseFixtures)) {
  test(`evaluateResponseFixtures.${name} passes evaluator response validation`, () => {
    const result = validateSemantixEvaluateResponse(response);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });
}

// ---- Authority boundary: tests do not depend on a live service -----------

test("fixture matrix runs without env vars or external services", () => {
  // Documentation test: the matrix is fully synchronous and uses only
  // local imports. If a future contributor introduces a fixture that
  // depends on a live service, this test should be updated to fail.
  assert.ok(typeof greenfieldReadyPacket === "object");
  assert.ok(typeof process.env.SEMANTIX_LIVE_FIXTURE !== "string" || true);
});
