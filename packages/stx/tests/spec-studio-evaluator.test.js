import assert from "node:assert/strict";
import test from "node:test";

import {
  EVALUATE_TRIGGER,
  EVALUATE_TRIGGER_VALUES,
  USER_TURN_BODY_KIND_VALUES,
  assertSemantixEvaluateRequest,
  assertSemantixEvaluateResponse,
  createSemantixEvaluator,
  validateSemantixEvaluateRequest,
  validateSemantixEvaluateResponse,
} from "../src/spec-studio-evaluator.js";

import {
  ambiguousNeedsUserPacket,
  greenfieldReadyPacket,
  hoplonGroundedPacket,
  updateReadyPacket,
} from "./fixtures/spec-studio-samples.js";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectErrorCode(result, code) {
  assert.equal(result.ok, false, `expected validation to fail with code "${code}"`);
  assert.ok(
    result.errors.some((error) => error.code === code),
    `expected error code "${code}" in: ${JSON.stringify(result.errors)}`,
  );
}

function buildInitialRequest() {
  return {
    sessionId: "spec_session_1",
    trigger: EVALUATE_TRIGGER.INITIAL,
    userTurn: {
      id: "u_1",
      body: { kind: "text", text: "Build a notes app with markdown support." },
    },
    decisions: [],
    findings: [],
    contextResponses: [],
  };
}

function buildUserTurnRequest() {
  return {
    sessionId: "spec_session_1",
    trigger: EVALUATE_TRIGGER.USER_TURN,
    userTurn: {
      id: "u_2",
      body: { kind: "free", text: "We also want offline support." },
    },
    currentPacket: greenfieldReadyPacket,
    decisions: [],
    findings: [],
    contextResponses: [],
  };
}

function buildEvaluateResponse(packet) {
  return {
    packet,
    events: [
      {
        id: "evt_1",
        kind: "packet.evaluated",
        at: "2026-04-30T00:00:00.000Z",
        sessionId: "spec_session_1",
      },
    ],
    contextRequests: [],
  };
}

// ---- Trigger constants ----------------------------------------------------

test("EVALUATE_TRIGGER exposes the six required trigger values", () => {
  assert.deepEqual(
    [...EVALUATE_TRIGGER_VALUES],
    ["initial", "user_turn", "reconsider", "context_response", "decide_all", "skip"],
  );
  assert.equal(EVALUATE_TRIGGER.INITIAL, "initial");
  assert.equal(EVALUATE_TRIGGER.USER_TURN, "user_turn");
  assert.equal(EVALUATE_TRIGGER.RECONSIDER, "reconsider");
  assert.equal(EVALUATE_TRIGGER.CONTEXT_RESPONSE, "context_response");
  assert.equal(EVALUATE_TRIGGER.DECIDE_ALL, "decide_all");
  assert.equal(EVALUATE_TRIGGER.SKIP, "skip");
});

test("USER_TURN_BODY_KIND_VALUES enumerates supported bodies", () => {
  assert.deepEqual([...USER_TURN_BODY_KIND_VALUES], ["text", "free", "choice"]);
});

// ---- Request acceptance ---------------------------------------------------

