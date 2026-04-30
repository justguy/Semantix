/**
 * Verbatim transcription of the upstream Semantix Spec Studio sample packets.
 *
 * Source: docs/phalanx-spec-studio-integration-contract.md
 * - Greenfield Ready: lines 716-784
 * - Update Ready With Existing-System Context: lines 791-872
 * - Ambiguous New-vs-Update Needs User: lines 877-952
 * - Replacement Or Duplicate Without Approval Blocked: lines 957-1011
 * - Hoplon-Grounded Update: lines 1015-1094
 * - Degraded Sample: lines 647-705
 *
 * These fixtures are kept verbatim so the contract validator can be regression
 * tested against the agreed upstream packet semantics.
 */

export const greenfieldReadyPacket = {
  contractVersion: "semantix.phalanx.spec-studio.v1",
  source: "semantix",
  sessionId: "spec_greenfield_ready",
  iteration: 4,
  readiness: "ready",
  readinessReason: "All must-level scope, success, and boundary questions are answered.",
  blockingReasons: [],
  approvalRequired: true,
  originalUserRequest: "Build a notes app with markdown support.",
  alignedRequirement:
    "Build a new notes app that lets users create, edit, delete, search, and preview markdown notes locally.",
  requirements: [
    {
      id: "REQ-001",
      type: "functional",
      text: "Users can create, edit, delete, and search notes.",
      priority: "must",
      sourceRef: "dec_001",
      acceptance: "A user can complete CRUD and search flows from the UI.",
      status: "confirmed",
    },
    {
      id: "REQ-002",
      type: "functional",
      text: "Users can preview markdown formatting before saving.",
      priority: "must",
      sourceRef: "dec_002",
      acceptance:
        "Markdown syntax renders in a preview state for headings, lists, links, and code blocks.",
      status: "confirmed",
    },
  ],
  flow: {
    pages: [
      {
        id: "PAGE-001",
        name: "Notes workspace",
        purpose: "Create, edit, search, and preview notes.",
        sourceRef: "REQ-001",
      },
    ],
    states: [],
    transitions: [],
    dataNeeded: [],
  },
  scope: {
    inScope: ["New local notes application", "Markdown preview"],
    outOfScope: ["Cloud sync", "Multi-user collaboration"],
    negativeRequirements: [],
  },
  assumptions: [],
  openQuestions: [],
  risks: [],
  userDecisions: [],
  acceptanceSummary: ["CRUD, search, and markdown preview work locally."],
  existingSystemContext: {
    mode: "new",
  },
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

export const updateReadyPacket = {
  contractVersion: "semantix.phalanx.spec-studio.v1",
  source: "semantix",
  sessionId: "spec_update_ready",
  iteration: 7,
  readiness: "ready",
  readinessReason: "The target surface, reuse constraints, and non-change boundaries are confirmed.",
  blockingReasons: [],
  approvalRequired: true,
  originalUserRequest: "Add email verification to the existing signup flow.",
  alignedRequirement:
    "Update the existing web signup flow to require email verification before onboarding completion.",
  requirements: [
    {
      id: "REQ-001",
      type: "functional",
      text: "After password signup, user sees a check-email state.",
      priority: "must",
      sourceRef: "dec_002",
      acceptance:
        "Signup redirects to check-email and account remains unverified until verification.",
      status: "confirmed",
    },
    {
      id: "REQ-002",
      type: "negative",
      text: "Do not modify billing code.",
      priority: "must",
      sourceRef: "dec_003",
      acceptance: "No changed files under billing paths.",
      status: "confirmed",
    },
    {
      id: "REQ-003",
      type: "constraint",
      text: "Reuse the existing email sender.",
      priority: "must",
      sourceRef: "FACT-001",
      acceptance:
        "The implementation calls the existing email sender instead of adding a new dependency.",
      status: "confirmed",
    },
  ],
  flow: {
    pages: [],
    states: [
      {
        id: "STATE-001",
        name: "Check email",
        description: "Post-signup state shown until the verification link is used.",
        sourceRef: "REQ-001",
      },
    ],
    transitions: [],
    dataNeeded: [],
  },
  scope: {
    inScope: ["Web signup flow", "Verification email send", "Verified account state"],
    outOfScope: ["OAuth signup behavior", "Billing code"],
    negativeRequirements: [
      "Do not modify billing code.",
      "Do not alter OAuth signup behavior.",
    ],
  },
  existingSystemContext: {
    mode: "update",
    systemName: "auth-gateway",
    targetSurfaces: [
      {
        id: "surf_signup",
        kind: "ui-flow",
        name: "Signup flow",
      },
    ],
    doNotChange: ["OAuth signup behavior", "billing code"],
    reuseRequirements: ["Reuse existing email sender"],
  },
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

export const ambiguousNeedsUserPacket = {
  contractVersion: "semantix.phalanx.spec-studio.v1",
  source: "semantix",
  sessionId: "spec_ambiguous_surface",
  iteration: 1,
  readiness: "needs_user",
  readinessReason:
    "Semantix cannot determine whether this is new functionality or an update to an existing surface.",
  blockingReasons: [
    {
      id: "BR-001",
      text: "Target surface is ambiguous.",
    },
  ],
  approvalRequired: true,
  originalUserRequest: "Add a better run dashboard.",
  alignedRequirement: "",
  requirements: [],
  flow: {
    pages: [],
    states: [],
    transitions: [],
    dataNeeded: [],
  },
  scope: {
    inScope: [],
    outOfScope: [],
    negativeRequirements: [],
  },
  existingSystemContext: {
    mode: "unknown",
  },
  openQuestions: [
    {
      id: "Q-001",
      section: "scope",
      question: "Should this update the existing Run View, or create a new dashboard?",
      options: [
        "Update existing Run View",
        "Create a new dashboard",
        "Not sure",
      ],
    },
  ],
  findings: [
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
  ],
  coverage: {
    alignmentPct: 42,
    sections: [],
    openBlockers: 1,
    openConcerns: 0,
    openFYI: 0,
  },
  nextTurn: {
    id: "t_sem_001",
    side: "semantix",
    at: "2026-04-30T00:00:00.000Z",
    phase: "crisp",
    target: "scope",
    body: {
      kind: "question",
      q: "Should this update an existing Phalanx surface or create a new one?",
      options: [
        { id: "opt_existing", label: "Update existing Run View", tag: "recommend" },
        { id: "opt_new", label: "Create a new dashboard", tag: "risk" },
        { id: "opt_unknown", label: "Not sure", tag: "neutral" },
      ],
      offers: ["free", "dontknow"],
    },
  },
};

export const replacementBlockedPacket = {
  contractVersion: "semantix.phalanx.spec-studio.v1",
  source: "semantix",
  sessionId: "spec_duplicate_blocked",
  iteration: 2,
  readiness: "blocked",
  readinessReason:
    "The request appears to duplicate or replace an existing surface without explicit approval.",
  blockingReasons: [
    {
      id: "BR-001",
      text: "Replacement of existing Run View requires explicit user approval and migration boundary.",
    },
  ],
  approvalRequired: true,
  originalUserRequest: "Create a new run dashboard instead of the current one.",
  alignedRequirement: "",
  existingSystemContext: {
    mode: "update",
    targetSurfaces: [
      {
        id: "surf_run_view",
        kind: "ui-page",
        name: "Existing Run View",
      },
    ],
  },
  requirements: [],
  scope: {
    inScope: [],
    outOfScope: [],
    negativeRequirements: [],
  },
  findings: [
    {
      id: "F-001",
      kind: "contradiction",
      sev: "blocker",
      section: "boundaries",
      ref: "BND-001",
      text: "Existing Run View is present, but the request asks for a duplicate or replacement without approval.",
      resolved: false,
      raisedBy: "semantix",
    },
  ],
  coverage: {
    alignmentPct: 20,
    sections: [],
    openBlockers: 1,
    openConcerns: 0,
    openFYI: 0,
  },
  nextTurn: null,
};

export const hoplonGroundedPacket = {
  contractVersion: "semantix.phalanx.spec-studio.v1",
  source: "semantix",
  sessionId: "spec_hoplon_grounded",
  iteration: 5,
  readiness: "ready",
  readinessReason: "Hoplon-grounded target surface and reuse boundary are clear.",
  blockingReasons: [],
  approvalRequired: true,
  originalUserRequest: "Add observation summaries to the run dashboard.",
  alignedRequirement:
    "Update the existing Run View right panel to include observation summaries without adding a second panel.",
  requirements: [
    {
      id: "REQ-001",
      type: "constraint",
      text: "Reuse the existing Run View right panel rather than adding a second panel.",
      priority: "must",
      sourceRef: "FACT-001",
      acceptance: "No new duplicate right-panel shell is introduced.",
      status: "confirmed",
    },
    {
      id: "REQ-002",
      type: "functional",
      text: "Show observation summaries in the existing right panel.",
      priority: "must",
      sourceRef: "dec_004",
      acceptance: "The right panel renders observation summary content for a selected run.",
      status: "confirmed",
    },
  ],
  existingSystemContext: {
    mode: "update",
    systemName: "Phalanx Run View",
    targetSurfaces: [
      {
        id: "surf_run_view_right_panel",
        kind: "ui-panel",
        name: "Run View right panel",
      },
    ],
    reuseRequirements: ["Reuse the existing Run View right panel"],
  },
  contextSources: [
    {
      id: "SRC-001",
      kind: "hoplon",
      status: "used",
      query: "Find existing Run View right-panel observation surface.",
      summary: "Hoplon found a current right-panel observation summary component.",
      evidenceRefs: ["hoplon://trace/run-view/right-panel#obs-summary"],
    },
  ],
  groundedFacts: [
    {
      id: "FACT-001",
      source: "hoplon",
      text: "The current Run View already has a right panel that displays observation analysis.",
      confidence: "high",
      evidenceRef: "hoplon://trace/run-view/right-panel#obs-summary",
    },
  ],
  scope: {
    inScope: ["Existing Run View right panel"],
    outOfScope: ["New dashboard shell", "Second right panel"],
    negativeRequirements: ["Do not introduce a duplicate run dashboard."],
  },
  assumptions: [],
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

export const degradedPacket = {
  contractVersion: "semantix.phalanx.spec-studio.v1",
  source: "semantix",
  sessionId: "spec_degraded",
  iteration: 3,
  readiness: "needs_user",
  readinessReason: "Semantix alignment is degraded; lock cannot be trusted.",
  blockingReasons: [
    {
      id: "BR-DEGRADED-001",
      text: "Semantix model or service unavailable.",
    },
  ],
  approvalRequired: true,
  originalUserRequest: "Update the run dashboard with observation summaries.",
  alignedRequirement: "",
  requirements: [],
  flow: {
    pages: [],
    states: [],
    transitions: [],
    dataNeeded: [],
  },
  scope: {
    inScope: [],
    outOfScope: [],
    negativeRequirements: [],
  },
  assumptions: [],
  openQuestions: [],
  risks: [],
  userDecisions: [],
  acceptanceSummary: [],
  existingSystemContext: {
    mode: "unknown",
  },
  contextSources: [],
  groundedFacts: [],
  findings: [
    {
      id: "F-DEGRADED-001",
      kind: "risk",
      sev: "blocker",
      section: "intent",
      ref: "SEMANTIX",
      text: "Alignment review did not complete. Phalanx should not lock or start Staff planning from this packet.",
      resolved: false,
      raisedBy: "semantix",
    },
  ],
  coverage: {
    alignmentPct: 0,
    sections: [],
    openBlockers: 1,
    openConcerns: 0,
    openFYI: 0,
  },
  nextTurn: null,
};

export const upstreamSamplePackets = Object.freeze({
  greenfieldReady: greenfieldReadyPacket,
  updateReady: updateReadyPacket,
  ambiguousNeedsUser: ambiguousNeedsUserPacket,
  replacementBlocked: replacementBlockedPacket,
  hoplonGrounded: hoplonGroundedPacket,
  degraded: degradedPacket,
});
