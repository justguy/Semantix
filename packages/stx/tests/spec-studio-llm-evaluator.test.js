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
import { checkIdContinuity } from "../src/spec-studio-id-continuity.js";

// ---- Helpers ----------------------------------------------------------------

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

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
  assert.ok(prompt.includes("documentation-grill discipline"), "prompt must include doc-grill questioning rules");
  assert.ok(prompt.includes("option.description rationale"), "prompt must preserve option rationale for Phalanx");
  assert.ok(prompt.includes("do not mutate CONTEXT.md or ADR files"), "prompt must keep doc updates outside evaluator authority");
  assert.ok(prompt.includes('nextTurn.body.kind="batch"'), "prompt must allow batched independent questions");
  assert.ok(prompt.includes("extremely underspecified"), "prompt must guard against mode-only generic clarification");
  assert.ok(prompt.includes("evidenceRefs"), "prompt must describe contextSource evidenceRefs");
  assert.ok(prompt.includes("targetSurfaces"), "prompt must describe structured target surfaces");
  assert.ok(prompt.includes("nextTurn.body may be a question"), "prompt must describe the real nextTurn.body key");
  assert.equal(prompt.includes('"kind":"choice"'), false, "prompt must not advertise outgoing choice nextTurn bodies");
  assert.doesNotMatch(prompt, /<string>|<short option label>|<optional string>/);
  assert.doesNotMatch(prompt, /high \| medium \| low/);
  assert.doesNotMatch(prompt, /Should notes stay|Storage and sync behavior|personal notes app/i);
  assert.ok(prompt.includes("Clarifying questions must be concrete"), "prompt must reject generic clarifications");
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

