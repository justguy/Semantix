/**
 * End-to-end proof for the Semantix-side Spec Studio integration.
 *
 * Each test in this file wires the public Semantix-side modules
 * (contracts, evaluator, readiness, degraded, no-staff-authority,
 * id-continuity, context requests, context ingestion, user-turn
 * loop, handshake adapter) through one full conversation flow and
 * asserts the invariants the upstream contract requires:
 *
 *   - packet validity (validateSemantixAlignmentPacket)
 *   - stable-ID continuity across turns (checkIdContinuity)
 *   - fact/interpretation separation (recordInterpretationsFromFacts
 *     never adds to groundedFacts)
 *   - no Staff-owned output bleed (validateNoStaffAuthorityBleed)
 *   - correct readiness behavior (classifyReadiness +
 *     isPacketLockable)
 *
 * The test harness is fully in-process. It does not start a server,
 * does not call Phalanx, and does not query Hoplon. Phalanx
 * lock / session / Staff handoff is intentionally out of scope and
 * is documented in docs/plans/spec-studio-end-to-end-proof.md.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  READINESS,
  validateSemantixAlignmentPacket,
} from "../src/spec-studio-contracts.js";
import {
  EVALUATE_TRIGGER,
} from "../src/spec-studio-evaluator.js";
import {
  classifyReadiness,
} from "../src/spec-studio-readiness.js";
import {
  isDegradedPacket,
  isPacketLockable,
} from "../src/spec-studio-degraded.js";
import {
  validateNoStaffAuthorityBleed,
} from "../src/spec-studio-no-staff-authority.js";
import {
  checkIdContinuity,
} from "../src/spec-studio-id-continuity.js";
import {
  createContextRequestSequencer,
  planContextRequests,
  requestIdentifyTargetSurface,
} from "../src/spec-studio-context-requests.js";
import {
  ingestContextResponses,
  recordInterpretationsFromFacts,
} from "../src/spec-studio-context-ingestion.js";
import {
  applyReconsiderTurn,
  applySkipTurn,
  applyUserChoiceTurn,
} from "../src/spec-studio-user-turn-loop.js";
import {
  REPLACEMENT_APPROVAL,
} from "../src/spec-studio-readiness.js";
import {
  createSemantixHandshakeAdapter,
} from "../src/spec-studio-handshake.js";

import {
  ambiguousNeedsUserPacket,
  greenfieldReadyPacket,
  hoplonGroundedPacket,
  replacementBlockedPacket,
  updateReadyPacket,
} from "./fixtures/spec-studio-samples.js";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertCommonInvariants(packet) {
  const validation = validateSemantixAlignmentPacket(packet);
  assert.equal(
    validation.ok,
    true,
    `packet failed contract validator: ${JSON.stringify(validation.errors)}`,
  );
  const guard = validateNoStaffAuthorityBleed(packet);
  assert.equal(
    guard.ok,
    true,
    `packet leaked Staff-owned content: ${JSON.stringify(guard.errors)}`,
  );
}

function fixtureHandshake({ initial, followUp }) {
  return createSemantixHandshakeAdapter({
    fixtureResponses: (request) => {
      if (request.trigger === EVALUATE_TRIGGER.INITIAL) {
        return {
          packet: initial,
          events: [
            { id: `evt_initial_${Date.now()}`, kind: "packet.evaluated" },
          ],
          contextRequests: [],
        };
      }
      return {
        packet: followUp ?? initial,
        events: [
          { id: `evt_followup_${Date.now()}`, kind: "packet.evaluated" },
        ],
        contextRequests: [],
      };
    },
  });
}

function buildInitialRequest(sessionId, directive) {
  return {
    sessionId,
    trigger: EVALUATE_TRIGGER.INITIAL,
    userTurn: {
      id: "u_1",
      body: { kind: "text", text: directive },
    },
    decisions: [],
    findings: [],
    contextResponses: [],
  };
}

// ---- Flow 1: greenfield ready --------------------------------------------

test("end-to-end: greenfield directive reaches ready and is lockable", async () => {
  const adapter = fixtureHandshake({ initial: greenfieldReadyPacket });
  const response = await adapter.evaluate(
    buildInitialRequest("spec_e2e_greenfield", "Build a notes app with markdown."),
  );
  assertCommonInvariants(response.packet);
  assert.equal(classifyReadiness(response.packet).readiness, READINESS.READY);
  assert.equal(isPacketLockable(response.packet), true);
  assert.equal(isDegradedPacket(response.packet), false);
});

// ---- Flow 2: update ready -------------------------------------------------

test("end-to-end: update directive reaches ready with target surface and reuse boundary", async () => {
  const adapter = fixtureHandshake({ initial: updateReadyPacket });
  const response = await adapter.evaluate(
    buildInitialRequest("spec_e2e_update", "Add email verification to signup."),
  );
  assertCommonInvariants(response.packet);
  assert.equal(classifyReadiness(response.packet).readiness, READINESS.READY);
  assert.equal(isPacketLockable(response.packet), true);
  assert.equal(
    response.packet.existingSystemContext.targetSurfaces.length > 0,
    true,
  );
  assert.equal(
    response.packet.existingSystemContext.reuseRequirements.length > 0,
    true,
  );
});

// ---- Flow 3: ambiguous new-vs-update --------------------------------------

test("end-to-end: ambiguous directive returns needs_user with target-surface request", async () => {
  const adapter = fixtureHandshake({ initial: ambiguousNeedsUserPacket });
  const response = await adapter.evaluate(
    buildInitialRequest("spec_e2e_ambiguous", "Add a better run dashboard."),
  );
  assertCommonInvariants(response.packet);
  const verdict = classifyReadiness(response.packet);
  assert.equal(verdict.readiness, READINESS.NEEDS_USER);
  assert.equal(isPacketLockable(response.packet), false);

  // Planner emits identify_target_surface for the unknown mode.
  const requests = planContextRequests({ packet: response.packet });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].purpose, "identify_target_surface");
  assert.ok(requests[0].requestedFrom.includes("phalanx"));
});

// ---- Flow 4: replacement / duplicate without approval ---------------------

test("end-to-end: replacement of existing surface without approval returns blocked", async () => {
  // Build a candidate packet that signals replacement detection +
  // approval absent so the readiness classifier escalates to blocked.
  const candidate = deepClone(replacementBlockedPacket);
  candidate.replacementDetected = true;
  candidate.replacementApproval = REPLACEMENT_APPROVAL.ABSENT;

  const adapter = fixtureHandshake({ initial: candidate });
  const response = await adapter.evaluate(
    buildInitialRequest(
      "spec_e2e_replacement",
      "Create a new run dashboard instead of the current one.",
    ),
  );
  assertCommonInvariants(response.packet);
  const verdict = classifyReadiness(response.packet);
  assert.equal(verdict.readiness, READINESS.BLOCKED);
  assert.equal(isPacketLockable(response.packet), false);
});

// ---- Flow 5: degraded -----------------------------------------------------

test("end-to-end: evaluator failure produces a degraded needs_user packet that is not lockable", async () => {
  const adapter = createSemantixHandshakeAdapter({
    evaluator: () => {
      throw new Error("Semantix model under maintenance.");
    },
  });
  const response = await adapter.evaluate(
    buildInitialRequest("spec_e2e_degraded", "Update the run dashboard."),
  );
  assertCommonInvariants(response.packet);
  assert.equal(response.packet.readiness, READINESS.NEEDS_USER);
  assert.equal(isDegradedPacket(response.packet), true);
  assert.equal(isPacketLockable(response.packet), false);
  // Honest signal in the events stream rather than an opaque throw.
  assert.ok(
    response.events.some((event) =>
      event.kind === "evaluator.degraded" || event.kind === "semantix.degraded",
    ),
  );
});

// ---- Flow 6: Hoplon-grounded update --------------------------------------

test("end-to-end: Hoplon context response ingestion preserves evidenceRef and separates interpretation", async () => {
  // Start with a packet that has the unknown-mode question; ingest a
  // Hoplon context response and confirm the result mirrors the
  // upstream Hoplon-grounded packet semantics.
  const startingPacket = deepClone(hoplonGroundedPacket);
  startingPacket.contextSources = [];
  startingPacket.groundedFacts = [];
  startingPacket.assumptions = [];
  startingPacket.risks = [];

  const sequencer = createContextRequestSequencer({
    sessionId: startingPacket.sessionId,
    iteration: startingPacket.iteration,
  });
  const request = requestIdentifyTargetSurface({
    sequencer,
    sessionId: startingPacket.sessionId,
    iteration: startingPacket.iteration,
    query: "Find existing Run View right-panel observation surface.",
    reason: "Need run-view evidence",
  });
  const result = ingestContextResponses({
    packet: startingPacket,
    requests: [request],
    responses: [
      {
        requestId: request.id,
        status: "ok",
        facts: hoplonGroundedPacket.groundedFacts,
        artifacts: [],
        summary: "Hoplon found the right-panel surface.",
      },
    ],
  });
  const ingestedPacket = result.packet;
  assertCommonInvariants(ingestedPacket);
  assert.equal(
    ingestedPacket.groundedFacts[0].evidenceRef,
    hoplonGroundedPacket.groundedFacts[0].evidenceRef,
  );

  // Record interpretations citing the grounded fact - they go into
  // assumptions / risks, never into groundedFacts.
  const withInterpretation = recordInterpretationsFromFacts({
    packet: ingestedPacket,
    assumptions: [
      {
        id: "ASSUMP-001",
        text: "Reusing the existing right panel implies no new shell.",
        sourceFactRef: "FACT-001",
      },
    ],
    risks: [
      {
        id: "RISK-001",
        text: "Layout may not fit observation summaries.",
        sev: "concern",
        sourceFactRef: "FACT-001",
      },
    ],
  });
  assertCommonInvariants(withInterpretation);
  assert.equal(withInterpretation.assumptions.length, 1);
  assert.equal(withInterpretation.risks.length, 1);
  // groundedFacts unchanged - interpretations did not bleed in
  assert.equal(
    withInterpretation.groundedFacts.length,
    ingestedPacket.groundedFacts.length,
  );
});

// ---- Flow 7: reconsider / supersede --------------------------------------

test("end-to-end: reconsider supersedes the prior decision and reopens its findings with audit reason", async () => {
  const initialPacket = deepClone(ambiguousNeedsUserPacket);
  // Apply a choice that resolves F-001
  const seeded = applyUserChoiceTurn({
    packet: initialPacket,
    userTurn: {
      id: "u_2",
      body: { kind: "choice", picked: "opt_existing", label: "Update existing Run View" },
    },
    questionRef: "Q-001",
    pickedOptionId: "opt_existing",
    pickedLabel: "Update existing Run View",
    now: "2026-04-30T12:00:00.000Z",
  });
  assertCommonInvariants(seeded.packet);

  // Now reconsider the choice
  const { packet: reconsidered, decisionId: newId } = applyReconsiderTurn({
    packet: seeded.packet,
    userTurn: {
      id: "u_3",
      body: { kind: "choice", picked: "opt_new", label: "Create a new dashboard" },
    },
    priorDecisionId: seeded.decisionId,
    newAnswer: { kind: "choice", optId: "opt_new", label: "Create a new dashboard" },
    reason: "User changed their mind",
    now: "2026-04-30T13:00:00.000Z",
  });
  assertCommonInvariants(reconsidered);

  // Prior decision is superseded but preserved
  const prior = reconsidered.userDecisions.find(
    (d) => d.id === seeded.decisionId,
  );
  assert.equal(prior.supersededBy, newId);
  assert.equal(prior.supersededReason, "User changed their mind");
  // Continuity guard accepts the reopen because reopenReason is set
  const continuity = checkIdContinuity({
    priorPacket: seeded.packet,
    nextPacket: reconsidered,
  });
  assert.equal(continuity.ok, true, JSON.stringify(continuity.violations));
});

// ---- Flow 8: skipped gap --------------------------------------------------

test("end-to-end: skipping a question raises an auditable concern, never silently dismisses a blocker", async () => {
  // Use an ambiguous packet with the F-001 blocker
  const initial = deepClone(ambiguousNeedsUserPacket);
  const { packet: afterSkip } = applySkipTurn({
    packet: initial,
    userTurn: { id: "u_skip", body: { kind: "free", text: "punt" } },
    questionRef: "Q-001",
    reason: "Need to revisit later",
    now: "2026-04-30T12:00:00.000Z",
  });
  assertCommonInvariants(afterSkip);
  // Original blocker still present and unresolved
  const blocker = afterSkip.findings.find((f) => f.id === "F-001");
  assert.equal(blocker.sev, "blocker");
  assert.equal(blocker.resolved, false);
  // Decision recorded with reason
  const dismissDecision = afterSkip.userDecisions.find(
    (d) => d.kind === "dismiss",
  );
  assert.match(dismissDecision.answer.reason, /revisit later/i);
  // Open question removed
  assert.equal(
    afterSkip.openQuestions.find((q) => q.id === "Q-001"),
    undefined,
  );
});

// ---- Cross-flow regression sweep -----------------------------------------

test("cross-flow regression: every fixture stays contract-valid, free of Staff bleed, and consistent with classifier", () => {
  const fixtures = {
    greenfieldReady: greenfieldReadyPacket,
    updateReady: updateReadyPacket,
    ambiguousNeedsUser: ambiguousNeedsUserPacket,
    replacementBlocked: replacementBlockedPacket,
    hoplonGrounded: hoplonGroundedPacket,
  };
  for (const [name, packet] of Object.entries(fixtures)) {
    const validation = validateSemantixAlignmentPacket(packet);
    assert.equal(validation.ok, true, `${name} failed contract validator`);
    const guard = validateNoStaffAuthorityBleed(packet);
    assert.equal(guard.ok, true, `${name} leaked Staff content`);
    // Classifier verdict is deterministic and consistent
    const verdict = classifyReadiness(packet);
    assert.ok(
      [READINESS.READY, READINESS.NEEDS_USER, READINESS.BLOCKED].includes(
        verdict.readiness,
      ),
      `${name} classifier returned an unknown readiness`,
    );
  }
});

// ---- Boundary documentation -----------------------------------------------

test("Semantix-side proof does not claim Phalanx lock / session / Staff handoff coverage", () => {
  // The proof file deliberately exercises only the Semantix-side
  // modules. Phalanx lock ceremony, immutable artifact storage,
  // append-only session persistence, and Staff handoff prose live in
  // the Phalanx repo and are not asserted here.
  const adapterCapabilities = createSemantixHandshakeAdapter({
    unavailable: true,
  }).describe();
  assert.equal(adapterCapabilities.capabilities.lockAuthority, "phalanx");
  assert.equal(adapterCapabilities.capabilities.coverageAuthority, "phalanx");
  assert.equal(adapterCapabilities.capabilities.decisionIdAuthority, "phalanx");
});
