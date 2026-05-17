import { CONTRACT_VERSION, SOURCE_SEMANTIX } from "./spec-studio-contracts.js";

const PROBE_TURN_TIMESTAMP = "2026-04-30T00:00:00.000Z";
const DOC_GRILL_TURN_TIMESTAMP = "2026-05-16T00:00:00.000Z";
const DOC_GRILL_QUESTION_ID = "T-DOC-GRILL-Q1";
const DOC_GRILL_BLOCKER_ID = "BR-DOC-GRILL-TERM-001";
const DOC_GRILL_FINDING_ID = "F-DOC-GRILL-TERM-001";
const DOC_GRILL_DECISION_ID = "D-DOC-GRILL-TERM-001";

function isDocGrillRequest(originalUserRequest) {
  return /\b(doc[-\s]?grill|documentation grill|grill with docs|terminology|glossary|context docs?|adr|canonical term|overloaded term)\b/i.test(
    originalUserRequest ?? "",
  );
}

function buildDocGrillContext(originalUserRequest) {
  return {
    contextSources: [
      {
        id: "CS-DOC-GRILL-USER-001",
        kind: "user",
        status: "used",
        summary: "User requested a documentation-grill alignment loop before Phase 2 work.",
        evidenceRefs: ["originalUserRequest"],
      },
    ],
    groundedFacts: [
      {
        id: "GF-DOC-GRILL-USER-001",
        source: "user",
        text: "The user wants Semantix to clarify overloaded terminology before Phalanx Staff handoff.",
        evidenceRef: originalUserRequest ? "originalUserRequest" : "user-request",
        confidence: "high",
      },
    ],
  };
}