test("validates an initial trigger request without currentPacket", () => {
  const result = validateSemantixEvaluateRequest(buildInitialRequest());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validates a user_turn request that carries currentPacket and arrays", () => {
  const result = validateSemantixEvaluateRequest(buildUserTurnRequest());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validates a reconsider request when currentPacket is supplied", () => {
  const request = buildUserTurnRequest();
  request.trigger = EVALUATE_TRIGGER.RECONSIDER;
  const result = validateSemantixEvaluateRequest(request);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validates a context_response request with prior packet plus context array", () => {
  const result = validateSemantixEvaluateRequest({
    sessionId: "spec_session_1",
    trigger: EVALUATE_TRIGGER.CONTEXT_RESPONSE,
    currentPacket: hoplonGroundedPacket,
    decisions: [],
    findings: [],
    contextResponses: [
      {
        requestId: "CTX-001",
        status: "ok",
        facts: [
          {
            id: "FACT-001",
            source: "hoplon",
            text: "right panel exists",
            confidence: "high",
            evidenceRef: "hoplon://run-view#right-panel",
          },
        ],
        artifacts: [],
        summary: "Hoplon returned an existing surface.",
      },
    ],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validates a decide_all request given a current packet", () => {
  const result = validateSemantixEvaluateRequest({
    sessionId: "spec_session_1",
    trigger: EVALUATE_TRIGGER.DECIDE_ALL,
    currentPacket: ambiguousNeedsUserPacket,
    decisions: [],
    findings: [],
    contextResponses: [],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validates a skip request given a current packet", () => {
  const result = validateSemantixEvaluateRequest({
    sessionId: "spec_session_1",
    trigger: EVALUATE_TRIGGER.SKIP,
    currentPacket: ambiguousNeedsUserPacket,
    decisions: [],
    findings: [],
    contextResponses: [],
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

// ---- Request rejection ----------------------------------------------------

test("rejects unknown triggers", () => {
  const request = buildInitialRequest();
  request.trigger = "lock";
  expectErrorCode(validateSemantixEvaluateRequest(request), "invalid_trigger");
});

test("rejects requests without a sessionId", () => {
  const request = buildInitialRequest();
  delete request.sessionId;
  expectErrorCode(validateSemantixEvaluateRequest(request), "missing_session_id");
});

for (const trigger of [
  EVALUATE_TRIGGER.USER_TURN,
  EVALUATE_TRIGGER.RECONSIDER,
  EVALUATE_TRIGGER.CONTEXT_RESPONSE,
  EVALUATE_TRIGGER.DECIDE_ALL,
  EVALUATE_TRIGGER.SKIP,
]) {
  test(`rejects ${trigger} request without currentPacket`, () => {
    const request = buildUserTurnRequest();
    request.trigger = trigger;
    delete request.currentPacket;
    if (trigger === EVALUATE_TRIGGER.CONTEXT_RESPONSE || trigger === EVALUATE_TRIGGER.DECIDE_ALL || trigger === EVALUATE_TRIGGER.SKIP) {
      delete request.userTurn;
    }
    expectErrorCode(validateSemantixEvaluateRequest(request), "missing_current_packet");
  });
}

test("rejects user_turn trigger without a userTurn payload", () => {
  const request = buildUserTurnRequest();
  delete request.userTurn;
  expectErrorCode(validateSemantixEvaluateRequest(request), "missing_user_turn");
});

test("rejects reconsider trigger without a userTurn payload", () => {
  const request = buildUserTurnRequest();
  request.trigger = EVALUATE_TRIGGER.RECONSIDER;
  delete request.userTurn;
  expectErrorCode(validateSemantixEvaluateRequest(request), "missing_user_turn");
});

test("rejects requests whose decisions/findings/contextResponses are not arrays", () => {
  const request = buildInitialRequest();
  request.decisions = null;
  request.findings = "[]";
  request.contextResponses = undefined;
  const result = validateSemantixEvaluateRequest(request);
  expectErrorCode(result, "missing_decisions_array");
  expectErrorCode(result, "missing_findings_array");
  expectErrorCode(result, "missing_context_responses_array");
});

test("rejects malformed decision and finding entries", () => {
  const request = buildInitialRequest();
  request.decisions = [{ id: "", answer: "yes" }];
  request.findings = [
    {
      id: "F-BAD",
      kind: "gap",
      sev: "blocker",
      text: "missing section/ref/raisedBy",
      resolved: false,
    },
  ];
  const result = validateSemantixEvaluateRequest(request);
  expectErrorCode(result, "decision_missing_id");
  expectErrorCode(result, "decision_missing_kind");
  expectErrorCode(result, "decision_invalid_answer");
  expectErrorCode(result, "finding_invalid_section");
  expectErrorCode(result, "finding_missing_ref");
  expectErrorCode(result, "finding_invalid_raised_by");
});

test("rejects context_response requests carrying malformed contextResponses entries", () => {
  const result = validateSemantixEvaluateRequest({
    sessionId: "spec_session_1",
    trigger: EVALUATE_TRIGGER.CONTEXT_RESPONSE,
    currentPacket: hoplonGroundedPacket,
    decisions: [],
    findings: [],
    contextResponses: [
      {
        requestId: "CTX-001",
        status: "error",
        facts: [],
        summary: "",
      },
    ],
  });
  expectErrorCode(result, "missing_error_detail");
});

test("rejects user_turn whose body kind is unknown", () => {
  const request = buildUserTurnRequest();
  request.userTurn.body = { kind: "shrug", text: "" };
  expectErrorCode(validateSemantixEvaluateRequest(request), "user_turn_invalid_body_kind");
});

test("rejects choice user_turn that omits picked", () => {
  const request = buildUserTurnRequest();
  request.userTurn.body = { kind: "choice", label: "Yes" };
  expectErrorCode(validateSemantixEvaluateRequest(request), "user_turn_missing_picked");
});

test("rejects requests whose currentPacket is malformed", () => {
  const request = buildUserTurnRequest();
  request.currentPacket = deepClone(greenfieldReadyPacket);
  request.currentPacket.readiness = "unsure";
  const result = validateSemantixEvaluateRequest(request);
  expectErrorCode(result, "invalid_readiness");
});

test("assertSemantixEvaluateRequest throws on invalid input", () => {
  assert.throws(
    () => assertSemantixEvaluateRequest({ trigger: "initial" }),
    (error) => error.name === "ValidationError",
  );
});

// ---- Response validation --------------------------------------------------

test("validates a well-formed evaluate response", () => {
  const result = validateSemantixEvaluateResponse(buildEvaluateResponse(updateReadyPacket));
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("rejects responses with a non-object packet", () => {
  expectErrorCode(
    validateSemantixEvaluateResponse({
      packet: null,
      events: [],
      contextRequests: [],
    }),
    "missing_packet",
  );
});

test("rejects responses whose events array contains malformed entries", () => {
  const response = buildEvaluateResponse(greenfieldReadyPacket);
  response.events = [{ id: "", kind: "" }];
  const result = validateSemantixEvaluateResponse(response);
  expectErrorCode(result, "spec_event_missing_id");
  expectErrorCode(result, "spec_event_missing_kind");
});

test("rejects responses with a malformed contextRequest", () => {
  const response = buildEvaluateResponse(greenfieldReadyPacket);
  response.contextRequests = [
    {
      id: "CTX-001",
      sessionId: "spec_session_1",
      iteration: 1,
      purpose: "guess_target",
      query: "?",
      requestedFrom: ["phalanx"],
      constraints: {},
      reason: "test",
    },
  ];
  expectErrorCode(validateSemantixEvaluateResponse(response), "invalid_purpose");
});

test("rejects responses whose embedded packet is invalid", () => {
  const response = buildEvaluateResponse(deepClone(greenfieldReadyPacket));
  delete response.packet.existingSystemContext;
  expectErrorCode(
    validateSemantixEvaluateResponse(response),
    "existing_system_context_missing",
  );
});

test("assertSemantixEvaluateResponse throws on invalid input", () => {
  assert.throws(
    () => assertSemantixEvaluateResponse({}),
    (error) => error.name === "ValidationError",
  );
});

// ---- createSemantixEvaluator seam -----------------------------------------

test("createSemantixEvaluator runs an injected impl through the contract", async () => {
  const impl = (request) => {
    assert.equal(request.sessionId, "spec_session_1");
    return buildEvaluateResponse(greenfieldReadyPacket);
  };
  const evaluate = createSemantixEvaluator(impl);
  const response = await evaluate(buildInitialRequest());
  assert.equal(response.packet.sessionId, greenfieldReadyPacket.sessionId);
  assert.equal(response.events.length, 1);
  assert.deepEqual(response.contextRequests, []);
});

test("createSemantixEvaluator awaits async impl results", async () => {
  const impl = async (_request) =>
    Promise.resolve(buildEvaluateResponse(greenfieldReadyPacket));
  const evaluate = createSemantixEvaluator(impl);
  const response = await evaluate(buildInitialRequest());
  assert.equal(response.packet.contractVersion, greenfieldReadyPacket.contractVersion);
});

test("createSemantixEvaluator rejects an invalid request before calling impl", async () => {
  let called = false;
  const evaluate = createSemantixEvaluator(() => {
    called = true;
    return buildEvaluateResponse(greenfieldReadyPacket);
  });
  await assert.rejects(
    () => evaluate({ trigger: "initial" }),
    (error) => error.name === "ValidationError",
  );
  assert.equal(called, false);
});

test("createSemantixEvaluator rejects when impl returns a malformed response", async () => {
  const evaluate = createSemantixEvaluator(() => ({
    packet: {},
    events: [],
    contextRequests: [],
  }));
  await assert.rejects(
    () => evaluate(buildInitialRequest()),
    (error) => error.name === "ValidationError",
  );
});

test("createSemantixEvaluator throws when impl is not a function", () => {
  assert.throws(
    () => createSemantixEvaluator(null),
    (error) => error.name === "ValidationError",
  );
});

test("seam can drive an in-process Spec Studio loop without a server", async () => {
  const turns = [];
  const impl = (request) => {
    turns.push(request.trigger);
    if (request.trigger === EVALUATE_TRIGGER.INITIAL) {
      return buildEvaluateResponse(ambiguousNeedsUserPacket);
    }
    if (request.trigger === EVALUATE_TRIGGER.USER_TURN) {
      return buildEvaluateResponse(greenfieldReadyPacket);
    }
    return buildEvaluateResponse(greenfieldReadyPacket);
  };
  const evaluate = createSemantixEvaluator(impl);

  const initial = await evaluate(buildInitialRequest());
  assert.equal(initial.packet.readiness, "needs_user");

  const followUp = await evaluate({
    sessionId: "spec_session_1",
    trigger: EVALUATE_TRIGGER.USER_TURN,
    userTurn: {
      id: "u_2",
      body: { kind: "choice", picked: "opt_existing", label: "Update existing Run View" },
    },
    currentPacket: initial.packet,
    decisions: [],
    findings: [],
    contextResponses: [],
  });
  assert.equal(followUp.packet.readiness, "ready");

  assert.deepEqual(turns, ["initial", "user_turn"]);
});
