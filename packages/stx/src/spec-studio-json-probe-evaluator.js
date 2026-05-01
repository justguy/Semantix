import { CONTRACT_VERSION, SOURCE_SEMANTIX } from "./spec-studio-contracts.js";

const PROBE_TURN_TIMESTAMP = "2026-04-30T00:00:00.000Z";

function buildNeedsUserPacket(sessionId, iteration, originalUserRequest) {
  return {
    contractVersion: CONTRACT_VERSION,
    source: SOURCE_SEMANTIX,
    sessionId,
    iteration,
    readiness: "needs_user",
    readinessReason: "Clarification needed before alignment can be completed.",
    originalUserRequest,
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
    coverage: {
      alignmentPct: 40,
      sections: [],
      openBlockers: 0,
      openConcerns: 1,
      openFYI: 0,
    },
    nextTurn: {
      id: "T-PROBE-Q1",
      side: "semantix",
      at: PROBE_TURN_TIMESTAMP,
      phase: "socratic",
      target: "intent",
      body: {
        kind: "question",
        q: "Is this a new system or updating an existing one?",
        options: [
          { id: "OPT-NEW", label: "New system" },
          { id: "OPT-UPDATE", label: "Updating existing" },
        ],
      },
    },
  };
}

function buildReadyPacket(sessionId, iteration, originalUserRequest) {
  return {
    contractVersion: CONTRACT_VERSION,
    source: SOURCE_SEMANTIX,
    sessionId,
    iteration,
    readiness: "ready",
    readinessReason: "User confirmed system type; probe discussion loop complete.",
    blockingReasons: [],
    approvalRequired: true,
    originalUserRequest,
    alignedRequirement: "Probe complete: system type confirmed.",
    requirements: [],
    flow: { pages: [], states: [], transitions: [], dataNeeded: [] },
    scope: { inScope: ["Probe verified"], outOfScope: [], negativeRequirements: [] },
    assumptions: [],
    openQuestions: [],
    risks: [],
    userDecisions: [],
    acceptanceSummary: ["JSON probe discussion loop completed."],
    existingSystemContext: { mode: "new" },
    contextSources: [],
    groundedFacts: [],
    findings: [],
    coverage: {
      alignmentPct: 100,
      sections: [],
      openBlockers: 0,
      openConcerns: 0,
      openFYI: 0,
    },
    nextTurn: null,
  };
}

function event(kind, sessionId, iteration) {
  return {
    id: `evt_probe_${kind}_${sessionId}_${iteration}`,
    kind: `probe.${kind}`,
  };
}

export function createSpecStudioJsonProbeEvaluator() {
  const evaluate = function evaluate(request) {
    const sessionId = request.sessionId;
    const priorPacket = request.currentPacket ?? null;
    const iteration = (priorPacket?.iteration ?? -1) + 1;
    const originalUserRequest = priorPacket?.originalUserRequest ?? request.originalUserRequest ?? "";

    if (request.trigger === "initial") {
      return {
        packet: buildNeedsUserPacket(sessionId, 0, originalUserRequest),
        events: [event("initial", sessionId, 0)],
        contextRequests: [],
      };
    }

    if (request.trigger === "user_turn" && request.userTurn?.body?.kind === "choice") {
      return {
        packet: buildReadyPacket(sessionId, iteration, originalUserRequest),
        events: [event("choice", sessionId, iteration)],
        contextRequests: [],
      };
    }

    // All other turns: return needs_user (skip, delegate, reconsider, free, text, context_response)
    return {
      packet: buildNeedsUserPacket(sessionId, iteration, originalUserRequest),
      events: [event("turn", sessionId, iteration)],
      contextRequests: [],
    };
  };
  evaluate.evaluatorMode = "probe";
  return evaluate;
}
