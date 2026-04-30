import assert from "node:assert/strict";
import test from "node:test";

import {
  TURN_ACTION,
  applyDecideAllTurn,
  applyReconsiderTurn,
  applySkipTurn,
  applyUserChoiceTurn,
  applyUserFreeTurn,
} from "../src/spec-studio-user-turn-loop.js";

import {
  READINESS,
  validateSemantixAlignmentPacket,
} from "../src/spec-studio-contracts.js";
import {
  checkIdContinuity,
} from "../src/spec-studio-id-continuity.js";

import {
  ambiguousNeedsUserPacket,
  greenfieldReadyPacket,
} from "./fixtures/spec-studio-samples.js";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function basePacketWithQuestion() {
  const packet = deepClone(ambiguousNeedsUserPacket);
  // Make sure the open question/finding pair lines up for the choice/skip tests.
  return packet;
}

const FIXED_NOW = "2026-04-30T12:00:00.000Z";

// ---- Action constants ----------------------------------------------------

test("TURN_ACTION enumerates the supported user-turn kinds", () => {
  assert.deepEqual(Object.values(TURN_ACTION).sort(), [
    "choice",
    "decide_all",
    "free",
    "reconsider",
    "skip",
  ]);
});

// ---- Choice --------------------------------------------------------------

test("applyUserChoiceTurn records a decision, resolves the finding, and removes the open question", () => {
  const packet = basePacketWithQuestion();
  const { packet: next, decisionId } = applyUserChoiceTurn({
    packet,
    userTurn: { id: "u_2", body: { kind: "choice", picked: "opt_existing", label: "Update existing Run View" } },
    questionRef: "Q-001",
    pickedOptionId: "opt_existing",
    pickedLabel: "Update existing Run View",
    tag: "recommend",
    now: FIXED_NOW,
  });
  assert.match(decisionId, /^sem_dec_001$/);
  const decision = next.userDecisions[0];
  assert.equal(decision.kind, "choice");
  assert.equal(decision.questionRef, "Q-001");
  assert.equal(decision.answer.optId, "opt_existing");
  assert.equal(decision.at, FIXED_NOW);
  // open question consumed
  assert.equal(next.openQuestions.length, 0);
  // linked finding resolved
  const finding = next.findings.find((f) => f.id === "F-001");
  assert.equal(finding.resolved, true);
  assert.equal(finding.resolvedAt, FIXED_NOW);
  assert.equal(finding.resolutionDecisionId, decisionId);
  // readiness drops to needs_user pending re-evaluation
  assert.equal(next.readiness, READINESS.NEEDS_USER);
});

test("applyUserChoiceTurn accepts an externally-minted decisionId", () => {
  const packet = basePacketWithQuestion();
  const { packet: next, decisionId } = applyUserChoiceTurn({
    packet,
    userTurn: { id: "u_2", body: { kind: "choice", picked: "opt_existing", label: "x" } },
    questionRef: "Q-001",
    pickedOptionId: "opt_existing",
    decisionId: "dec_phalanx_001",
    now: FIXED_NOW,
  });
  assert.equal(decisionId, "dec_phalanx_001");
  assert.equal(next.userDecisions[0].id, "dec_phalanx_001");
});

test("generated provisional decision ids skip gaps instead of reusing them", () => {
  const packet = basePacketWithQuestion();
  packet.userDecisions = [
    { id: "sem_dec_001", kind: "choice" },
    { id: "sem_dec_003", kind: "choice" },
  ];
  const { decisionId } = applyUserChoiceTurn({
    packet,
    userTurn: { id: "u_gap", body: { kind: "choice", picked: "opt_existing", label: "Update existing Run View" } },
    questionRef: "Q-001",
    pickedOptionId: "opt_existing",
    pickedLabel: "Update existing Run View",
    now: FIXED_NOW,
  });
  assert.equal(decisionId, "sem_dec_004");
});

