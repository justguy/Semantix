import assert from "node:assert/strict";
import test from "node:test";

import { validateSemantixAlignmentPacket } from "../src/spec-studio-contracts.js";
import { createSpecStudioBatchProbeEvaluator } from "../src/spec-studio-batch-probe-evaluator.js";
import { createSpecStudioMultiTurnProbeEvaluator } from "../src/spec-studio-multi-turn-probe-evaluator.js";

function expectValid(packet) {
  const validation = validateSemantixAlignmentPacket(packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
}

test("batch probe emits contract-valid update context for existing-system answers", () => {
  const evaluator = createSpecStudioBatchProbeEvaluator();

  let result = evaluator({
    sessionId: "sess_batch_update",
    trigger: "initial",
    originalUserRequest: "Update the expense reporting workflow.",
  });
  expectValid(result.packet);

  result = evaluator({
    sessionId: "sess_batch_update",
    trigger: "user_turn",
    currentPacket: result.packet,
    userTurn: {
      id: "turn_batch_update_1",
      body: {
        kind: "batch",
        answers: [
          { questionId: "Q-SYSTEM-TYPE", kind: "choice", picked: "OPT-UPDATE", label: "Updating existing" },
          { questionId: "Q-USER-TYPE", kind: "choice", picked: "OPT-END-USER", label: "End user" },
          { questionId: "Q-TIMELINE", kind: "choice", picked: "OPT-Q2", label: "Q2 2026" },
        ],
      },
    },
  });
  expectValid(result.packet);
  assert.equal(result.packet.existingSystemContext.mode, "update");

  result = evaluator({
    sessionId: "sess_batch_update",
    trigger: "user_turn",
    currentPacket: result.packet,
    userTurn: {
      id: "turn_batch_update_2",
      body: {
        kind: "free",
        text: "Users submit expense reports and route approvals through the current approval service.",
      },
    },
  });

  expectValid(result.packet);
  assert.equal(result.packet.readiness, "ready");
  assert.equal(result.packet.approvalRequired, true);
  assert.equal(result.packet.existingSystemContext.mode, "update");
  assert.ok(result.packet.existingSystemContext.targetSurfaces.length > 0);
  assert.ok(result.packet.existingSystemContext.doNotChange.length > 0);
});

test("batch probe reconciles new-vs-existing contradiction to contract-valid update mode", () => {
  const evaluator = createSpecStudioBatchProbeEvaluator();

  let result = evaluator({
    sessionId: "sess_batch_reconcile_update",
    trigger: "initial",
    originalUserRequest: "Build an expense reporting app.",
  });
  result = evaluator({
    sessionId: "sess_batch_reconcile_update",
    trigger: "user_turn",
    currentPacket: result.packet,
    userTurn: {
      id: "turn_batch_reconcile_1",
      body: {
        kind: "batch",
        answers: [
          { questionId: "Q-SYSTEM-TYPE", kind: "choice", picked: "OPT-NEW", label: "New system" },
          { questionId: "Q-USER-TYPE", kind: "choice", picked: "OPT-END-USER", label: "End user" },
          { questionId: "Q-TIMELINE", kind: "choice", picked: "OPT-Q2", label: "Q2 2026" },
        ],
      },
    },
  });
  result = evaluator({
    sessionId: "sess_batch_reconcile_update",
    trigger: "user_turn",
    currentPacket: result.packet,
    userTurn: {
      id: "turn_batch_reconcile_2",
      body: {
        kind: "free",
        text: "Users submit expense reports through the existing SAP Finance API.",
      },
    },
  });
  assert.equal(result.packet.coverage.openBlockers, 1);

  result = evaluator({
    sessionId: "sess_batch_reconcile_update",
    trigger: "user_turn",
    currentPacket: result.packet,
    userTurn: {
      id: "turn_batch_reconcile_3",
      body: {
        kind: "choice",
        picked: "OPT-UPDATE-EXISTING",
        label: "Actually updating an existing system",
      },
    },
  });

  expectValid(result.packet);
  assert.equal(result.packet.readiness, "ready");
  assert.equal(result.packet.existingSystemContext.mode, "update");
  assert.ok(result.packet.findings.every((finding) => finding.resolved));
});

test("multi-turn probe preserves update mode through the final ready packet", () => {
  const evaluator = createSpecStudioMultiTurnProbeEvaluator();

  let result = evaluator({
    sessionId: "sess_mt_update",
    trigger: "initial",
    originalUserRequest: "Update the expense reporting workflow.",
  });
  expectValid(result.packet);

  result = evaluator({
    sessionId: "sess_mt_update",
    trigger: "user_turn",
    currentPacket: result.packet,
    userTurn: {
      id: "turn_mt_update_1",
      body: { kind: "choice", picked: "OPT-UPDATE", label: "Updating existing" },
    },
  });
  expectValid(result.packet);
  assert.equal(result.packet.existingSystemContext.mode, "update");

  result = evaluator({
    sessionId: "sess_mt_update",
    trigger: "user_turn",
    currentPacket: result.packet,
    userTurn: {
      id: "turn_mt_update_2",
      body: { kind: "choice", picked: "OPT-END-USER", label: "End user" },
    },
  });
  result = evaluator({
    sessionId: "sess_mt_update",
    trigger: "user_turn",
    currentPacket: result.packet,
    userTurn: {
      id: "turn_mt_update_3",
      body: {
        kind: "free",
        text: "Users need to submit expense reports and track approval status.",
      },
    },
  });
  result = evaluator({
    sessionId: "sess_mt_update",
    trigger: "skip",
    currentPacket: result.packet,
  });
  result = evaluator({
    sessionId: "sess_mt_update",
    trigger: "user_turn",
    currentPacket: result.packet,
    userTurn: {
      id: "turn_mt_update_5",
      body: {
        kind: "choice",
        picked: "OPT-DEFER-CONFIRM",
        label: "Confirmed - defer auth to a later sprint",
      },
    },
  });

  expectValid(result.packet);
  assert.equal(result.packet.readiness, "ready");
  assert.equal(result.packet.approvalRequired, true);
  assert.equal(result.packet.existingSystemContext.mode, "update");
  assert.ok(result.packet.existingSystemContext.targetSurfaces.length > 0);
  assert.ok(result.packet.existingSystemContext.compatibilityRequirements.length > 0);
});
