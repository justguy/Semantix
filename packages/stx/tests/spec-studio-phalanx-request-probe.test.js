/**
 * Semantix-side probe for the request shapes Phalanx's live:semantix
 * transport sends. This does not start Phalanx or a Semantix HTTP
 * service; it feeds mocked Phalanx envelopes directly into the
 * Semantix handshake adapter so integration blockers show up in the
 * Semantix test suite first.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  createSemantixHandshakeAdapter,
} from "../src/spec-studio-handshake.js";
import {
  validateSemantixAlignmentPacket,
} from "../src/spec-studio-contracts.js";

import {
  ambiguousNeedsUserPacket,
  greenfieldReadyPacket,
  updateReadyPacket,
} from "./fixtures/spec-studio-samples.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stamp(packet, sessionId, iteration) {
  return {
    ...clone(packet),
    sessionId,
    iteration,
  };
}

test("Phalanx live initial envelope can run through the Semantix handshake adapter", async () => {
  const seen = [];
  const adapter = createSemantixHandshakeAdapter({
    evaluator: (request) => {
      seen.push(request);
      return {
        packet: stamp(ambiguousNeedsUserPacket, request.sessionId, 0),
        events: [{ id: "evt_probe_initial", kind: "packet.evaluated" }],
        contextRequests: [],
      };
    },
  });

  const response = await adapter.evaluate({
    sessionId: "sess_demo_live_configured",
    runId: "run_demo_live_configured",
    specId: "spec_demo_live_configured",
    project: "phalanx",
    title: "H2A demo",
    subtitle: "configured live probe",
    originalUserRequest:
      "Add observation summaries to the existing run surface.",
    evaluatorSource: "live:semantix",
    trigger: "initial",
  });

  assert.equal(response.packet.sessionId, "sess_demo_live_configured");
  assert.equal(response.packet.readiness, "needs_user");
  assert.deepEqual(seen[0].decisions, []);
  assert.deepEqual(seen[0].findings, []);
  assert.deepEqual(seen[0].contextResponses, []);
});

test("Phalanx choice and nested context-response envelopes validate before live integration", async () => {
  const sessionId = "sess_probe_turns";
  const initialPacket = stamp(ambiguousNeedsUserPacket, sessionId, 0);
  const readyPacket = stamp(greenfieldReadyPacket, sessionId, 1);
  const contextReadyPacket = stamp(updateReadyPacket, sessionId, 2);
  const seen = [];

  const adapter = createSemantixHandshakeAdapter({
    evaluator: (request) => {
      seen.push(request);
      if (request.trigger === "context_response") {
        return {
          packet: contextReadyPacket,
          events: [{ id: "evt_probe_context", kind: "packet.evaluated" }],
          contextRequests: [],
        };
      }
      return {
        packet: readyPacket,
        events: [{ id: "evt_probe_turn", kind: "packet.evaluated" }],
        contextRequests: [],
      };
    },
  });

  const choiceResponse = await adapter.evaluate({
    sessionId,
    runId: "run_probe",
    specId: "spec_probe",
    project: "phalanx",
    trigger: "user_turn",
    userTurn: {
      id: "turn_user_choice_1",
      body: {
        kind: "choice",
        questionTurnId: "turn_semantix_question_1",
        picked: "opt_existing",
        label: "Update existing Run View",
      },
    },
    currentPacket: initialPacket,
    decisions: [],
    findings: [],
    contextResponses: [],
  });
  assert.equal(choiceResponse.packet.readiness, "ready");

  const contextResponse = await adapter.evaluate({
    sessionId,
    runId: "run_probe",
    specId: "spec_probe",
    project: "phalanx",
    trigger: "context_response",
    currentPacket: readyPacket,
    decisions: [],
    findings: [],
    contextResponses: [
      {
        requestId: "CTX-001",
        iteration: 1,
        response: {
          status: "empty",
          facts: [],
          artifacts: [],
          summary: "No grounded facts produced.",
        },
      },
    ],
  });
  assert.equal(contextResponse.packet.readiness, "ready");
  assert.deepEqual(seen[1].contextResponses, [
    {
      requestId: "CTX-001",
      iteration: 1,
      status: "empty",
      facts: [],
      artifacts: [],
      summary: "No grounded facts produced.",
    },
  ]);
});

test("packet validator accepts the full Phalanx requirement enum surface", () => {
  const packet = stamp(greenfieldReadyPacket, "sess_probe_requirement_types", 0);
  packet.requirements = [
    {
      id: "REQ-NFR-001",
      type: "nonfunctional",
      text: "The surface remains responsive under normal run load.",
      priority: "should",
      sourceRef: "dec_nfr_001",
      acceptance: "Summary rendering does not block the main run view.",
      status: "proposed",
    },
    {
      id: "REQ-INT-001",
      type: "integration",
      text: "The surface reads observation summaries from the existing run data source.",
      priority: "must",
      sourceRef: "dec_int_001",
      acceptance: "No duplicate data-fetching channel is introduced.",
      status: "confirmed",
    },
    {
      id: "REQ-ACC-001",
      type: "acceptance",
      text: "Operator can verify the summary state in the run view.",
      priority: "must",
      sourceRef: "dec_acc_001",
      acceptance: "A test or manual verification step covers the summary state.",
      status: "contested",
    },
  ];

  const validation = validateSemantixAlignmentPacket(packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});
