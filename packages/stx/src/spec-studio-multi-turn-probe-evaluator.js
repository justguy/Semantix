import { CONTRACT_VERSION, SOURCE_SEMANTIX } from "./spec-studio-contracts.js";

const AT = "2026-04-30T00:00:00.000Z";
const ORIGINAL_REQUEST = "Build an expense reporting app";

function basePacket(sessionId, iteration, originalUserRequest) {
  return {
    contractVersion: CONTRACT_VERSION,
    source: SOURCE_SEMANTIX,
    sessionId,
    iteration,
    originalUserRequest: originalUserRequest || ORIGINAL_REQUEST,
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
  };
}

function needsUserPacket(sessionId, iteration, originalUserRequest, {
  alignmentPct,
  openConcerns = 0,
  openBlockers = 0,
  readinessReason,
  nextTurn,
  existingSystemContext,
  findings = [],
}) {
  return {
    ...basePacket(sessionId, iteration, originalUserRequest),
    readiness: "needs_user",
    readinessReason,
    existingSystemContext: existingSystemContext ?? { mode: "unknown" },
    findings,
    coverage: { alignmentPct, sections: [], openBlockers, openConcerns, openFYI: 0 },
    nextTurn,
  };
}

function readyPacket(sessionId, iteration, originalUserRequest) {
  return {
    ...basePacket(sessionId, iteration, originalUserRequest),
    readiness: "ready",
    readinessReason: "All gaps resolved; spec is aligned and ready for planning.",
    blockingReasons: [],
    approvalRequired: true,
    alignedRequirement: "Expense reporting app: new system, end-user primary, auth deferred.",
    requirements: [
      {
        id: "REQ-001",
        type: "functional",
        text: "Users can submit expense reports.",
        priority: "must",
        sourceRef: "T-MT-Q3",
        acceptance: "Expense submission form is present and functional.",
        status: "confirmed",
      },
      {
        id: "REQ-002",
        type: "functional",
        text: "Users can track approval status of submitted reports.",
        priority: "must",
        sourceRef: "T-MT-Q3",
        acceptance: "Approval status is visible to the submitting user after submission.",
        status: "confirmed",
      },
      {
        id: "REQ-003",
        type: "constraint",
        text: "Authentication is deferred to a later sprint.",
        priority: "should",
        sourceRef: "T-MT-Q5",
        acceptance: "Auth deferral is acknowledged in sprint planning notes.",
        status: "confirmed",
      },
    ],
    scope: {
      inScope: ["Expense report submission", "Approval status tracking"],
      outOfScope: ["Authentication (deferred to later sprint)"],
      negativeRequirements: [],
    },
    existingSystemContext: { mode: "new" },
    acceptanceSummary: [
      "User can submit an expense report.",
      "User can view the approval status of their submission.",
      "Authentication is explicitly deferred.",
    ],
    findings: [
      {
        id: "FND-AUTH-001",
        kind: "gap",
        sev: "blocker",
        section: "constraints",
        ref: "T-MT-Q4",
        text: "Authentication decision was unresolved; deferred by user confirmation.",
        resolved: true,
        raisedBy: "semantix",
      },
    ],
    coverage: { alignmentPct: 100, sections: [], openBlockers: 0, openConcerns: 0, openFYI: 0 },
    nextTurn: null,
  };
}

function question(id, phase, target, q, options) {
  return {
    id,
    side: "semantix",
    at: AT,
    phase,
    target,
    body: { kind: "question", q, ...(options ? { options } : {}) },
  };
}

function evt(kind, sessionId, iteration) {
  return { id: `evt_mt_${kind}_${sessionId}_${iteration}`, kind: `probe.mt.${kind}` };
}

