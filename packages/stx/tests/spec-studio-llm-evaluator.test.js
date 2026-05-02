import assert from "node:assert/strict";
import test from "node:test";

import {
  buildEvaluatorSystemPrompt,
  synthesizeEvaluatorInput,
  extractJsonFromLlmOutput,
  parseEvaluatorOutput,
  createLlmSpecStudioEvaluator,
} from "../src/spec-studio-llm-evaluator.js";

import { validateSemantixAlignmentPacket } from "../src/spec-studio-contracts.js";
import { isDegradedPacket } from "../src/spec-studio-degraded.js";

// ---- Helpers ----------------------------------------------------------------

function buildNeedsUserPacketJson(sessionId, iteration) {
  return JSON.stringify({
    contractVersion: "semantix.phalanx.spec-studio.v1",
    source: "semantix",
    sessionId,
    iteration,
    readiness: "needs_user",
    readinessReason: "Need to know if this is a new or existing system.",
    blockingReasons: [],
    approvalRequired: true,
    originalUserRequest: "Build a notes app.",
    alignedRequirement: "",
    requirements: [],
    flow: { pages: [], states: [], transitions: [], dataNeeded: [] },
    scope: { inScope: [], outOfScope: [], negativeRequirements: [] },
    assumptions: [],
    openQuestions: [],
    risks: [],
    userDecisions: [],
    acceptanceSummary: [],
    existingSystemContext: { mode: "unknown" },
    contextSources: [],
    groundedFacts: [],
    findings: [],
    coverage: { alignmentPct: 20, sections: [], openBlockers: 0, openConcerns: 1, openFYI: 0 },
    nextTurn: {
      id: "T-001",
      side: "semantix",
      at: "2026-05-01T00:00:00.000Z",
      phase: "socratic",
      target: "intent",
      body: { kind: "question", q: "Is this a new system or an update?" },
    },
  });
}

function buildReadyPacketJson(sessionId, iteration) {
  return JSON.stringify({
    contractVersion: "semantix.phalanx.spec-studio.v1",
    source: "semantix",
    sessionId,
    iteration,
    readiness: "ready",
    readinessReason: "All must-level requirements confirmed.",
    blockingReasons: [],
    approvalRequired: true,
    originalUserRequest: "Build a notes app.",
    alignedRequirement: "Build a new local notes application with markdown support.",
    requirements: [
      {
        id: "REQ-001",
        type: "functional",
        text: "Users can create and edit notes.",
        priority: "must",
        sourceRef: "user-turn-1",
        acceptance: "CRUD flows work from the UI.",
        status: "confirmed",
      },
    ],
    flow: { pages: [], states: [], transitions: [], dataNeeded: [] },
    scope: { inScope: ["Notes app"], outOfScope: ["Cloud sync"], negativeRequirements: [] },
    assumptions: [],
    openQuestions: [],
    risks: [],
    userDecisions: [],
    acceptanceSummary: ["CRUD flows work."],
    existingSystemContext: { mode: "new" },
    contextSources: [],
    groundedFacts: [],
    findings: [],
    coverage: { alignmentPct: 100, sections: [], openBlockers: 0, openConcerns: 0, openFYI: 0 },
    nextTurn: null,
  });
}

function mockConnector(responses) {
  let callIndex = 0;
  return {
    execute: async (_opts) => {
      const response = responses[callIndex] ?? responses[responses.length - 1];
      callIndex += 1;
      return response;
    },
  };
}

// ---- buildEvaluatorSystemPrompt -------------------------------------------

test("buildEvaluatorSystemPrompt returns a non-empty string", () => {
  const prompt = buildEvaluatorSystemPrompt();
  assert.equal(typeof prompt, "string");
  assert.ok(prompt.length > 100);
  assert.ok(prompt.includes("SemantixAlignmentPacket"));
  assert.ok(prompt.includes("readiness"));
  assert.ok(prompt.includes("body.options"), "prompt must describe Phalanx-style question options");
  assert.ok(prompt.includes("evidenceRefs"), "prompt must describe contextSource evidenceRefs");
  assert.ok(prompt.includes("targetSurfaces\":[{\"id\""), "prompt must describe structured target surfaces");
  assert.ok(prompt.includes('"body":{"kind":"question"'), "prompt must show the real nextTurn.body key");
  assert.equal(prompt.includes('"kind":"choice"'), false, "prompt must not advertise outgoing choice nextTurn bodies");
});

// ---- synthesizeEvaluatorInput ----------------------------------------------