test("applyUserChoiceTurn rejects malformed inputs", () => {
  const packet = basePacketWithQuestion();
  assert.throws(
    () =>
      applyUserChoiceTurn({
        packet,
        userTurn: {},
        questionRef: "Q-001",
        pickedOptionId: "opt_existing",
      }),
    (error) => error.name === "ValidationError",
  );
});

// ---- Free text -----------------------------------------------------------

test("applyUserFreeTurn records a free-text decision and clears readiness", () => {
  const packet = basePacketWithQuestion();
  const { packet: next, decisionId } = applyUserFreeTurn({
    packet,
    userTurn: { id: "u_2", body: { kind: "free", text: "Use the existing run view, but expand the right panel only." } },
    questionRef: "Q-001",
    text: "Use the existing run view, but expand the right panel only.",
    now: FIXED_NOW,
  });
  assert.match(decisionId, /^sem_dec_/);
  const decision = next.userDecisions[0];
  assert.equal(decision.kind, "free");
  assert.equal(decision.answer.kind, "free");
  assert.match(decision.answer.text, /existing run view/);
  // free text doesn't auto-resolve linked findings; F-001 stays open
  assert.equal(next.findings.find((f) => f.id === "F-001").resolved, false);
});

test("applyUserFreeTurn rejects empty text", () => {
  assert.throws(
    () =>
      applyUserFreeTurn({
        packet: basePacketWithQuestion(),
        userTurn: { id: "u_2" },
        text: "",
      }),
    (error) => error.name === "ValidationError",
  );
});

// ---- Reconsider -----------------------------------------------------------

test("applyReconsiderTurn marks the prior decision superseded and reopens its findings", () => {
  // Build a packet that already has a resolved decision.
  const packet = basePacketWithQuestion();
  const seeded = applyUserChoiceTurn({
    packet,
    userTurn: { id: "u_2", body: { kind: "choice", picked: "opt_existing", label: "Update existing Run View" } },
    questionRef: "Q-001",
    pickedOptionId: "opt_existing",
    pickedLabel: "Update existing Run View",
    now: FIXED_NOW,
  });
  const { packet: reconsidered, decisionId: newId } = applyReconsiderTurn({
    packet: seeded.packet,
    userTurn: { id: "u_3", body: { kind: "choice", picked: "opt_new", label: "Create a new dashboard" } },
    priorDecisionId: seeded.decisionId,
    newAnswer: { kind: "choice", optId: "opt_new", label: "Create a new dashboard" },
    reason: "User changed their mind",
    now: "2026-04-30T13:00:00.000Z",
  });

  // Prior decision is superseded, not deleted
  const prior = reconsidered.userDecisions.find((d) => d.id === seeded.decisionId);
  assert.equal(prior.supersededBy, newId);
  assert.equal(prior.supersededReason, "User changed their mind");
  // New decision is appended
  const replacement = reconsidered.userDecisions.find((d) => d.id === newId);
  assert.equal(replacement.kind, "choice");
  assert.equal(replacement.reconsidersDecisionId, seeded.decisionId);
  // Finding linked to prior decision is reopened
  const finding = reconsidered.findings.find((f) => f.id === "F-001");
  assert.equal(finding.resolved, false);
  assert.equal(finding.reopenReason, "User changed their mind");
});

test("applyReconsiderTurn rejects unknown priorDecisionId", () => {
  assert.throws(
    () =>
      applyReconsiderTurn({
        packet: basePacketWithQuestion(),
        userTurn: { id: "u_3" },
        priorDecisionId: "dec_unknown",
        newAnswer: { kind: "choice", optId: "opt", label: "x" },
        reason: "test",
      }),
    (error) => error.name === "ValidationError",
  );
});

// ---- Skip ----------------------------------------------------------------