export function createSpecStudioMultiTurnProbeEvaluator() {
  return function evaluate(request) {
    const sessionId = request.sessionId;
    const prior = request.currentPacket ?? null;
    const iteration = (prior?.iteration ?? -1) + 1;
    const originalUserRequest = prior?.originalUserRequest || request.originalUserRequest || ORIGINAL_REQUEST;
    const priorTurnId = prior?.nextTurn?.id ?? null;
    const trigger = request.trigger;
    const turnBody = request.userTurn?.body;

    // T0: initial → Q1 (new vs update)
    if (trigger === "initial") {
      return {
        packet: needsUserPacket(sessionId, 0, originalUserRequest, {
          alignmentPct: 20,
          openConcerns: 4,
          readinessReason: "System type, user type, core action, and auth approach are all undefined.",
          nextTurn: question("T-MT-Q1", "socratic", "intent",
            "Is this a new system or updating an existing one?",
            [
              { id: "OPT-NEW", label: "New system" },
              { id: "OPT-UPDATE", label: "Updating existing" },
            ],
          ),
        }),
        events: [evt("initial", sessionId, 0)],
        contextRequests: [],
      };
    }

    // T1: answered Q1 → Q2 (user type)
    if (priorTurnId === "T-MT-Q1" && trigger === "user_turn" && turnBody?.kind === "choice") {
      const mode = turnBody.picked === "OPT-NEW" ? "new" : "existing";
      return {
        packet: needsUserPacket(sessionId, iteration, originalUserRequest, {
          alignmentPct: 35,
          openConcerns: 3,
          readinessReason: "User type and core action are still undefined.",
          existingSystemContext: { mode },
          nextTurn: question("T-MT-Q2", "socratic", "users",
            "Who is the primary user of this system?",
            [
              { id: "OPT-ADMIN", label: "Admin / operator" },
              { id: "OPT-END-USER", label: "End user" },
              { id: "OPT-BOTH", label: "Both admin and end user" },
            ],
          ),
        }),
        events: [evt("q1-answered", sessionId, iteration)],
        contextRequests: [],
      };
    }

    // T2: answered Q2 → Q3 (core action, free text)
    if (priorTurnId === "T-MT-Q2" && trigger === "user_turn" && turnBody?.kind === "choice") {
      return {
        packet: needsUserPacket(sessionId, iteration, originalUserRequest, {
          alignmentPct: 50,
          openConcerns: 3,
          readinessReason: "Core user action and auth approach are still undefined.",
          existingSystemContext: prior.existingSystemContext,
          nextTurn: question("T-MT-Q3", "socratic", "intent",
            "Describe the core action the user needs to accomplish in this system.",
          ),
        }),
        events: [evt("q2-answered", sessionId, iteration)],
        contextRequests: [],
      };
    }

    // T3: answered Q3 (free text) → Q4 (auth, choice)
    if (priorTurnId === "T-MT-Q3" && trigger === "user_turn" && (turnBody?.kind === "free" || turnBody?.kind === "text")) {
      return {
        packet: needsUserPacket(sessionId, iteration, originalUserRequest, {
          alignmentPct: 65,
          openConcerns: 2,
          readinessReason: "Auth approach and data ownership gaps remain.",
          existingSystemContext: prior.existingSystemContext,
          nextTurn: question("T-MT-Q4", "crisp", "constraints",
            "Do you have an existing authentication system to integrate with?",
            [
              { id: "OPT-AUTH-YES", label: "Yes — integrate with existing auth" },
              { id: "OPT-AUTH-NO", label: "No — build auth from scratch" },
              { id: "OPT-AUTH-SKIP", label: "Skip / decide later" },
            ],
          ),
        }),
        events: [evt("q3-answered", sessionId, iteration)],
        contextRequests: [],
      };
    }

    // T4: skipped Q4 (auth) → Q5 (confirm defer, blocker raised)
    if (priorTurnId === "T-MT-Q4" && trigger === "skip") {
      return {
        packet: needsUserPacket(sessionId, iteration, originalUserRequest, {
          alignmentPct: 65,
          openBlockers: 1,
          openConcerns: 1,
          readinessReason: "Auth was skipped — deferral must be explicitly confirmed to resolve blocker.",
          existingSystemContext: prior.existingSystemContext,
          findings: [
            {
              id: "FND-AUTH-001",
              kind: "gap",
              sev: "blocker",
              section: "constraints",
              ref: "T-MT-Q4",
              text: "Authentication decision is unresolved.",
              resolved: false,
              raisedBy: "semantix",
            },
          ],
          nextTurn: question("T-MT-Q5", "crisp", "constraints",
            "Auth was skipped. Confirm this is deferred to a later sprint.",
            [
              { id: "OPT-DEFER-CONFIRM", label: "Confirmed — defer auth to a later sprint" },
              { id: "OPT-DEFER-REJECT", label: "No — I will answer the auth question now" },
            ],
          ),
        }),
        events: [evt("q4-skipped", sessionId, iteration)],
        contextRequests: [],
      };
    }

    // T5a: confirmed defer → ready
    if (priorTurnId === "T-MT-Q5" && trigger === "user_turn" && turnBody?.kind === "choice" && turnBody.picked === "OPT-DEFER-CONFIRM") {
      return {
        packet: readyPacket(sessionId, iteration, originalUserRequest),
        events: [evt("q5-defer-confirmed", sessionId, iteration)],
        contextRequests: [],
      };
    }

    // T5b: rejected defer → loop back to Q4
    if (priorTurnId === "T-MT-Q5" && trigger === "user_turn" && turnBody?.kind === "choice" && turnBody.picked === "OPT-DEFER-REJECT") {
      return {
        packet: needsUserPacket(sessionId, iteration, originalUserRequest, {
          alignmentPct: 65,
          openConcerns: 2,
          readinessReason: "Auth decision still required.",
          existingSystemContext: prior.existingSystemContext,
          nextTurn: question("T-MT-Q4", "crisp", "constraints",
            "Do you have an existing authentication system to integrate with?",
            [
              { id: "OPT-AUTH-YES", label: "Yes — integrate with existing auth" },
              { id: "OPT-AUTH-NO", label: "No — build auth from scratch" },
              { id: "OPT-AUTH-SKIP", label: "Skip / decide later" },
            ],
          ),
        }),
        events: [evt("q5-defer-rejected", sessionId, iteration)],
        contextRequests: [],
      };
    }

    // Fallback: unexpected state — preserve prior context
    return {
      packet: needsUserPacket(sessionId, iteration, originalUserRequest, {
        alignmentPct: prior?.coverage?.alignmentPct ?? 0,
        openConcerns: 1,
        readinessReason: "Unexpected turn state in multi-turn probe.",
        existingSystemContext: prior?.existingSystemContext ?? { mode: "unknown" },
        nextTurn: prior?.nextTurn ?? null,
      }),
      events: [evt("unexpected", sessionId, iteration)],
      contextRequests: [],
    };
  };
}