test("synthesizeEvaluatorInput includes trigger and sessionId", () => {
  const request = {
    sessionId: "spec_test",
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
    currentPacket: null,
    decisions: [],
    findings: [],
    contextResponses: [],
  };
  const input = synthesizeEvaluatorInput(request);
  assert.ok(input.includes("trigger: initial"));
  assert.ok(input.includes("sessionId: spec_test"));
  assert.ok(input.includes("SemantixAlignmentPacket"));
});

test("synthesizeEvaluatorInput includes currentPacket fields on follow-up", () => {
  const request = {
    sessionId: "spec_test",
    trigger: "user_turn",
    userTurn: { id: "u2", body: { kind: "choice", picked: "OPT-NEW", label: "New system" } },
    currentPacket: {
      iteration: 0,
      readiness: "needs_user",
      originalUserRequest: "Build a notes app.",
      alignedRequirement: "",
      requirements: [],
      findings: [],
      nextTurn: { id: "T-001", body: { kind: "question", q: "New or existing?" } },
    },
    decisions: [],
    findings: [],
    contextResponses: [],
  };
  const input = synthesizeEvaluatorInput(request);
  assert.ok(input.includes("currentPacket.iteration: 0"));
  assert.ok(input.includes("currentPacket.readiness: needs_user"));
});

// ---- extractJsonFromLlmOutput ----------------------------------------------

test("extracts plain JSON object", () => {
  const obj = extractJsonFromLlmOutput('{"foo": "bar"}');
  assert.deepEqual(obj, { foo: "bar" });
});

test("extracts JSON from markdown code fence", () => {
  const obj = extractJsonFromLlmOutput("```json\n{\"foo\": \"bar\"}\n```");
  assert.deepEqual(obj, { foo: "bar" });
});

test("extracts JSON from prose-wrapped output", () => {
  const obj = extractJsonFromLlmOutput('Here is your packet:\n{"foo": "bar"}\nEnd of packet.');
  assert.deepEqual(obj, { foo: "bar" });
});

test("returns null for non-JSON text", () => {
  const obj = extractJsonFromLlmOutput("No JSON here at all.");
  assert.equal(obj, null);
});

// ---- parseEvaluatorOutput --------------------------------------------------