function buildNeedsUserPacket(sessionId, iteration, originalUserRequest) {
  return {
    contractVersion: CONTRACT_VERSION,
    source: SOURCE_SEMANTIX,
    sessionId,
    iteration,
    readiness: "needs_user",
    readinessReason: "Clarification needed before alignment can be completed.",
    approvalRequired: true,
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

function buildDocGrillNeedsUserPacket(sessionId, iteration, originalUserRequest) {
  const context = buildDocGrillContext(originalUserRequest);
  return {
    contractVersion: CONTRACT_VERSION,
    source: SOURCE_SEMANTIX,
    sessionId,
    iteration,
    readiness: "needs_user",
    readinessReason: "Terminology conflict must be resolved before Spec Studio can lock a grounded artifact.",
    blockingReasons: [
      {
        id: DOC_GRILL_BLOCKER_ID,
        text: "The term \"project\" is overloaded between Phalanx run state and the repository/workspace being changed.",
      },
    ],
    approvalRequired: true,
    originalUserRequest,
    alignedRequirement: "",
    requirements: [],
    flow: { pages: [], states: [], transitions: [], dataNeeded: [] },
    scope: { inScope: [], outOfScope: [], negativeRequirements: [] },
    assumptions: [],
    openQuestions: [
      {
        id: "Q-DOC-GRILL-TERM-001",
        section: "scope",
        question: "Which canonical meaning should Semantix use for \"project\" in this alignment?",
        options: [
          "Phalanx project/run record",
          "Repository/workspace",
          "Both, but distinct",
        ],
      },
    ],
    risks: [],
    userDecisions: [],
    acceptanceSummary: [],
    existingSystemContext: { mode: "update" },
    contextSources: context.contextSources,
    groundedFacts: context.groundedFacts,
    findings: [
      {
        id: DOC_GRILL_FINDING_ID,
        kind: "gap",
        sev: "blocker",
        section: "scope",
        ref: DOC_GRILL_QUESTION_ID,
        text: "The canonical meaning of \"project\" is unresolved for the Phalanx handoff.",
        resolved: false,
        raisedBy: "semantix",
      },
    ],
    coverage: {
      alignmentPct: 55,
      sections: [],
      openBlockers: 1,
      openConcerns: 0,
      openFYI: 0,
    },
    nextTurn: {
      id: DOC_GRILL_QUESTION_ID,
      side: "semantix",
      at: DOC_GRILL_TURN_TIMESTAMP,
      phase: "adversarial",
      target: "scope",
      body: {
        kind: "question",
        q: "When you say \"project\" here, should Semantix treat it as the Phalanx project/run record or the repository/workspace being changed?",
        ctx: "The term is overloaded across Phalanx routing, tracker state, and repo context. Resolve the canonical meaning before Staff handoff.",
        options: [
          {
            id: "OPT-PHALANX-PROJECT",
            label: "Phalanx project/run record",
            description: "Use this when the decision should bind Phalanx run state, tracker metadata, and Spec Studio session identity.",
            tag: "recommend",
          },
          {
            id: "OPT-REPO-WORKSPACE",
            label: "Repository/workspace",
            description: "Use this when the decision should bind the codebase or filesystem target being modified.",
          },
          {
            id: "OPT-BOTH-DISTINCT",
            label: "Both, but distinct",
            description: "Use two canonical terms and keep them separate in the locked packet.",
            tag: "neutral",
          },
        ],
      },
    },
  };
}

function buildDocGrillReadyPacket(sessionId, iteration, originalUserRequest, userTurn) {
  const context = buildDocGrillContext(originalUserRequest);
  const picked = userTurn?.body?.picked ?? "OPT-PHALANX-PROJECT";
  const label = userTurn?.body?.label ?? "Phalanx project/run record";
  const canonicalTerm =
    picked === "OPT-REPO-WORKSPACE"
      ? "repository/workspace"
      : picked === "OPT-BOTH-DISTINCT"
        ? "Phalanx project/run record and repository/workspace as distinct terms"
        : "Phalanx project/run record";

  return {
    contractVersion: CONTRACT_VERSION,
    source: SOURCE_SEMANTIX,
    sessionId,
    iteration,
    readiness: "ready",
    readinessReason: "The overloaded term has a canonical meaning and the doc-grill boundary is explicit.",
    blockingReasons: [],
    approvalRequired: true,
    originalUserRequest,
    alignedRequirement:
      "Use Semantix in Phalanx Spec Studio as a structured documentation-grill gate that resolves overloaded domain terms before Staff handoff.",
    requirements: [
      {
        id: "REQ-DOC-GRILL-001",
        type: "functional",
        text: "Semantix must challenge vague or overloaded domain terms against grounded Phalanx context before lock.",
        priority: "must",
        sourceRef: DOC_GRILL_QUESTION_ID,
        acceptance: "An ambiguous term produces a blocking Semantix question with options and rationale before the packet can lock.",
        status: "confirmed",
      },
      {
        id: "REQ-DOC-GRILL-002",
        type: "constraint",
        text: `The canonical meaning of "project" for this packet is ${canonicalTerm}.`,
        priority: "must",
        sourceRef: DOC_GRILL_DECISION_ID,
        acceptance: "The locked packet preserves the canonical term in requirements, decisions, and grounded facts.",
        status: "confirmed",
      },
      {
        id: "REQ-DOC-GRILL-003",
        type: "negative",
        text: "Do not mutate CONTEXT.md, ADR files, or repository documentation from the Spec Studio evaluator before the artifact is locked.",
        priority: "must",
        sourceRef: "grill-with-docs-boundary",
        acceptance: "Spec Studio records the terminology decision in the packet first; repository documentation changes remain explicit downstream work.",
        status: "confirmed",
      },
    ],
    flow: { pages: [], states: [], transitions: [], dataNeeded: [] },
    scope: {
      inScope: [
        "Semantix-led terminology challenge in Phalanx Spec Studio",
        "Preserving user-selected canonical terms in the alignment packet",
      ],
      outOfScope: [
        "Automatic repository documentation edits before lock",
        "Default Phalanx pipeline launch changes",
      ],
      negativeRequirements: [
        "Do not treat documentation updates as Staff execution authority.",
        "Do not launch a Phalanx run from the Semantix evaluator.",
      ],
    },
    assumptions: [],
    openQuestions: [],
    risks: [],
    userDecisions: [
      {
        id: DOC_GRILL_DECISION_ID,
        turnId: userTurn?.id ?? DOC_GRILL_QUESTION_ID,
        section: "scope",
        questionRef: DOC_GRILL_QUESTION_ID,
        question:
          'When you say "project" here, should Semantix treat it as the Phalanx project/run record or the repository/workspace being changed?',
        kind: "choice",
        answer: { optionId: picked, label, canonicalTerm },
        at: DOC_GRILL_TURN_TIMESTAMP,
        optionId: picked,
        label,
      },
    ],
    acceptanceSummary: [
      "The terminology blocker is resolved.",
      "Spec Studio can lock only after the user-selected canonical term is recorded.",
    ],
    existingSystemContext: {
      mode: "update",
      targetSurfaces: [
        {
          id: "surf_spec_studio_alignment_loop",
          kind: "ui-panel",
          name: "Phalanx Spec Studio alignment loop",
        },
      ],
      doNotChange: [
        "Do not change default Phalanx pipeline launch flow from this Semantix evaluation.",
        "Do not mutate repository documentation before SpecArtifact lock.",
      ],
      reuseRequirements: [
        "Reuse the existing live:semantix Spec Studio evaluatorSource transport.",
      ],
      compatibilityRequirements: [
        "Continue accepting fixture and degraded evaluator sources for existing sessions.",
      ],
    },
    contextSources: context.contextSources,
    groundedFacts: [
      ...context.groundedFacts,
      {
        id: "GF-DOC-GRILL-TERM-001",
        source: "user",
        text: `The selected canonical meaning for "project" is ${canonicalTerm}.`,
        evidenceRef: DOC_GRILL_DECISION_ID,
        confidence: "high",
      },
    ],
    findings: [
      {
        id: DOC_GRILL_FINDING_ID,
        kind: "gap",
        sev: "blocker",
        section: "scope",
        ref: DOC_GRILL_QUESTION_ID,
        text: "The canonical meaning of \"project\" is unresolved for the Phalanx handoff.",
        resolved: true,
        resolvedAt: DOC_GRILL_TURN_TIMESTAMP,
        raisedBy: "semantix",
        resolutionDecisionId: DOC_GRILL_DECISION_ID,
      },
    ],
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
      if (isDocGrillRequest(originalUserRequest)) {
        return {
          packet: buildDocGrillNeedsUserPacket(sessionId, 0, originalUserRequest),
          events: [event("doc_grill_initial", sessionId, 0)],
          contextRequests: [],
        };
      }

      return {
        packet: buildNeedsUserPacket(sessionId, 0, originalUserRequest),
        events: [event("initial", sessionId, 0)],
        contextRequests: [],
      };
    }

    if (request.trigger === "user_turn" && request.userTurn?.body?.kind === "choice") {
      if (isDocGrillRequest(originalUserRequest)) {
        return {
          packet: buildDocGrillReadyPacket(sessionId, iteration, originalUserRequest, request.userTurn),
          events: [event("doc_grill_choice", sessionId, iteration)],
          contextRequests: [],
        };
      }

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