test("synthesizeEvaluatorInput includes originalUserRequest when no userTurn is present", () => {
  const request = {
    sessionId: "spec_original_only",
    trigger: "initial",
    originalUserRequest: "Add summary cards to the run view.",
    decisions: [],
    findings: [],
    contextResponses: [],
  };
  const input = synthesizeEvaluatorInput(request);
  assert.ok(input.includes("originalUserRequest: Add summary cards to the run view."));
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

test("extracts first alignment packet from multi-record JSON stdout", () => {
  const packetJson = buildNeedsUserPacketJson("spec_extract_jsonl", 0);
  const obj = extractJsonFromLlmOutput(`${packetJson}\n{"type":"usage","tokens":123}`);
  assert.equal(obj.readiness, "needs_user");
  assert.equal(obj.sessionId, "spec_extract_jsonl");
});

test("skips semantix metadata records before extracting alignment packet", () => {
  const packetJson = buildNeedsUserPacketJson("spec_extract_after_metadata", 0);
  const metadata = JSON.stringify({ source: "semantix", event: "log", message: "starting" });
  const obj = extractJsonFromLlmOutput(`${metadata}\n${packetJson}`);
  assert.equal(obj.readiness, "needs_user");
  assert.equal(obj.sessionId, "spec_extract_after_metadata");
});

test("extracts nested alignment packet from Codex output_text wrapper", () => {
  const packetJson = buildNeedsUserPacketJson("spec_extract_wrapper", 0);
  const wrapped = JSON.stringify({
    type: "message",
    content: [
      {
        type: "output_text",
        text: packetJson,
      },
    ],
  });
  const obj = extractJsonFromLlmOutput(wrapped);
  assert.equal(obj.readiness, "needs_user");
  assert.equal(obj.sessionId, "spec_extract_wrapper");
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

test("parseEvaluatorOutput canonicalizes live LLM enum drift before validation", () => {
  const sessionId = "spec_live_enum_drift";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.readiness = "needs-user";
  packet.requirements = [
    {
      id: "REQ-001",
      type: "feature",
      text: "Users can create notes.",
      priority: "required",
      sourceRef: "u1",
      acceptance: "A note can be created.",
      status: "open",
    },
    {
      id: "REQ-002",
      type: "success",
      text: "Search works.",
      priority: "medium",
      sourceRef: "u1",
      acceptanceCriteria: "A user can find a note by title.",
      status: "accepted",
    },
  ];
  packet.findings = [
    {
      id: "F-001",
      kind: "issue",
      severity: "high",
      section: "target surface",
      ref: "u1",
      text: "Platform is not specified.",
      resolved: "no",
      raisedBy: "AI",
    },
  ];

  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), {
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
  });

  assert.equal(result.packet.readiness, "needs_user");
  assert.deepEqual(
    result.packet.requirements.map((requirement) => ({
      type: requirement.type,
      priority: requirement.priority,
      status: requirement.status,
    })),
    [
      { type: "functional", priority: "must", status: "proposed" },
      { type: "acceptance", priority: "should", status: "confirmed" },
    ],
  );
  assert.deepEqual(result.packet.findings[0], {
    id: "F-001",
    kind: "gap",
    sev: "blocker",
    section: "intent",
    ref: "u1",
    text: "Platform is not specified.",
    resolved: false,
    raisedBy: "semantix",
  });
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput normalizes invalid nextTurn target values for Phalanx", () => {
  const sessionId = "spec_bad_next_target";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.nextTurn.target = "user";
  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), { sessionId, trigger: "initial" });
  assert.equal(result.packet.nextTurn.target, "intent");
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput repairs live LLM requirements missing acceptance", () => {
  const sessionId = "spec_live_missing_requirement_acceptance";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.requirements = [
    {
      id: "REQ-NOTES",
      type: "functional",
      text: "Users can create notes.",
      priority: "must",
      sourceRef: "u1",
      status: "proposed",
    },
    "Users can search notes.",
  ];

  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), {
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
  });

  assert.equal(
    result.packet.requirements[0].acceptance,
    "Acceptance remains pending until this proposed requirement is confirmed: Users can create notes.",
  );
  assert.equal(
    result.packet.requirements[1].acceptance,
    "Acceptance remains pending until this proposed requirement is confirmed: Users can search notes.",
  );
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput normalizes invalid nextTurn phase and body kind values", () => {
  const sessionId = "spec_bad_next_phase";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.nextTurn.phase = "clarification";
  packet.nextTurn.body = {
    kind: "questions",
    questions: [
      { id: "Q-001", q: "Which platform should this target?" },
    ],
  };
  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), { sessionId, trigger: "initial" });
  assert.equal(result.packet.nextTurn.phase, "socratic");
  assert.equal(result.packet.nextTurn.body.kind, "batch");
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput normalizes invalid grounded fact confidence", () => {
  const sessionId = "spec_bad_grounded_fact_confidence";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.groundedFacts = [
    {
      id: "GF-001",
      source: "user",
      text: "The user requested an invoice approval dashboard.",
      evidenceRef: "u1",
      confidence: "high | medium | low",
    },
    {
      id: "GF-002",
      source: "user",
      text: "The user wants search.",
      evidenceRef: "u1",
      confidence: "certain",
    },
    {
      id: "GF-003",
      source: "user",
      text: "The user wants keyboard navigation.",
      evidenceRef: "u1",
      confidence: "Medium",
    },
    {
      id: "GF-004",
      source: "user",
      text: "The user wants exports.",
      evidenceRef: "u1",
    },
  ];

  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), {
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app with search." } },
  });

  assert.deepEqual(
    result.packet.groundedFacts.map((fact) => fact.id),
    ["GF-002", "GF-003"],
  );
  assert.equal(result.packet.groundedFacts[0].confidence, "high");
  assert.equal(result.packet.groundedFacts[1].confidence, "medium");
  assert.equal(
    result.packet.groundedFacts.every((fact) => ["high", "medium", "low"].includes(fact.confidence)),
    true,
  );
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput normalizes currentPacket grounded fact confidence after stable merge", () => {
  const sessionId = "spec_prior_bad_grounded_fact_confidence";
  const priorPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  priorPacket.groundedFacts = [
    {
      id: "GF-001",
      source: "user",
      text: "The user requested an invoice approval dashboard.",
      evidenceRef: "u1",
      confidence: "low-confidence",
    },
  ];
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 1));
  packet.groundedFacts = [];

  const result = parseEvaluatorOutput(sessionId, 1, JSON.stringify(packet), {
    sessionId,
    trigger: "user_turn",
    currentPacket: priorPacket,
    userTurn: { id: "u2", body: { kind: "text", text: "Keep going." } },
  });

  assert.equal(result.packet.groundedFacts[0].id, "GF-001");
  assert.equal(result.packet.groundedFacts[0].confidence, "low");
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput strips schema placeholder literals before UI display", () => {
  const sessionId = "spec_placeholder_literals";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.readinessReason = "<string>";
  packet.blockingReasons = [{ id: "BR-001", text: "<string>" }];
  packet.requirements = [
    {
      id: "REQ-001",
      type: "functional",
      text: "<string>",
      priority: "must",
      sourceRef: "u1",
      acceptance: "<string>",
      status: "proposed",
    },
  ];
  packet.assumptions = ["<string>"];
  packet.openQuestions = [
    {
      id: "Q-001",
      section: "scope",
      question: "<string>",
      options: ["<string>", "Use local storage"],
    },
  ];
  packet.findings = [
    {
      id: "F-001",
      kind: "gap",
      sev: "concern",
      section: "scope",
      ref: "u1",
      text: "<string>",
      resolved: false,
      raisedBy: "semantix",
    },
    {
      id: "F-002",
      kind: "gap",
      sev: "concern",
      section: "scope",
      ref: "u1",
      text: "Storage is unspecified.",
      resolved: false,
      raisedBy: "semantix",
    },
  ];
  packet.nextTurn.body = {
    kind: "batch",
    questions: [
      {
        id: "Q-001",
        q: "<string>",
        options: [{ id: "OPT-001", label: "<short option label>" }],
      },
      {
        id: "Q-002",
        q: "How should notes be stored?",
        options: [
          { id: "OPT-002", label: "<short option label>" },
          { id: "OPT-003", label: "Local storage" },
        ],
      },
    ],
  };

  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), {
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
  });
  const serialized = JSON.stringify(result.packet);
  assert.equal(serialized.includes("<string>"), false);
  assert.equal(serialized.includes("<short option label>"), false);
  assert.deepEqual(result.packet.blockingReasons, []);
  assert.deepEqual(result.packet.requirements, []);
  assert.deepEqual(result.packet.assumptions, []);
  assert.deepEqual(result.packet.openQuestions, []);
  assert.equal(result.packet.findings.length, 1);
  assert.equal(result.packet.findings[0].text, "Storage is unspecified.");
  assert.equal(result.packet.nextTurn.body.questions.length, 1);
  assert.equal(result.packet.nextTurn.body.questions[0].q, "How should notes be stored?");
  assert.deepEqual(result.packet.nextTurn.body.questions[0].options, [
    { id: "OPT-003", label: "Local storage" },
  ]);
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput repairs placeholder nextTurn from concrete openQuestions", () => {
  const sessionId = "spec_placeholder_required_repair";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.originalUserRequest = "<string>";
  delete packet.alignedRequirement;
  packet.readinessReason = "<string>";
  packet.openQuestions = [
    {
      id: "Q-STORAGE",
      section: "scope",
      question: "Where should notes be stored?",
      options: ["Local browser storage", "Cloud sync"],
    },
  ];
  packet.nextTurn = {
    id: "<string>",
    side: "semantix",
    at: "<string>",
    phase: "clarification",
    target: "scope",
    body: { kind: "question", q: "<string>" },
  };

  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), {
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
  });

  assert.equal(result.packet.nextTurn.body.q, "Where should notes be stored?");
  assert.deepEqual(result.packet.nextTurn.body.options, [
    { id: "OPT-001", label: "Local browser storage" },
    { id: "OPT-002", label: "Cloud sync" },
  ]);
  assert.equal(JSON.stringify(result.packet).includes("<string>"), false);
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput rejects question nextTurn missing live body.q", () => {
  const sessionId = "spec_question_missing_q_repair";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.openQuestions = [];
  packet.blockingReasons = [];
  packet.findings = [];
  packet.nextTurn.body = { kind: "question" };

  assert.throws(
    () => parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), {
      sessionId,
      trigger: "initial",
      userTurn: {
        id: "u1",
        body: { kind: "text", text: "Add an advisory intake flow for project triage." },
      },
    }),
    {
      message: /next_turn_question_missing_text/,
    },
  );
});

