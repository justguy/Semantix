import assert from "node:assert/strict";
import test from "node:test";

import { validateSemantixAlignmentPacket } from "../src/spec-studio-contracts.js";
import { createSpecStudioJsonProbeEvaluator } from "../src/spec-studio-json-probe-evaluator.js";

const DOC_GRILL_REQUEST =
  "Use the documentation grill loop to clarify the overloaded project term before Phalanx Staff sees the Spec Studio handoff.";

test("json probe emits a documentation-grill terminology question for matching requests", () => {
  const evaluator = createSpecStudioJsonProbeEvaluator();

  const result = evaluator({
    sessionId: "sess_doc_grill",
    trigger: "initial",
    originalUserRequest: DOC_GRILL_REQUEST,
    userTurn: { id: "u1", body: { kind: "text", text: DOC_GRILL_REQUEST } },
  });

  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.equal(result.packet.source, "semantix");
  assert.equal(result.packet.readiness, "needs_user");
  assert.equal(result.packet.coverage.openBlockers, 1);
  assert.equal(result.packet.blockingReasons[0].id, "BR-DOC-GRILL-TERM-001");
  assert.equal(result.packet.findings[0].id, "F-DOC-GRILL-TERM-001");
  assert.equal(result.packet.findings[0].sev, "blocker");
  assert.equal(result.packet.nextTurn.id, "T-DOC-GRILL-Q1");
  assert.equal(result.packet.nextTurn.phase, "adversarial");
  assert.match(result.packet.nextTurn.body.q, /When you say "project"/);
  assert.match(result.packet.nextTurn.body.ctx, /overloaded across Phalanx routing/);
  assert.equal(result.packet.nextTurn.body.options[0].tag, "recommend");
  assert.match(result.packet.nextTurn.body.options[0].description, /Phalanx run state/);
  assert.equal(result.packet.nextTurn.body.options[2].tag, "neutral");
});

test("json probe records the selected canonical term and clears the doc-grill blocker", () => {
  const evaluator = createSpecStudioJsonProbeEvaluator();

  const initial = evaluator({
    sessionId: "sess_doc_grill_ready",
    trigger: "initial",
    originalUserRequest: DOC_GRILL_REQUEST,
    userTurn: { id: "u1", body: { kind: "text", text: DOC_GRILL_REQUEST } },
  });

  const result = evaluator({
    sessionId: "sess_doc_grill_ready",
    trigger: "user_turn",
    currentPacket: initial.packet,
    userTurn: {
      id: "u2",
      body: {
        kind: "choice",
        picked: "OPT-PHALANX-PROJECT",
        label: "Phalanx project/run record",
      },
    },
  });

  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.equal(result.packet.readiness, "ready");
  assert.equal(result.packet.coverage.alignmentPct, 100);
  assert.equal(result.packet.coverage.openBlockers, 0);
  assert.equal(result.packet.findings[0].id, "F-DOC-GRILL-TERM-001");
  assert.equal(result.packet.findings[0].resolved, true);
  assert.equal(result.packet.userDecisions[0].id, "D-DOC-GRILL-TERM-001");
  assert.equal(result.packet.userDecisions[0].turnId, "u2");
  assert.equal(result.packet.userDecisions[0].kind, "choice");
  assert.equal(result.packet.userDecisions[0].questionRef, "T-DOC-GRILL-Q1");
  assert.match(result.packet.requirements[1].text, /Phalanx project\/run record/);
  assert.match(result.packet.requirements[2].text, /Do not mutate CONTEXT\.md/);
  assert.equal(result.packet.existingSystemContext.mode, "update");
  assert.equal(result.packet.existingSystemContext.targetSurfaces[0].name, "Phalanx Spec Studio alignment loop");
  assert.equal(result.packet.nextTurn, null);
});

test("json probe keeps the existing generic question for non-doc-grill requests", () => {
  const evaluator = createSpecStudioJsonProbeEvaluator();

  const result = evaluator({
    sessionId: "sess_generic_probe",
    trigger: "initial",
    originalUserRequest: "Build a notes app.",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
  });

  assert.equal(result.packet.nextTurn.id, "T-PROBE-Q1");
});