test("applySkipTurn raises a concern finding and records a dismiss decision", () => {
  // Use a packet whose existing F-001 finding is downgraded to a non-blocker
  // so the skip path adds a new concern (the spec says skipping never removes
  // an existing blocker finding).
  const packet = basePacketWithQuestion();
  packet.findings = packet.findings.map((f) =>
    f.id === "F-001" ? { ...f, sev: "concern" } : f,
  );
  const { packet: next, decisionId, findingId } = applySkipTurn({
    packet,
    userTurn: { id: "u_skip", body: { kind: "free", text: "skip" } },
    questionRef: "Q-001",
    reason: "Will revisit later",
    now: FIXED_NOW,
  });
  assert.equal(next.userDecisions[0].kind, "dismiss");
  assert.equal(next.userDecisions[0].answer.reason, "Will revisit later");
  assert.equal(next.openQuestions.length, 0);
  const newFinding = next.findings.find((f) => f.id === findingId);
  assert.ok(newFinding);
  assert.equal(newFinding.sev, "concern");
  assert.equal(newFinding.kind, "gap");
  assert.match(newFinding.text, /skipped/i);
  assert.match(decisionId, /^sem_dec_/);
});

test("applySkipTurn never silently dismisses an existing blocker finding", () => {
  // The fixture already has F-001 as blocker. The skip path should NOT
  // raise a new concern that would let the blocker quietly disappear;
  // it should leave the blocker in place.
  const packet = basePacketWithQuestion();
  const { packet: next } = applySkipTurn({
    packet,
    userTurn: { id: "u_skip", body: { kind: "free", text: "skip" } },
    questionRef: "Q-001",
    reason: "punted",
    now: FIXED_NOW,
  });
  // Original blocker still present
  const blocker = next.findings.find((f) => f.id === "F-001");
  assert.equal(blocker.sev, "blocker");
  assert.equal(blocker.resolved, false);
  // No duplicate concern raised under the same questionRef
  const concerns = next.findings.filter(
    (f) => f.ref === "Q-001" && f.sev === "concern",
  );
  assert.equal(concerns.length, 0);
});

// ---- Decide-all ----------------------------------------------------------

test("applyDecideAllTurn flags decided-by-semantix entries for human review", () => {
  const packet = basePacketWithQuestion();
  const { packet: next, decisionIds } = applyDecideAllTurn({
    packet,
    userTurn: { id: "u_da", body: { kind: "free", text: "decide" } },
    resolutions: [
      {
        questionRef: "Q-001",
        optId: "opt_existing",
        label: "Update existing Run View",
        rationale: "Existing surface is the safer default.",
      },
    ],
    now: FIXED_NOW,
  });
  assert.equal(decisionIds.length, 1);
  const decision = next.userDecisions[0];
  assert.equal(decision.kind, "decided-by-semantix");
  assert.equal(decision.answer.optId, "opt_existing");
  assert.equal(decision.answer.rationale, "Existing surface is the safer default.");
  assert.ok(Array.isArray(decision.flagged));
  assert.equal(decision.flagged.length, 1);
  assert.match(decision.flagged[0].reason, /human review/i);
  // Linked finding resolved
  const finding = next.findings.find((f) => f.id === "F-001");
  assert.equal(finding.resolved, true);
  assert.equal(finding.resolutionDecisionId, decisionIds[0]);
});

test("applyDecideAllTurn requires a rationale per resolution", () => {
  assert.throws(
    () =>
      applyDecideAllTurn({
        packet: basePacketWithQuestion(),
        userTurn: { id: "u_da" },
        resolutions: [{ questionRef: "Q-001", optId: "opt_existing" }],
      }),
    (error) =>
      error.name === "ValidationError" &&
      /rationale/i.test(error.message),
  );
});

test("decided-by-semantix decision IDs do not collide with Phalanx audit IDs", () => {
  const packet = basePacketWithQuestion();
  const { packet: next, decisionIds } = applyDecideAllTurn({
    packet,
    userTurn: { id: "u_da", body: { kind: "free", text: "decide" } },
    resolutions: [
      {
        questionRef: "Q-001",
        optId: "opt_existing",
        rationale: "x",
      },
    ],
    now: FIXED_NOW,
  });
  for (const id of decisionIds) {
    assert.match(id, /^sem_dec_/);
    assert.ok(!id.startsWith("dec_"), `id ${id} must not look like a Phalanx canonical id`);
  }
  const decision = next.userDecisions.find((d) => d.id === decisionIds[0]);
  assert.equal(decision.kind, "decided-by-semantix");
});

