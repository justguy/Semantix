import assert from "node:assert/strict";
import test from "node:test";

import {
  createDegradedPacket,
  isDegradedPacket,
  isPacketLockable,
  withDegradationFallback,
} from "../src/spec-studio-degraded.js";

import {
  CONTRACT_VERSION,
  EXISTING_SYSTEM_MODE,
  READINESS,
  SOURCE_SEMANTIX,
  validateSemantixAlignmentPacket,
} from "../src/spec-studio-contracts.js";

import {
  greenfieldReadyPacket,
  hoplonGroundedPacket,
} from "./fixtures/spec-studio-samples.js";
import { checkIdContinuity } from "../src/spec-studio-id-continuity.js";

// ---- createDegradedPacket -------------------------------------------------

test("creates a Semantix-source degraded packet that validates", () => {
  const packet = createDegradedPacket({
    sessionId: "spec_session_1",
    iteration: 3,
    originalUserRequest: "Update the run dashboard.",
    reason: "Semantix model unreachable.",
  });

  assert.equal(packet.source, SOURCE_SEMANTIX);
  assert.equal(packet.readiness, READINESS.NEEDS_USER);
  assert.equal(packet.coverage.alignmentPct, 0);
  assert.equal(packet.coverage.openBlockers, 1);
  assert.equal(packet.findings.length, 1);
  assert.equal(packet.findings[0].sev, "blocker");
  assert.equal(packet.requirements.length, 0);
  assert.equal(packet.contractVersion, CONTRACT_VERSION);
  assert.equal(packet.existingSystemContext.mode, EXISTING_SYSTEM_MODE.UNKNOWN);
  assert.equal(packet.nextTurn, null);

  const result = validateSemantixAlignmentPacket(packet);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("does not invent requirement facts during degradation", () => {
  const packet = createDegradedPacket({
    sessionId: "spec_invented",
    iteration: 0,
    originalUserRequest: "anything",
    reason: "model timeout",
  });
  assert.deepEqual(packet.requirements, []);
  assert.deepEqual(packet.assumptions, []);
  assert.deepEqual(packet.openQuestions, []);
  assert.deepEqual(packet.risks, []);
  assert.deepEqual(packet.userDecisions, []);
});

test("uses prior packet original request when none is provided", () => {
  const prior = greenfieldReadyPacket;
  const packet = createDegradedPacket({
    sessionId: "spec_carry",
    iteration: 5,
    reason: "model timeout",
    priorPacket: prior,
  });
  assert.equal(packet.originalUserRequest, prior.originalUserRequest);
  // staleSafe defaults to false → no requirements/scope carryforward
  assert.deepEqual(packet.requirements, []);
  assert.equal(packet.coverage.alignmentPct, 0);
});

test("when staleSafe is set with a prior packet, carries forward prior coverage and requirements", () => {
  const prior = hoplonGroundedPacket;
  const packet = createDegradedPacket({
    sessionId: "spec_stale_safe",
    iteration: prior.iteration + 1,
    reason: "model unavailable; prior packet still trusted by Phalanx",
    priorPacket: prior,
    staleSafe: true,
  });
  // Carry forward
  assert.equal(packet.coverage.alignmentPct, prior.coverage.alignmentPct);
  assert.equal(packet.requirements.length, prior.requirements.length);
  assert.equal(packet.groundedFacts.length, prior.groundedFacts.length);
  // Even staleSafe degraded packets must NOT mark ready
  assert.equal(packet.readiness, READINESS.NEEDS_USER);
  // existingSystemContext is preserved
  assert.equal(
    packet.existingSystemContext.mode,
    prior.existingSystemContext.mode,
  );
});

test("fallback degradation on follow-up preserves prior stable IDs", async () => {
  const prior = hoplonGroundedPacket;
  const evaluate = withDegradationFallback(() => {
    throw new Error("model timeout");
  });
  const response = await evaluate({
    sessionId: prior.sessionId,
    trigger: "user_turn",
    currentPacket: prior,
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.equal(response.packet.readiness, READINESS.NEEDS_USER);
  assert.equal(response.packet.requirements.length, prior.requirements.length);
  assert.equal(response.packet.groundedFacts.length, prior.groundedFacts.length);
  for (const finding of prior.findings) {
    assert.ok(
      response.packet.findings.some((nextFinding) => nextFinding.id === finding.id),
      `missing prior finding ${finding.id}`,
    );
  }
  const continuity = checkIdContinuity({ priorPacket: prior, nextPacket: response.packet });
  assert.equal(continuity.ok, true, JSON.stringify(continuity.violations));
});

test("validates as a degraded packet via the contract validator", () => {
  const packet = createDegradedPacket({
    sessionId: "spec_validate",
    iteration: 1,
    reason: "model unavailable",
  });
  const result = validateSemantixAlignmentPacket(packet);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("requires sessionId and reason", () => {
  assert.throws(
    () => createDegradedPacket({ sessionId: "", reason: "x" }),
    (error) => error.name === "ValidationError",
  );
  assert.throws(
    () => createDegradedPacket({ sessionId: "s", reason: "" }),
    (error) => error.name === "ValidationError",
  );
});

// ---- isPacketLockable -----------------------------------------------------

test("isPacketLockable returns true for fully aligned upstream samples", () => {
  assert.equal(isPacketLockable(greenfieldReadyPacket), true);
  assert.equal(isPacketLockable(hoplonGroundedPacket), true);
});

test("isPacketLockable returns false for degraded packets", () => {
  const packet = createDegradedPacket({
    sessionId: "spec_a",
    iteration: 0,
    reason: "x",
  });
  assert.equal(isPacketLockable(packet), false);
});

test("isPacketLockable returns false when readiness is needs_user even at 100%", () => {
  const packet = { ...greenfieldReadyPacket, readiness: READINESS.NEEDS_USER };
  assert.equal(isPacketLockable(packet), false);
});

test("isPacketLockable returns false when source is phalanx-degraded", () => {
  const packet = { ...greenfieldReadyPacket, source: "phalanx-degraded" };
  assert.equal(isPacketLockable(packet), false);
});

test("isPacketLockable returns false when there is an unresolved blocker finding", () => {
  const packet = {
    ...greenfieldReadyPacket,
    findings: [
      {
        id: "F-X",
        kind: "risk",
        sev: "blocker",
        section: "intent",
        ref: "x",
        text: "open",
        resolved: false,
        raisedBy: "semantix",
      },
    ],
  };
  assert.equal(isPacketLockable(packet), false);
});

// ---- isDegradedPacket -----------------------------------------------------

test("isDegradedPacket recognises Semantix-built degraded packets", () => {
  const packet = createDegradedPacket({
    sessionId: "spec_a",
    iteration: 0,
    reason: "x",
  });
  assert.equal(isDegradedPacket(packet), true);
});

test("isDegradedPacket recognises phalanx-degraded envelopes", () => {
  assert.equal(
    isDegradedPacket({ ...greenfieldReadyPacket, source: "phalanx-degraded" }),
    true,
  );
});

test("isDegradedPacket returns false for healthy ready packets", () => {
  assert.equal(isDegradedPacket(greenfieldReadyPacket), false);
});

// ---- withDegradationFallback ---------------------------------------------

test("returns the impl response when nothing is wrong", async () => {
  const impl = (_request) => ({
    packet: greenfieldReadyPacket,
    events: [{ id: "evt", kind: "ok" }],
    contextRequests: [],
  });
  const evaluate = withDegradationFallback(impl);
  const response = await evaluate({
    sessionId: "s",
    trigger: "initial",
    decisions: [],
    findings: [],
    contextResponses: [],
  });
  assert.equal(response.packet.readiness, "ready");
});

test("degrades honestly when the impl throws", async () => {
  const evaluate = withDegradationFallback(() => {
    throw new Error("model timeout");
  });
  const response = await evaluate({
    sessionId: "spec_failure",
    trigger: "initial",
    decisions: [],
    findings: [],
    contextResponses: [],
  });
  assert.equal(response.packet.readiness, READINESS.NEEDS_USER);
  assert.equal(response.packet.coverage.alignmentPct, 0);
  assert.ok(response.events.some((event) => event.kind === "evaluator.degraded"));
  assert.equal(isPacketLockable(response.packet), false);
});

test("degrades honestly when the impl returns a malformed response", async () => {
  const evaluate = withDegradationFallback(() => ({}));
  const response = await evaluate({
    sessionId: "spec_malformed",
    trigger: "initial",
    decisions: [],
    findings: [],
    contextResponses: [],
  });
  assert.equal(response.packet.readiness, READINESS.NEEDS_USER);
  assert.equal(isPacketLockable(response.packet), false);
});

test("demotes a 'ready' packet whose coverage or findings disagree", async () => {
  const dishonestPacket = {
    ...greenfieldReadyPacket,
    readiness: "ready",
    coverage: { ...greenfieldReadyPacket.coverage, alignmentPct: 70 },
  };
  const evaluate = withDegradationFallback(() => ({
    packet: dishonestPacket,
    events: [],
    contextRequests: [],
  }));
  const response = await evaluate({
    sessionId: "spec_demote",
    trigger: "initial",
    decisions: [],
    findings: [],
    contextResponses: [],
  });
  assert.equal(response.packet.readiness, READINESS.NEEDS_USER);
  assert.ok(
    response.events.some((event) => event.kind === "evaluator.degraded.demoted"),
  );
});

test("requires an evaluator function", () => {
  assert.throws(
    () => withDegradationFallback(null),
    (error) => error.name === "ValidationError",
  );
});

test("never marks a degraded packet ready, even when wrapping a misbehaved impl", async () => {
  const evaluate = withDegradationFallback(() => {
    throw new Error("anything");
  });
  for (const trigger of ["initial", "user_turn", "reconsider", "context_response"]) {
    const response = await evaluate({
      sessionId: "spec_no_ready",
      trigger,
      currentPacket: trigger === "initial" ? undefined : greenfieldReadyPacket,
      decisions: [],
      findings: [],
      contextResponses: [],
    });
    assert.notEqual(response.packet.readiness, READINESS.READY);
  }
});