test("parseEvaluatorOutput returns valid response for needs_user packet", () => {
  const sessionId = "spec_parse_test";
  const rawText = buildNeedsUserPacketJson(sessionId, 0);
  const request = { sessionId, trigger: "initial" };
  const result = parseEvaluatorOutput(sessionId, 0, rawText, request);

  assert.ok(result.packet);
  assert.equal(result.packet.readiness, "needs_user");
  assert.equal(result.packet.sessionId, sessionId);
  assert.equal(result.packet.iteration, 0);
  assert.ok(Array.isArray(result.events));
  assert.ok(result.events.length > 0);
  assert.ok(Array.isArray(result.contextRequests));

  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput accepts a packet with question nextTurn options", () => {
  const sessionId = "spec_question_options_test";
  const packet = {
    contractVersion: "semantix.phalanx.spec-studio.v1",
    source: "semantix",
    sessionId,
    iteration: 0,
    readiness: "needs_user",
    readinessReason: "Toggle placement is unspecified.",
    blockingReasons: [],
    approvalRequired: true,
    originalUserRequest: "Add dark mode toggle.",
    alignedRequirement: "Add dark mode toggle.",
    requirements: [],
    flow: { pages: [], states: [], transitions: [], dataNeeded: [] },
    scope: { inScope: [], outOfScope: [], negativeRequirements: [] },
    assumptions: [], openQuestions: [], risks: [], userDecisions: [], acceptanceSummary: [],
    existingSystemContext: { mode: "unknown" },
    contextSources: [], groundedFacts: [], findings: [],
    coverage: { alignmentPct: 30, sections: [], openBlockers: 0, openConcerns: 1, openFYI: 0 },
    nextTurn: {
      id: "nt-001", side: "semantix", at: "2026-05-01T00:00:00.000Z",
      phase: "crisp", target: "user",
      body: {
        kind: "question",
        q: "Where should the toggle appear?",
        options: [
          { id: "OPT-001", label: "Top-right nav bar" },
          { id: "OPT-002", label: "Settings page" },
          { id: "OPT-003", label: "Floating button" },
        ],
      },
    },
  };
  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), { sessionId, trigger: "initial" });
  assert.equal(result.packet.readiness, "needs_user");
  assert.equal(result.packet.nextTurn.body.kind, "question");
  assert.equal(result.packet.nextTurn.body.options.length, 3);
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput canonicalizes common live LLM shape drift before validation", () => {
  const sessionId = "spec_live_shape_drift";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.blockingReasons = ["Need target surface."];
  packet.flow = {
    pages: ["Run View"],
    states: ["Summary hidden", "Summary visible"],
    transitions: ["User opens a run and sees summaries"],
    dataNeeded: ["Observation summary text"],
  };
  packet.assumptions = ["User means the existing Run View."];
  packet.openQuestions = ["Should this update the existing Run View?"];
  packet.risks = ["Could duplicate an existing surface."];
  packet.userDecisions = [{ id: "dec_bad", kind: "choice" }];
  packet.existingSystemContext = {
    mode: "update",
    targetSurfaces: ["Run View"],
  };
  packet.contextSources = [
    {
      id: "CS-001",
      kind: "user",
      status: "used",
      ref: "u1",
      summary: "User requested observation summaries.",
    },
  ];
  packet.coverage = {
    alignmentPct: "42%",
    sections: ["scope"],
    openBlockers: "1",
    openConcerns: "0",
    openFYI: "0",
  };

  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), {
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Add observation summaries." } },
  });

  assert.equal(result.packet.blockingReasons[0].id, "BR-LLM-001");
  assert.equal(result.packet.flow.states[0].id, "STATE-LLM-001");
  assert.equal(result.packet.flow.transitions[0].from, "unknown");
  assert.equal(result.packet.flow.dataNeeded[0].unresolved, true);
  assert.equal(result.packet.assumptions[0].id, "A-LLM-001");
  assert.equal(result.packet.openQuestions[0].section, "scope");
  assert.equal(result.packet.risks[0].section, "risks");
  assert.deepEqual(result.packet.userDecisions, []);
  assert.deepEqual(result.packet.existingSystemContext.targetSurfaces[0], {
    id: "surf_run_view",
    kind: "unknown",
    name: "Run View",
  });
  assert.deepEqual(result.packet.contextSources[0].evidenceRefs, ["u1"]);
  assert.equal(result.packet.coverage.alignmentPct, 42);
  assert.equal(result.packet.coverage.sections[0].id, "scope");
  assert.equal(result.packet.coverage.sections[0].status, "weak");

  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput repairs invalid coverage alignmentPct instead of leaking it", () => {
  const sessionId = "spec_live_bad_coverage";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.coverage.alignmentPct = "not available";
  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), { sessionId, trigger: "initial" });
  assert.equal(result.packet.coverage.alignmentPct, 0);
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput rejects outgoing choice nextTurn body", () => {
  const sessionId = "spec_outgoing_choice_reject";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.nextTurn.body = {
    kind: "choice",
    q: "Where should the toggle appear?",
    options: [
      { id: "OPT-001", label: "Top-right nav bar" },
      { id: "OPT-002", label: "Settings page" },
    ],
  };
  assert.throws(
    () => parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), { sessionId, trigger: "initial" }),
    /next_turn_invalid_body_kind/,
  );
});

test("parseEvaluatorOutput rejects stable ID continuity violations before Phalanx sees them", () => {
  const sessionId = "spec_continuity_reject";
  const priorPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  priorPacket.requirements = [
    {
      id: "REQ-001",
      type: "functional",
      text: "Show observation summaries.",
      priority: "must",
      sourceRef: "u1",
      acceptance: "Summaries are visible.",
      status: "proposed",
    },
  ];
  const nextPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 1));
  nextPacket.requirements = [];
  assert.throws(
    () => parseEvaluatorOutput(sessionId, 1, JSON.stringify(nextPacket), {
      sessionId,
      trigger: "user_turn",
      currentPacket: priorPacket,
    }),
    /stable ID continuity: requirement_dropped/,
  );
});

test("parseEvaluatorOutput stamps contractVersion and source", () => {
  const sessionId = "spec_stamp_test";
  const parsed = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  delete parsed.contractVersion;
  delete parsed.source;
  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(parsed), { sessionId, trigger: "initial" });
  assert.equal(result.packet.contractVersion, "semantix.phalanx.spec-studio.v1");
  assert.equal(result.packet.source, "semantix");
});

test("parseEvaluatorOutput throws on non-JSON input", () => {
  assert.throws(
    () => parseEvaluatorOutput("sess", 0, "This is not JSON at all.", { sessionId: "sess", trigger: "initial" }),
    /non-JSON/,
  );
});

test("parseEvaluatorOutput throws on invalid packet shape", () => {
  assert.throws(
    () => parseEvaluatorOutput("sess", 0, '{"readiness": "invalid_value", "sessionId": "sess"}', { sessionId: "sess", trigger: "initial" }),
    /invalid packet/,
  );
});

