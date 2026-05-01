import { CONTRACT_VERSION, SOURCE_SEMANTIX } from "./spec-studio-contracts.js";

const AT = "2026-04-30T00:00:00.000Z";
const ORIGINAL_REQUEST = "Build an expense reporting app";

// Keywords in free text that signal a reference to existing infrastructure.
const EXISTING_INFRA_PATTERN = /\b(existing|legacy|current|sap|erp|oracle|salesforce)\b/i;

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

function needsUser(sessionId, iteration, originalUserRequest, {
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

function readyPacket(sessionId, iteration, originalUserRequest, { mode, coreAction, findings = [] }) {
  const isIntegration = mode === "new-integration";
  return {
    ...basePacket(sessionId, iteration, originalUserRequest),
    readiness: "ready",
    readinessReason: "All gaps and contradictions resolved; spec is aligned.",
    blockingReasons: [],
    approvalRequired: true,
    alignedRequirement: isIntegration
      ? "New expense reporting app integrating with existing backend infrastructure."
      : "Update to existing expense reporting system.",
    requirements: [
      {
        id: "REQ-001",
        type: "functional",
        text: "End users can submit expense reports.",
        priority: "must",
        sourceRef: "T-BATCH-Q2",
        acceptance: "Expense submission form is present and functional.",
        status: "confirmed",
      },
      {
        id: "REQ-002",
        type: "functional",
        text: "Approval routing integrates with existing backend infrastructure.",
        priority: "must",
        sourceRef: "T-BATCH-Q3",
        acceptance: "Approval requests are dispatched to the existing API on submission.",
        status: "confirmed",
      },
      {
        id: "REQ-003",
        type: "constraint",
        text: "System must be delivered by Q2 2026.",
        priority: "must",
        sourceRef: "T-BATCH-Q1",
        acceptance: "Feature-complete build delivered before end of Q2 2026.",
        status: "confirmed",
      },
    ],
    scope: {
      inScope: ["Expense report submission", "Approval routing via existing infrastructure"],
      outOfScope: ["Building a new auth or approval engine from scratch"],
      negativeRequirements: [],
    },
    existingSystemContext: { mode: isIntegration ? "new" : "existing" },
    acceptanceSummary: [
      "User can submit an expense report.",
      "Approval routing delegates to existing backend.",
      "Delivered Q2 2026.",
    ],
    findings: findings.map((f) => ({ ...f, resolved: true })),
    coverage: { alignmentPct: 100, sections: [], openBlockers: 0, openConcerns: 0, openFYI: 0 },
    nextTurn: null,
  };
}

function batchTurn(id, phase, target, questions) {
  return { id, side: "semantix", at: AT, phase, target, body: { kind: "batch", questions } };
}

function questionTurn(id, phase, target, q, options) {
  return { id, side: "semantix", at: AT, phase, target, body: { kind: "question", q, ...(options ? { options } : {}) } };
}

function evt(kind, sessionId, iteration) {
  return { id: `evt_batch_${kind}_${sessionId}_${iteration}`, kind: `probe.batch.${kind}` };
}

export function createSpecStudioBatchProbeEvaluator() {
  return function evaluate(request) {
    const sessionId = request.sessionId;
    const prior = request.currentPacket ?? null;
    const iteration = (prior?.iteration ?? -1) + 1;
    const originalUserRequest = prior?.originalUserRequest || request.originalUserRequest || ORIGINAL_REQUEST;
    const priorTurnId = prior?.nextTurn?.id ?? null;
    const trigger = request.trigger;
    const turnBody = request.userTurn?.body;

    // T0: initial → batch of 3 independent gaps
    if (trigger === "initial") {
      return {
        packet: needsUser(sessionId, 0, originalUserRequest, {
          alignmentPct: 10,
          openConcerns: 4,
          readinessReason: "System type, user type, and timeline are all undefined; surfacing all three at once.",
          nextTurn: batchTurn("T-BATCH-Q1", "socratic", "intent", [
            {
              id: "Q-SYSTEM-TYPE",
              q: "Is this a new system or updating an existing one?",
              options: [
                { id: "OPT-NEW", label: "New system" },
                { id: "OPT-UPDATE", label: "Updating existing" },
              ],
            },
            {
              id: "Q-USER-TYPE",
              q: "Who is the primary user of this system?",
              options: [
                { id: "OPT-ADMIN", label: "Admin / operator" },
                { id: "OPT-END-USER", label: "End user" },
                { id: "OPT-BOTH", label: "Both admin and end user" },
              ],
            },
            {
              id: "Q-TIMELINE",
              q: "What is the target delivery timeline?",
              options: [
                { id: "OPT-Q1", label: "Q1 2026" },
                { id: "OPT-Q2", label: "Q2 2026" },
                { id: "OPT-Q3", label: "Q3 2026" },
                { id: "OPT-UNKNOWN", label: "Not yet decided" },
              ],
            },
          ]),
        }),
        events: [evt("initial", sessionId, 0)],
        contextRequests: [],
      };
    }

    // T1: batch answers → ask for free-text core action description
    if (priorTurnId === "T-BATCH-Q1" && trigger === "user_turn" && turnBody?.kind === "batch") {
      const answers = turnBody.answers ?? [];
      const systemAnswer = answers.find((a) => a.questionId === "Q-SYSTEM-TYPE");
      const mode = systemAnswer?.picked === "OPT-NEW" ? "new" : "existing";

      return {
        packet: needsUser(sessionId, iteration, originalUserRequest, {
          alignmentPct: 65,
          openConcerns: 1,
          readinessReason: "Core workflow description still needed before spec can be aligned.",
          existingSystemContext: { mode },
          nextTurn: questionTurn(
            "T-BATCH-Q2",
            "socratic",
            "intent",
            "Describe the core workflow the user needs to complete in this system.",
          ),
        }),
        events: [evt("batch-answered", sessionId, iteration)],
        contextRequests: [],
      };
    }

    // T2: free text — detect contradiction against prior system-type answer
    if (priorTurnId === "T-BATCH-Q2" && trigger === "user_turn" && (turnBody?.kind === "free" || turnBody?.kind === "text")) {
      const declaredMode = prior.existingSystemContext?.mode ?? "unknown";
      const text = turnBody.text ?? "";
      const referencesExisting = EXISTING_INFRA_PATTERN.test(text);
      const contradicts = declaredMode === "new" && referencesExisting;

      if (contradicts) {
        return {
          packet: needsUser(sessionId, iteration, originalUserRequest, {
            alignmentPct: 45,
            openBlockers: 1,
            openConcerns: 0,
            readinessReason: "Free-text description contradicts the declared system type; prior system-type alignment is invalidated until reconciled.",
            existingSystemContext: prior.existingSystemContext,
            findings: [
              {
                id: "FND-CONTRA-001",
                kind: "contradiction",
                sev: "blocker",
                section: "intent",
                ref: "T-BATCH-Q2",
                text: "Description references existing infrastructure but system type was declared as 'new'.",
                resolved: false,
                raisedBy: "semantix",
              },
            ],
            nextTurn: questionTurn(
              "T-BATCH-Q3",
              "adversarial",
              "intent",
              "Your description references existing infrastructure, but you indicated this is a new system. How do you want to reconcile this?",
              [
                { id: "OPT-NEW-WITH-INTEGRATION", label: "New app that integrates with existing infrastructure" },
                { id: "OPT-UPDATE-EXISTING", label: "Actually updating an existing system" },
              ],
            ),
          }),
          events: [evt("contradiction-detected", sessionId, iteration)],
          contextRequests: [],
        };
      }

      // No contradiction — advance to ready directly
      return {
        packet: readyPacket(sessionId, iteration, originalUserRequest, { mode: declaredMode, coreAction: text }),
        events: [evt("workflow-answered", sessionId, iteration)],
        contextRequests: [],
      };
    }

    // T3: reconcile contradiction
    if (priorTurnId === "T-BATCH-Q3" && trigger === "user_turn" && turnBody?.kind === "choice") {
      const mode = turnBody.picked === "OPT-NEW-WITH-INTEGRATION" ? "new-integration" : "existing";
      const priorFindings = prior.findings ?? [];
      return {
        packet: readyPacket(sessionId, iteration, originalUserRequest, { mode, findings: priorFindings }),
        events: [evt("contradiction-resolved", sessionId, iteration)],
        contextRequests: [],
      };
    }

    // Fallback
    return {
      packet: needsUser(sessionId, iteration, originalUserRequest, {
        alignmentPct: prior?.coverage?.alignmentPct ?? 0,
        openConcerns: 1,
        readinessReason: "Unexpected turn state in batch probe.",
        existingSystemContext: prior?.existingSystemContext ?? { mode: "unknown" },
        nextTurn: prior?.nextTurn ?? null,
      }),
      events: [evt("unexpected", sessionId, iteration)],
      contextRequests: [],
    };
  };
}