test("parseEvaluatorOutput rejects batch nextTurn without live questions", () => {
  const sessionId = "spec_batch_missing_questions_repair";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.openQuestions = [];
  packet.blockingReasons = [];
  packet.findings = [];
  packet.nextTurn.body = {
    kind: "batch",
    questions: [{ id: "Q-MISSING" }],
  };

  assert.throws(
    () => parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), {
      sessionId,
      trigger: "initial",
      userTurn: {
        id: "u1",
        body: { kind: "text", text: "Add an advisory intake flow for project triage." },
      },
    }),
    {
      message: /next_turn_batch_missing_questions/,
    },
  );
});

test("parseEvaluatorOutput clears stale nextTurn for ready packets", () => {
  const sessionId = "spec_ready_stale_next_turn_clear";
  const packet = JSON.parse(buildReadyPacketJson(sessionId, 1));
  packet.nextTurn = {
    id: "T-STALE-READY",
    side: "semantix",
    at: "2026-05-01T00:00:00.000Z",
    phase: "socratic",
    target: "scope",
    body: { kind: "choice", q: "Stale invalid outgoing choice?" },
  };

  const result = parseEvaluatorOutput(sessionId, 1, JSON.stringify(packet), {
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
  });

  assert.equal(result.packet.readiness, "ready");
  assert.equal(result.packet.nextTurn, null);
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput clears stale nextTurn for blocked packets", () => {
  const sessionId = "spec_blocked_stale_next_turn_clear";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.readiness = "blocked";
  packet.readinessReason = "Semantix cannot continue until repository context is available.";
  packet.blockingReasons = [{ id: "BR-CONTEXT", text: "Repository context is unavailable." }];
  packet.nextTurn = {
    id: "T-STALE-BLOCKED",
    side: "semantix",
    at: "2026-05-01T00:00:00.000Z",
    phase: "socratic",
    target: "scope",
    body: { kind: "question", q: "Should this blocked packet ask a question?" },
  };

  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), {
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
  });

  assert.equal(result.packet.readiness, "blocked");
  assert.equal(result.packet.nextTurn, null);
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput repairs missing needs_user nextTurn from openQuestions", () => {
  const sessionId = "spec_needs_user_missing_next_turn_repair";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  delete packet.nextTurn;
  packet.openQuestions = [
    {
      id: "Q-APPROVALS",
      section: "scope",
      question: "Which approval roles should the advisory intake flow support?",
    },
  ];

  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), {
    sessionId,
    trigger: "initial",
    userTurn: {
      id: "u1",
      body: { kind: "text", text: "Add an advisory intake flow for project triage." },
    },
  });

  assert.equal(
    result.packet.nextTurn.body.q,
    "Which approval roles should the advisory intake flow support?",
  );
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput normalizes body.question alias into body.q", () => {
  const sessionId = "spec_next_turn_question_alias";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.nextTurn.body = {
    kind: "question",
    question: "Which intake states should Phalanx display?",
  };

  const result = parseEvaluatorOutput(sessionId, 0, JSON.stringify(packet), {
    sessionId,
    trigger: "initial",
    userTurn: {
      id: "u1",
      body: { kind: "text", text: "Add an advisory intake flow for project triage." },
    },
  });

  assert.equal(result.packet.nextTurn.body.q, "Which intake states should Phalanx display?");
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput does not reintroduce malformed currentPacket nextTurn on follow-up", () => {
  const sessionId = "spec_followup_malformed_current_next_turn";
  const priorPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  priorPacket.nextTurn = {
    id: "T-MALFORMED-PRIOR",
    side: "semantix",
    at: "2026-05-01T00:00:00.000Z",
    phase: "socratic",
    target: "scope",
    body: { kind: "question" },
  };
  const nextPacket = JSON.parse(buildReadyPacketJson(sessionId, 1));
  nextPacket.nextTurn = {
    id: "T-STALE-NEXT",
    side: "semantix",
    at: "2026-05-01T00:00:00.000Z",
    phase: "socratic",
    target: "scope",
    body: { kind: "question", q: "Stale question after follow-up?" },
  };

  const result = parseEvaluatorOutput(sessionId, 1, JSON.stringify(nextPacket), {
    sessionId,
    trigger: "user_turn",
    currentPacket: priorPacket,
    userTurn: {
      id: "u2",
      body: { kind: "free", text: "Use manager and finance approver roles." },
    },
  });

  assert.equal(result.packet.readiness, "ready");
  assert.equal(result.packet.nextTurn, null);
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput carries follow-up original request without synthesizing aligned requirement", () => {
  const sessionId = "spec_followup_required_repair";
  const priorPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  priorPacket.originalUserRequest = "Build a notes app.";
  const nextPacket = JSON.parse(buildReadyPacketJson(sessionId, 1));
  delete nextPacket.originalUserRequest;
  delete nextPacket.alignedRequirement;

  const result = parseEvaluatorOutput(sessionId, 1, JSON.stringify(nextPacket), {
    sessionId,
    trigger: "user_turn",
    currentPacket: priorPacket,
    userTurn: {
      id: "u2",
      body: {
        kind: "free",
        text: "Use a responsive web UI with local browser storage.",
      },
    },
  });

  assert.equal(result.packet.originalUserRequest, "Build a notes app.");
  assert.equal(result.packet.alignedRequirement, "");
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("createLlmSpecStudioEvaluator degrades generic website mode-only clarification", async () => {
  const sessionId = "spec_generic_website_mode_only";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  packet.originalUserRequest = "create a website with buttons";
  packet.readinessReason = "Need to know if this is a new or existing site.";
  packet.blockingReasons = [{ id: "BR-001", text: "Target surface is ambiguous." }];
  packet.openQuestions = [
    {
      id: "Q-001",
      section: "scope",
      question: "Should this update an existing site, or create a new one?",
      options: ["Update existing site", "Create a new site"],
    },
  ];
  packet.findings = [
    {
      id: "F-001",
      kind: "gap",
      sev: "blocker",
      section: "scope",
      ref: "Q-001",
      text: "Target surface is ambiguous.",
      resolved: false,
      raisedBy: "semantix",
    },
  ];
  packet.nextTurn.body.q = "Should this update an existing site, or create a new one?";
  packet.nextTurn.body.options = [
    { id: "OPT-UPDATE", label: "Update existing site" },
    { id: "OPT-NEW", label: "Create a new site" },
  ];
  const connector = mockConnector([
    { exitCode: 0, stdout: JSON.stringify(packet), stderr: "" },
    { exitCode: 0, stdout: JSON.stringify(packet), stderr: "" },
  ]);
  const evaluator = createLlmSpecStudioEvaluator({
    connector,
    maxClarificationRetries: 1,
  });

  const result = await evaluator({
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "create a website with buttons" } },
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.ok(isDegradedPacket(result.packet));
  assert.equal(result.events[0].kind, "llm.evaluator.degraded");
  assert.match(result.events[0].payload.reason, /only asked whether an underspecified website request is new or existing/);
  assert.equal(result.packet.nextTurn, null);
  assert.equal(result.llmResponses.length, 2);
  assert.match(result.llmResponses[0].retryReason, /only asked whether an underspecified website request/);
  assert.match(result.llmResponses[1].rawText, /Should this update an existing site/);
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput preserves deterministic decisions from batch user turns", () => {
  const sessionId = "spec_batch_decision_baseline";
  const priorPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  priorPacket.originalUserRequest = "create a website with buttons";
  priorPacket.existingSystemContext = { mode: "new" };
  priorPacket.openQuestions = [
    { id: "Q-WEB-INTENT", section: "intent", question: "What is the website for?" },
    { id: "Q-WEB-BUTTONS", section: "success", question: "What should the buttons do?" },
  ];
  priorPacket.findings = [
    {
      id: "F-WEB-001",
      kind: "gap",
      sev: "blocker",
      section: "intent",
      ref: "Q-WEB-INTENT",
      text: "Website purpose is unresolved.",
      resolved: false,
      raisedBy: "semantix",
    },
    {
      id: "F-WEB-002",
      kind: "gap",
      sev: "blocker",
      section: "success",
      ref: "Q-WEB-BUTTONS",
      text: "Button behavior is unresolved.",
      resolved: false,
      raisedBy: "semantix",
    },
  ];
  priorPacket.nextTurn = {
    id: "T-WEB-001",
    side: "semantix",
    at: "2026-05-01T00:00:00.000Z",
    phase: "socratic",
    target: "intent",
    body: {
      kind: "batch",
      questions: [
        { id: "Q-WEB-INTENT", q: "What is the website for?" },
        { id: "Q-WEB-BUTTONS", q: "What should the buttons do?" },
      ],
    },
  };

  const nextPacket = JSON.parse(buildReadyPacketJson(sessionId, 1));
  nextPacket.originalUserRequest = "create a website with buttons";
  nextPacket.alignedRequirement = "Create a new product landing page with buttons that open a signup flow.";
  nextPacket.userDecisions = [];
  nextPacket.findings = [];

  const result = parseEvaluatorOutput(sessionId, 1, JSON.stringify(nextPacket), {
    sessionId,
    trigger: "user_turn",
    currentPacket: priorPacket,
    userTurn: {
      id: "u_batch",
      body: {
        kind: "batch",
        answers: [
          { questionId: "Q-WEB-INTENT", kind: "choice", picked: "OPT-WEB-PRODUCT", label: "Product landing page" },
          { questionId: "Q-WEB-BUTTONS", kind: "free", text: "Buttons should open a signup flow." },
        ],
      },
    },
    decisions: [],
  });

  assert.equal(result.packet.readiness, "ready");
  assert.equal(result.packet.userDecisions.length, 2);
  assert.deepEqual(
    result.packet.userDecisions.map((decision) => decision.questionRef),
    ["Q-WEB-INTENT", "Q-WEB-BUTTONS"],
  );
  assert.ok(result.packet.findings.every((finding) => finding.resolved === true));
  assert.equal(result.packet.coverage.openBlockers, 0);
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput consumes a single free-text answer to an open question", () => {
  const sessionId = "spec_single_free_decision_baseline";
  const priorPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  priorPacket.originalUserRequest = "create a website with buttons";
  priorPacket.existingSystemContext = { mode: "new" };
  priorPacket.openQuestions = [
    {
      id: "Q-WEB-SURFACE",
      section: "scope",
      question:
        "The request does not identify an existing library website or codebase surface, so the packet assumes a new website with low confidence.",
    },
  ];
  priorPacket.findings = [
    {
      id: "F-WEB-SURFACE",
      kind: "gap",
      sev: "blocker",
      section: "scope",
      ref: "Q-WEB-SURFACE",
      text: "New-vs-update target surface is unresolved.",
      resolved: false,
      raisedBy: "semantix",
    },
  ];
  priorPacket.nextTurn = {
    id: "Q-WEB-SURFACE",
    side: "semantix",
    at: "2026-05-01T00:00:00.000Z",
    phase: "socratic",
    target: "scope",
    body: {
      kind: "question",
      q:
        "The request does not identify an existing library website or codebase surface, so the packet assumes a new website with low confidence.",
    },
  };

  const nextPacket = JSON.parse(buildReadyPacketJson(sessionId, 1));
  nextPacket.originalUserRequest = priorPacket.originalUserRequest;
  nextPacket.existingSystemContext = { mode: "new" };
  nextPacket.openQuestions = deepClone(priorPacket.openQuestions);
  nextPacket.findings = deepClone(priorPacket.findings);
  nextPacket.nextTurn = deepClone(priorPacket.nextTurn);
  nextPacket.userDecisions = [];

  const result = parseEvaluatorOutput(sessionId, 1, JSON.stringify(nextPacket), {
    sessionId,
    trigger: "user_turn",
    currentPacket: priorPacket,
    userTurn: {
      id: "u_free_surface",
      body: {
        kind: "free",
        text: "This is a new website, not an update to an existing library surface.",
      },
    },
    decisions: [],
  });

  assert.equal(
    result.packet.openQuestions.some((question) => question.id === "Q-WEB-SURFACE"),
    false,
  );
  assert.equal(result.packet.nextTurn, null);
  const finding = result.packet.findings.find((item) => item.id === "F-WEB-SURFACE");
  assert.equal(finding.resolved, true);
  assert.equal(result.packet.coverage.openBlockers, 0);
  assert.equal(result.packet.userDecisions.length, 1);
  assert.equal(result.packet.userDecisions[0].kind, "free");
  assert.equal(result.packet.userDecisions[0].questionRef, "Q-WEB-SURFACE");
  assert.match(result.packet.userDecisions[0].id, /^sem_dec_/);

  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput preserves prior stable IDs when a follow-up LLM packet drops them", () => {
  const sessionId = "spec_continuity_repair";
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
  priorPacket.openQuestions = [
    {
      id: "T-001",
      section: "scope",
      question: "Who can see the summaries?",
      options: ["Internal only", "Everyone"],
    },
  ];
  priorPacket.findings = [
    {
      id: "F-001",
      kind: "gap",
      sev: "blocker",
      section: "scope",
      ref: "T-001",
      text: "Visibility scope is unresolved.",
      resolved: false,
      raisedBy: "semantix",
    },
  ];
  priorPacket.contextSources = [
    {
      id: "CS-001",
      kind: "user",
      summary: "User asked for observation summaries.",
      status: "used",
      evidenceRefs: ["u1"],
    },
  ];
  priorPacket.groundedFacts = [
    {
      id: "GF-001",
      source: "user",
      text: "The request is about observation summaries.",
      confidence: "high",
      evidenceRef: "u1",
    },
  ];

  const nextPacket = JSON.parse(buildReadyPacketJson(sessionId, 1));
  nextPacket.requirements = [];
  nextPacket.findings = [];
  nextPacket.contextSources = [];
  nextPacket.groundedFacts = [];
  nextPacket.userDecisions = [];

  const result = parseEvaluatorOutput(sessionId, 1, JSON.stringify(nextPacket), {
    sessionId,
    trigger: "user_turn",
    userTurn: {
      id: "u2",
      body: { kind: "choice", picked: "OPT-001", label: "Internal only", questionTurnId: "T-001" },
    },
    currentPacket: priorPacket,
    decisions: [],
  });

  assert.equal(result.packet.requirements[0].id, "REQ-001");
  assert.equal(result.packet.findings[0].id, "F-001");
  assert.equal(result.packet.findings[0].resolved, true);
  assert.equal(result.packet.groundedFacts[0].id, "GF-001");
  assert.equal(result.packet.contextSources[0].id, "CS-001");
  assert.equal(result.packet.userDecisions[0].turnId, "u2");
  const continuity = checkIdContinuity({ priorPacket, nextPacket: result.packet });
  assert.equal(continuity.ok, true, JSON.stringify(continuity.violations));
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput repairs invalid LLM supersession and records the user choice", () => {
  const sessionId = "spec_invalid_supersession_repair";
  const priorPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  priorPacket.nextTurn = {
    id: "T-CHOICE-001",
    side: "semantix",
    at: "2026-05-01T00:00:00.000Z",
    phase: "socratic",
    target: "scope",
    body: {
      kind: "question",
      q: "Who can see observation summaries?",
      options: [
        { id: "OPT-001", label: "Internal only", tag: "recommend" },
        { id: "OPT-002", label: "Everyone" },
      ],
    },
  };
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
  priorPacket.findings = [
    {
      id: "F-001",
      kind: "gap",
      sev: "blocker",
      section: "scope",
      ref: "T-CHOICE-001",
      text: "Visibility scope is unresolved.",
      resolved: false,
      raisedBy: "semantix",
    },
  ];

  const nextPacket = JSON.parse(buildReadyPacketJson(sessionId, 1));
  nextPacket.requirements = [
    {
      ...priorPacket.requirements[0],
      status: "superseded",
    },
  ];
  nextPacket.findings = [];
  nextPacket.userDecisions = [];

  const result = parseEvaluatorOutput(sessionId, 1, JSON.stringify(nextPacket), {
    sessionId,
    trigger: "user_turn",
    userTurn: {
      id: "u2",
      body: { kind: "choice", picked: "OPT-001", label: "Internal only" },
    },
    currentPacket: priorPacket,
    decisions: [],
  });

  assert.equal(result.packet.source, "semantix");
  assert.equal(result.packet.readiness, "ready");
  assert.equal(result.packet.nextTurn, null);
  assert.equal(result.packet.requirements[0].id, "REQ-001");
  assert.equal(result.packet.requirements[0].status, "proposed");
  assert.equal(result.packet.findings[0].id, "F-001");
  assert.equal(result.packet.findings[0].resolved, true);
  assert.equal(result.packet.userDecisions.length, 1);
  assert.equal(result.packet.userDecisions[0].turnId, "u2");
  assert.equal(result.packet.userDecisions[0].question, "Who can see observation summaries?");
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  const continuity = checkIdContinuity({ priorPacket, nextPacket: result.packet });
  assert.equal(continuity.ok, true, JSON.stringify(continuity.violations));
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

test("parseEvaluatorOutput converts same-id requirement mutations into valid supersession", () => {
  const sessionId = "spec_requirement_mutation_repair";
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
  nextPacket.requirements = [
    {
      ...priorPacket.requirements[0],
      text: "Show observation summaries to internal users only.",
      acceptance: "Internal users can see summaries.",
    },
  ];
  const result = parseEvaluatorOutput(sessionId, 1, JSON.stringify(nextPacket), {
    sessionId,
    trigger: "user_turn",
    currentPacket: priorPacket,
  });

  const superseded = result.packet.requirements.find((requirement) => requirement.id === "REQ-001");
  const replacement = result.packet.requirements.find((requirement) => requirement.id === superseded.supersededBy);
  assert.equal(superseded.status, "superseded");
  assert.equal(superseded.supersededBy, "REQ-002");
  assert.equal(replacement.id, "REQ-002");
  assert.equal(replacement.text, "Show observation summaries to internal users only.");
  assert.equal(replacement.acceptance, "Internal users can see summaries.");
  assert.notEqual(replacement.id, superseded.id);
  const continuity = checkIdContinuity({ priorPacket, nextPacket: result.packet });
  assert.equal(continuity.ok, true, JSON.stringify(continuity.violations));
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput preserves mutated finding history and mints a new finding id", () => {
  const sessionId = "spec_finding_mutation_repair";
  const priorPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  priorPacket.findings = [
    {
      id: "F-001",
      kind: "gap",
      sev: "blocker",
      section: "scope",
      ref: "T-001",
      text: "Visibility scope is unresolved.",
      resolved: false,
      raisedBy: "semantix",
    },
  ];
  const nextPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 1));
  nextPacket.findings = [
    {
      ...priorPacket.findings[0],
      text: "Placement is unresolved.",
      ref: "T-002",
    },
  ];
  const result = parseEvaluatorOutput(sessionId, 1, JSON.stringify(nextPacket), {
    sessionId,
    trigger: "user_turn",
    currentPacket: priorPacket,
  });

  assert.ok(result.packet.findings.some((finding) => finding.id === "F-001"));
  const replacement = result.packet.findings.find((finding) => finding.id !== "F-001");
  assert.equal(replacement.id, "F-002");
  assert.equal(replacement.text, "Placement is unresolved.");
  assert.equal(replacement.ref, "T-002");
  const continuity = checkIdContinuity({ priorPacket, nextPacket: result.packet });
  assert.equal(continuity.ok, true, JSON.stringify(continuity.violations));
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("parseEvaluatorOutput preserves mutated grounded fact history and mints a new fact id", () => {
  const sessionId = "spec_grounded_fact_mutation_repair";
  const priorPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  priorPacket.groundedFacts = [
    {
      id: "GF-001",
      source: "user",
      text: "The user requested observation summaries.",
      confidence: "high",
      evidenceRef: "u1",
    },
  ];
  const nextPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 1));
  nextPacket.groundedFacts = [
    {
      id: "GF-001",
      source: "user",
      text: "The user requested notes app search.",
      confidence: "high",
      evidenceRef: "u2",
    },
  ];

  const result = parseEvaluatorOutput(sessionId, 1, JSON.stringify(nextPacket), {
    sessionId,
    trigger: "user_turn",
    currentPacket: priorPacket,
    userTurn: {
      id: "u2",
      body: { kind: "free", text: "Search should match note title and body." },
    },
  });

  assert.equal(result.packet.groundedFacts[0].id, "GF-001");
  assert.equal(result.packet.groundedFacts[0].text, "The user requested observation summaries.");
  const replacement = result.packet.groundedFacts.find((fact) => fact.id !== "GF-001");
  assert.equal(replacement.id, "GF-002");
  assert.equal(replacement.text, "The user requested notes app search.");
  const continuity = checkIdContinuity({ priorPacket, nextPacket: result.packet });
  assert.equal(continuity.ok, true, JSON.stringify(continuity.violations));
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
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

test("parseEvaluatorOutput reports truncated packet-shaped output as malformed JSON", () => {
  const rawText = buildNeedsUserPacketJson("spec_truncated_json", 0).slice(0, -1);
  assert.throws(
    () => parseEvaluatorOutput("spec_truncated_json", 0, rawText, { sessionId: "spec_truncated_json", trigger: "initial" }),
    /malformed JSON output/,
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

test("createLlmSpecStudioEvaluator does not force a non-Codex model by default", async () => {
  const previousSpecModel = process.env.SEMANTIX_SPEC_STUDIO_MODEL;
  const previousCodexModel = process.env.SEMANTIX_CODEX_MODEL;
  delete process.env.SEMANTIX_SPEC_STUDIO_MODEL;
  delete process.env.SEMANTIX_CODEX_MODEL;
  try {
    const sessionId = "spec_llm_default_model";
    const calls = [];
    const connector = {
      execute: async (opts) => {
        calls.push(opts);
        return { exitCode: 0, stdout: buildNeedsUserPacketJson(sessionId, 0), stderr: "" };
      },
    };
    const evaluator = createLlmSpecStudioEvaluator({ connector });

    await evaluator({
      sessionId,
      trigger: "initial",
      userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
      decisions: [],
      findings: [],
      contextResponses: [],
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].model, undefined);
  } finally {
    if (previousSpecModel === undefined) {
      delete process.env.SEMANTIX_SPEC_STUDIO_MODEL;
    } else {
      process.env.SEMANTIX_SPEC_STUDIO_MODEL = previousSpecModel;
    }
    if (previousCodexModel === undefined) {
      delete process.env.SEMANTIX_CODEX_MODEL;
    } else {
      process.env.SEMANTIX_CODEX_MODEL = previousCodexModel;
    }
  }
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
  assert.equal(result.llmResponses.length, 1);
  assert.equal(result.llmResponses[0].attempt, 1);
  assert.equal(result.llmResponses[0].stdout, packetJson);
  assert.match(result.llmResponses[0].rawText, /Build a notes app/);
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("createLlmSpecStudioEvaluator retries when the LLM returns a generic repaired clarification", async () => {
  const sessionId = "spec_llm_retry_generic_clarification";
  const badPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  badPacket.originalUserRequest = "<string>";
  badPacket.alignedRequirement = "<string>";
  badPacket.openQuestions = [];
  badPacket.nextTurn = {
    id: "<string>",
    side: "semantix",
    at: "<string>",
    phase: "clarification",
    target: "scope",
    body: { kind: "question", q: "What additional information is needed?" },
  };
  const goodPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  goodPacket.originalUserRequest = "Add an invoice approval dashboard.";
  goodPacket.alignedRequirement = "Add an invoice approval dashboard; approval roles need confirmation.";
  goodPacket.nextTurn = {
    id: "T-APPROVAL-ROLES-001",
    side: "semantix",
    at: "2026-05-01T00:00:00.000Z",
    phase: "socratic",
    target: "scope",
    body: {
      kind: "question",
      q: "Which roles should be allowed to approve invoices from the dashboard?",
      options: [
        { id: "OPT-MANAGERS", label: "Managers only" },
        { id: "OPT-FINANCE", label: "Finance approvers" },
      ],
    },
  };
  const calls = [];
  const connector = {
    execute: async ({ input }) => {
      calls.push(input);
      return {
        exitCode: 0,
        stdout: JSON.stringify(calls.length === 1 ? badPacket : goodPacket),
        stderr: "",
      };
    },
  };
  const evaluator = createLlmSpecStudioEvaluator({
    connector,
    maxClarificationRetries: 1,
  });

  const result = await evaluator({
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Add an invoice approval dashboard." } },
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.equal(calls.length, 2);
  assert.match(calls[1], /previous output was rejected/i);
  assert.match(calls[1], /concrete, user-facing clarifying questions/i);
  assert.equal(result.llmResponses.length, 2);
  assert.equal(result.llmResponses[0].attempt, 1);
  assert.match(result.llmResponses[0].retryReason, /next_turn_question_missing_text|generic clarification|visible clarifying question/i);
  assert.equal(result.llmResponses[1].attempt, 2);
  assert.match(result.llmResponses[1].rawText, /Which roles should be allowed/);
  assert.equal(result.events[0].kind, "llm.evaluator.corrective_retry");
  assert.equal(result.events[1].kind, "llm.evaluator.initial");
  assert.equal(result.packet.nextTurn.body.q, "Which roles should be allowed to approve invoices from the dashboard?");
});

test("createLlmSpecStudioEvaluator gives needs_user/no-question packets an extra targeted retry", async () => {
  const sessionId = "spec_llm_retry_missing_question_extra";
  const badPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  badPacket.openQuestions = [];
  badPacket.blockingReasons = [
    { id: "BR-AUDIENCE", text: "Target audience is still unresolved." },
  ];
  badPacket.findings = [
    {
      id: "F-AUDIENCE",
      kind: "gap",
      sev: "blocker",
      section: "stakeholders",
      ref: "u1",
      text: "Target audience is missing.",
      resolved: false,
      raisedBy: "semantix",
    },
  ];
  badPacket.nextTurn.body = { kind: "question" };

  const goodPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  goodPacket.nextTurn = {
    id: "T-AUDIENCE-001",
    side: "semantix",
    at: "2026-05-01T00:00:00.000Z",
    phase: "socratic",
    target: "stakeholders",
    body: {
      kind: "question",
      q: "Who is the primary audience for the security posture platform?",
      options: [
        { id: "OPT-SOC", label: "SOC analysts" },
        { id: "OPT-CISO", label: "Security leaders" },
      ],
    },
  };

  const calls = [];
  const connector = {
    execute: async ({ input }) => {
      calls.push(input);
      return {
        exitCode: 0,
        stdout: JSON.stringify(calls.length < 3 ? badPacket : goodPacket),
        stderr: "",
      };
    },
  };
  const evaluator = createLlmSpecStudioEvaluator({
    connector,
    maxClarificationRetries: 1,
    maxMissingQuestionRetries: 1,
  });

  const result = await evaluator({
    sessionId,
    trigger: "user_turn",
    currentPacket: JSON.parse(buildNeedsUserPacketJson(sessionId, 0)),
    userTurn: { id: "u2", body: { kind: "free", text: "Risk Posture Studio" } },
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.equal(calls.length, 3);
  assert.match(calls[2], /Discrepancy detected/i);
  assert.match(calls[2], /Target audience is still unresolved/i);
  assert.equal(result.llmResponses.length, 3);
  assert.equal(result.events[0].kind, "llm.evaluator.corrective_retry");
  assert.equal(result.events[1].kind, "llm.evaluator.corrective_retry");
  assert.equal(result.events[2].kind, "llm.evaluator.user_turn");
  assert.equal(
    result.packet.nextTurn.body.q,
    "Who is the primary audience for the security posture platform?",
  );
  assert.equal(isDegradedPacket(result.packet), false);
  assert.equal(result.turnLogEntry.sessionId, sessionId);
  assert.equal(result.turnLogEntry.trigger, "user_turn");
  assert.equal(result.turnLogEntry.diagnostics.llmAttemptCount, 3);
  assert.equal(result.turnLogEntry.diagnostics.correctiveRetryCount, 2);
  assert.equal(result.turnLogEntry.diagnostics.discrepancy.kind, "needs_user_without_answerable_question");
  assert.equal(result.turnLogEntry.beginningScores.alignment.value, 20);
  assert.equal(result.turnLogEntry.afterTurnScores.alignment.value, 20);
  assert.ok(result.turnLogEntry.afterTurnScores.effort.value > 0);
  assert.deepEqual(result.turnLogEntry.answersSubmitted, [
    {
      id: "T-001",
      question: "Is this a new system or an update?",
      answer: "Risk Posture Studio",
    },
  ]);
  assert.deepEqual(result.turnLogEntry.questionsNowOpen.map((question) => question.question), [
    "Who is the primary audience for the security posture platform?",
  ]);
  assert.ok(result.turnLogEntry.learnings.some((learning) => /Discrepancy/.test(learning)));
});

test("createLlmSpecStudioEvaluator degrades rather than showing generic clarification after retries", async () => {
  const sessionId = "spec_llm_reject_generic_after_retry";
  const badPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  badPacket.originalUserRequest = "<string>";
  badPacket.alignedRequirement = "<string>";
  badPacket.openQuestions = [];
  badPacket.nextTurn = {
    id: "<string>",
    side: "semantix",
    at: "<string>",
    phase: "clarification",
    target: "scope",
    body: { kind: "question", q: "What additional information is needed?" },
  };
  const connector = mockConnector([
    { exitCode: 0, stdout: JSON.stringify(badPacket), stderr: "" },
    { exitCode: 0, stdout: JSON.stringify(badPacket), stderr: "" },
  ]);
  const evaluator = createLlmSpecStudioEvaluator({
    connector,
    maxClarificationRetries: 1,
  });

  const result = await evaluator({
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.ok(isDegradedPacket(result.packet));
  assert.equal(result.events[0].kind, "llm.evaluator.degraded");
  assert.match(result.events[0].payload.reason, /next_turn_question_missing_text|low-quality clarification/i);
  assert.equal(result.llmResponses.length, 2);
  assert.match(result.llmResponses[1].rawText, /What additional information is needed/);
  assert.equal(result.packet.nextTurn, null);
});

test("createLlmSpecStudioEvaluator repairs placeholder nextTurn from openQuestions", async () => {
  const sessionId = "spec_llm_placeholder_next_turn_degraded";
  const badPacket = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  badPacket.originalUserRequest = "<string>";
  delete badPacket.alignedRequirement;
  badPacket.openQuestions = [
    {
      id: "Q-STORAGE",
      section: "scope",
      question: "Where should notes be stored?",
      options: ["Local browser storage", "Cloud sync"],
    },
  ];
  badPacket.nextTurn = {
    id: "<string>",
    side: "semantix",
    at: "<string>",
    phase: "clarification",
    target: "scope",
    body: { kind: "question", q: "<string>" },
  };
  const connector = mockConnector([
    { exitCode: 0, stdout: JSON.stringify(badPacket), stderr: "" },
    { exitCode: 0, stdout: JSON.stringify(badPacket), stderr: "" },
  ]);
  const evaluator = createLlmSpecStudioEvaluator({
    connector,
    maxClarificationRetries: 1,
  });

  const result = await evaluator({
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.equal(isDegradedPacket(result.packet), false);
  assert.equal(result.events[0].kind, "llm.evaluator.initial");
  assert.equal(result.llmResponses.length, 1);
  assert.equal(result.packet.nextTurn.body.q, "Where should notes be stored?");
  assert.deepEqual(result.packet.nextTurn.body.options, [
    { id: "OPT-001", label: "Local browser storage" },
    { id: "OPT-002", label: "Cloud sync" },
  ]);
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

test("createLlmSpecStudioEvaluator degrades honestly on empty LLM output by default", async () => {
  const sessionId = "spec_llm_empty_output_degraded";
  const connector = mockConnector([{ exitCode: 0, stdout: "", stderr: "" }]);
  const evaluator = createLlmSpecStudioEvaluator({ connector });

  const result = await evaluator({
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.equal(result.packet.readiness, "needs_user");
  assert.equal(result.packet.originalUserRequest, "Build a notes app.");
  assert.equal(isDegradedPacket(result.packet), true);
  assert.ok(
    result.packet.findings.some((finding) => /LLM evaluator returned empty output/i.test(finding.text)),
  );
  assert.equal(result.events[0].kind, "llm.evaluator.degraded");
  assert.equal(result.llmResponses.length, 2);
  assert.equal(result.llmResponses[0].stdout, "");
  assert.equal(result.llmResponses[0].rawText, "");
  assert.match(result.events[0].payload.reason, /model=codex-default/);
  assert.match(result.events[0].payload.reason, /stdoutBytes=0/);
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

test("createLlmSpecStudioEvaluator degrades without connector call on empty initial request", async () => {
  const sessionId = "spec_llm_empty_initial";
  let calls = 0;
  const connector = {
    execute: async () => {
      calls += 1;
      return { exitCode: 0, stdout: buildReadyPacketJson(sessionId, 0), stderr: "" };
    },
  };
  const evaluator = createLlmSpecStudioEvaluator({ connector });

  const result = await evaluator({
    sessionId,
    trigger: "initial",
    originalUserRequest: "",
    userTurn: { id: "u1", body: { kind: "text", text: "   " } },
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.equal(calls, 0);
  assert.equal(result.packet.readiness, "needs_user");
  assert.equal(result.packet.originalUserRequest, "");
  assert.equal(result.packet.nextTurn, null);
  assert.equal(result.packet.findings[0].id, "F-DEGRADED-001");
  assert.match(result.packet.findings[0].text, /initial request is empty/i);
  assert.equal(result.events[0].kind, "llm.evaluator.degraded");
  assert.equal(isDegradedPacket(result.packet), true);
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

test("createLlmSpecStudioEvaluator parses first packet from multi-record stdout", async () => {
  const sessionId = "spec_llm_jsonl_stdout";
  const packetJson = buildNeedsUserPacketJson(sessionId, 0);
  const stdout = `${packetJson}\n{"type":"usage","tokens":123}`;
  const connector = mockConnector([{ exitCode: 0, stdout, stderr: "" }]);
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

test("createLlmSpecStudioEvaluator parses packet from jsonMessages when stdout is empty", async () => {
  const sessionId = "spec_llm_json_messages";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  const connector = mockConnector([
    {
      exitCode: 0,
      stdout: "",
      stderr: "",
      finalJsonObject: null,
      jsonMessages: [
        { type: "session.started" },
        { type: "message", content: [{ type: "output_text", text: JSON.stringify(packet) }] },
      ],
    },
  ]);
  const evaluator = createLlmSpecStudioEvaluator({ connector });

  const result = await evaluator({
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.equal(result.packet.readiness, "needs_user");
  assert.equal(result.packet.sessionId, sessionId);
  assert.equal(isDegradedPacket(result.packet), false);
});

test("createLlmSpecStudioEvaluator parses packet from alternate output text fields", async () => {
  const sessionId = "spec_llm_output_text_field";
  const packetJson = buildNeedsUserPacketJson(sessionId, 0);
  const connector = mockConnector([
    {
      exitCode: 0,
      stdout: "",
      stderr: "",
      outputText: packetJson,
    },
  ]);
  const evaluator = createLlmSpecStudioEvaluator({ connector });

  const result = await evaluator({
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.equal(result.packet.readiness, "needs_user");
  assert.equal(result.packet.sessionId, sessionId);
  assert.equal(isDegradedPacket(result.packet), false);
});

test("createLlmSpecStudioEvaluator prefers finalJsonObject over noisy semantix stdout metadata", async () => {
  const sessionId = "spec_llm_final_json_priority";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  const connector = mockConnector([
    {
      exitCode: 0,
      stdout: JSON.stringify({ source: "semantix", event: "log", message: "starting" }),
      stderr: "",
      finalJsonObject: packet,
    },
  ]);
  const evaluator = createLlmSpecStudioEvaluator({ connector });

  const result = await evaluator({
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.equal(result.packet.readiness, "needs_user");
  assert.equal(result.packet.sessionId, sessionId);
  assert.equal(isDegradedPacket(result.packet), false);
});

test("createLlmSpecStudioEvaluator accepts direct packet objects from alternate connectors", async () => {
  const sessionId = "spec_llm_direct_packet";
  const packet = JSON.parse(buildNeedsUserPacketJson(sessionId, 0));
  const connector = mockConnector([packet]);
  const evaluator = createLlmSpecStudioEvaluator({ connector });

  const result = await evaluator({
    sessionId,
    trigger: "initial",
    userTurn: { id: "u1", body: { kind: "text", text: "Build a notes app." } },
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.equal(result.packet.readiness, "needs_user");
  assert.equal(result.packet.sessionId, sessionId);
  assert.equal(isDegradedPacket(result.packet), false);
});