// ---- createLlmSpecStudioEvaluator ------------------------------------------

test("createLlmSpecStudioEvaluator evaluatorMode is llm", () => {
  const connector = mockConnector([{ exitCode: 0, stdout: "{}", stderr: "" }]);
  const evaluator = createLlmSpecStudioEvaluator({ connector });
  assert.equal(evaluator.evaluatorMode, "llm");
});

test("createLlmSpecStudioEvaluator throws without connector", () => {
  assert.throws(() => createLlmSpecStudioEvaluator({}), /connector/);
});

test("createLlmSpecStudioEvaluator returns needs_user packet on initial turn", async () => {
  const sessionId = "spec_llm_initial";
  const packetJson = buildNeedsUserPacketJson(sessionId, 0);
  const connector = mockConnector([{ exitCode: 0, stdout: packetJson, stderr: "" }]);
  const evaluator = createLlmSpecStudioEvaluator({ connector });

  const request = {
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
    decisions: [],
    findings: [],
    contextResponses: [],
  };

  const result = await evaluator(request);
  assert.ok(result.packet);
  assert.equal(result.packet.readiness, "needs_user");
  assert.equal(result.packet.sessionId, sessionId);
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("createLlmSpecStudioEvaluator returns ready packet after user_turn", async () => {
  const sessionId = "spec_llm_ready";
  const priorPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  const readyJson = buildReadyPacketJson(sessionId, 1);
  const connector = mockConnector([{ exitCode: 0, stdout: readyJson, stderr: "" }]);
  const evaluator = createLlmSpecStudioEvaluator({ connector });

  const request = {
    sessionId,
    trigger: "user_turn",
    userTurn: { id: "u2", body: { kind: "choice", picked: "OPT-NEW", label: "New system" } },
    currentPacket: priorPacket,
    decisions: [],
    findings: [],
    contextResponses: [],
  };

  const result = await evaluator(request);
  assert.equal(result.packet.readiness, "ready");
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("createLlmSpecStudioEvaluator degrades honestly on malformed JSON response", async () => {
  const sessionId = "spec_llm_degrade_json";
  const connector = mockConnector([{ exitCode: 0, stdout: "This is not JSON at all.", stderr: "" }]);
  const evaluator = createLlmSpecStudioEvaluator({ connector });

  const request = {
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
    decisions: [],
    findings: [],
    contextResponses: [],
  };

  const result = await evaluator(request);
  assert.ok(result.packet);
  assert.equal(result.packet.readiness, "needs_user");
  assert.ok(isDegradedPacket(result.packet));
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("createLlmSpecStudioEvaluator degrades honestly when connector throws", async () => {
  const sessionId = "spec_llm_degrade_throw";
  const connector = {
    execute: async () => { throw new Error("LLM unavailable"); },
  };
  const evaluator = createLlmSpecStudioEvaluator({ connector });

  const request = {
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
    decisions: [],
    findings: [],
    contextResponses: [],
  };

  const result = await evaluator(request);
  assert.ok(result.packet);
  assert.ok(isDegradedPacket(result.packet));
  assert.equal(result.packet.readiness, "needs_user");
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("createLlmSpecStudioEvaluator degrades honestly when connector returns nonzero exit", async () => {
  const sessionId = "spec_llm_degrade_exit";
  const connector = mockConnector([{ exitCode: 1, stdout: "", stderr: "model timeout" }]);
  const evaluator = createLlmSpecStudioEvaluator({ connector });

  const request = {
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
    decisions: [],
    findings: [],
    contextResponses: [],
  };

  const result = await evaluator(request);
  assert.ok(isDegradedPacket(result.packet));
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("createLlmSpecStudioEvaluator parses JSON from markdown-fenced LLM output", async () => {
  const sessionId = "spec_llm_fenced";
  const innerJson = buildNeedsUserPacketJson(sessionId, 0);
  const fencedOutput = `Here is your alignment packet:\n\`\`\`json\n${innerJson}\n\`\`\`\nEnd of response.`;
  const connector = mockConnector([{ exitCode: 0, stdout: fencedOutput, stderr: "" }]);
  const evaluator = createLlmSpecStudioEvaluator({ connector });

  const request = {
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
    decisions: [],
    findings: [],
    contextResponses: [],
  };

  const result = await evaluator(request);
  assert.equal(result.packet.readiness, "needs_user");
  assert.equal(result.packet.sessionId, sessionId);
});