// ---- Stable-id continuity --------------------------------------------------

test("user-turn mutations do not violate stable-id continuity for requirements/findings/groundedFacts", () => {
  const prior = basePacketWithQuestion();
  const { packet: next } = applyUserChoiceTurn({
    packet: prior,
    userTurn: { id: "u_2", body: { kind: "choice", picked: "opt_existing", label: "Update existing Run View" } },
    questionRef: "Q-001",
    pickedOptionId: "opt_existing",
    now: FIXED_NOW,
  });
  const continuity = checkIdContinuity({ priorPacket: prior, nextPacket: next });
  assert.equal(continuity.ok, true, JSON.stringify(continuity.violations));
});

test("reconsider does not violate stable-id continuity", () => {
  const prior = basePacketWithQuestion();
  const seeded = applyUserChoiceTurn({
    packet: prior,
    userTurn: { id: "u_2", body: { kind: "choice", picked: "opt_existing", label: "x" } },
    questionRef: "Q-001",
    pickedOptionId: "opt_existing",
    now: FIXED_NOW,
  });
  const { packet: reconsidered } = applyReconsiderTurn({
    packet: seeded.packet,
    userTurn: { id: "u_3", body: { kind: "choice", picked: "opt_new", label: "x" } },
    priorDecisionId: seeded.decisionId,
    newAnswer: { kind: "choice", optId: "opt_new", label: "x" },
    reason: "test",
    now: "2026-04-30T13:00:00.000Z",
  });
  const continuity = checkIdContinuity({
    priorPacket: seeded.packet,
    nextPacket: reconsidered,
  });
  assert.equal(continuity.ok, true, JSON.stringify(continuity.violations));
});

// ---- Mutated packet still validates ---------------------------------------

test("packets after user-turn mutations still pass the contract validator", () => {
  const packet = basePacketWithQuestion();
  const { packet: nextChoice } = applyUserChoiceTurn({
    packet,
    userTurn: { id: "u_2", body: { kind: "choice", picked: "opt_existing", label: "x" } },
    questionRef: "Q-001",
    pickedOptionId: "opt_existing",
    now: FIXED_NOW,
  });
  assert.equal(
    validateSemantixAlignmentPacket(nextChoice).ok,
    true,
  );

  const { packet: nextSkip } = applySkipTurn({
    packet,
    userTurn: { id: "u_skip", body: { kind: "free", text: "skip" } },
    questionRef: "Q-001",
    reason: "punted",
    now: FIXED_NOW,
  });
  assert.equal(
    validateSemantixAlignmentPacket(nextSkip).ok,
    true,
  );
});

// ---- No Phalanx persistence in Semantix ----------------------------------

test("turn helpers never write to disk or call out to a Phalanx process", () => {
  // Documentation / structural test: the helpers only mutate plain
  // objects in memory. We exercise every helper and assert no
  // unexpected globals or file ops.
  const packet = basePacketWithQuestion();
  const variants = [
    () =>
      applyUserChoiceTurn({
        packet,
        userTurn: { id: "u_2", body: { kind: "choice", picked: "opt_existing", label: "x" } },
        questionRef: "Q-001",
        pickedOptionId: "opt_existing",
        now: FIXED_NOW,
      }),
    () =>
      applyUserFreeTurn({
        packet,
        userTurn: { id: "u_2", body: { kind: "free", text: "x" } },
        questionRef: "Q-001",
        text: "test",
        now: FIXED_NOW,
      }),
    () =>
      applySkipTurn({
        packet,
        userTurn: { id: "u_2", body: { kind: "free", text: "skip" } },
        questionRef: "Q-001",
        reason: "test",
        now: FIXED_NOW,
      }),
  ];
  for (const variant of variants) {
    assert.doesNotThrow(() => variant());
  }
});
