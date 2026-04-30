# Semantix to Phalanx Spec Studio Integration Contract

Status: draft
Owner: Semantix side of the integration
Target consumer: Project Phalanx Spec Studio and Staff planning flow

## Purpose

This document defines what Semantix needs from Phalanx and what Semantix returns during the Spec Studio pre-build phase.

Spec Studio is an interactive alignment surface. The user starts with a fuzzy requirement, Semantix reviews it, asks targeted questions, identifies gaps and contradictions, incorporates user answers, and eventually produces a locked, user-approved spec artifact. Phalanx Staff consumes that locked artifact as authoritative requirement context before architecture and task breakdown begin.

Semantix does not replace Staff. Semantix owns user alignment and requirement normalization. Staff owns architecture, decomposition, implementation planning, and execution.

## Integration Boundary

Semantix owns:

- Interpreting the user's raw directive.
- Detecting ambiguity, missing acceptance criteria, contradictions, assumptions, risks, and negative requirements.
- Asking follow-up questions in a chat-like loop.
- Suggesting options while accepting free-text answers.
- Re-evaluating the evolving spec after each user turn.
- Producing a typed alignment packet and, at lock time, a normalized spec artifact.

Phalanx owns:

- The Spec Studio UX shell and persistence.
- User/session/auth context.
- Existing-system context retrieval.
- Hoplon and repo/tool access.
- Spec lock ceremony and immutable artifact storage.
- Staff planning, feature decomposition, execution, audit, and integration map.

## Capability Matrix

| Capability | Semantix support | Phalanx dependency | Notes |
|---|---|---|---|
| Alignment packet generation | Supported | Phalanx supplies session state and user input | Semantix can emit a strict `SemantixAlignmentPacket` for each evaluation turn. |
| Stable requirement IDs | Supported with state | Phalanx must pass prior packet and decisions | Semantix can preserve and supersede IDs when prior IDs are included in the evaluation request. |
| Stable finding IDs | Supported with state | Phalanx must persist findings | Semantix can resolve/reopen/supersede findings, but cannot recover omitted historical IDs. |
| Stable decision IDs | Phalanx-owned | Phalanx creates and persists decisions | Semantix may propose decision semantics, but Phalanx should mint the canonical decision IDs. |
| `existingSystemContext.mode = new` | Supported | Optional context improves quality | Semantix can proceed when scope, boundaries, and acceptance are clear. |
| `existingSystemContext.mode = update` | Supported | Requires existing-system facts | Semantix should gate readiness on target surface, reuse boundaries, do-not-change rules, and compatibility constraints. |
| `existingSystemContext.mode = unknown` | Supported | User/context clarification required | Semantix must return `needs_user`, not `ready`, when it cannot tell whether work is new or an update. |
| Context request generation | Supported | Phalanx brokers tools | Semantix emits typed requests. Phalanx decides whether to query Hoplon, repo indexes, uploaded artifacts, traces, or other tools. |
| Hoplon-grounded facts | Supported as inputs | Phalanx/Hoplon provide evidence refs | Hoplon facts become `groundedFacts`; they do not become spec authority by themselves. |
| Grounded facts separate from assumptions/recommendations | Supported | Schema validation should enforce this | `groundedFacts` hold evidence-backed facts only. Semantix interpretation belongs in assumptions, risks, findings, recommendations, or requirements. |
| `readiness = ready` | Supported | Phalanx recomputes lock eligibility | Semantix can recommend ready; Phalanx remains the lock authority. |
| `readiness = needs_user` | Supported | UI must prompt for input | Used for ambiguity, missing target surface, missing acceptance, unknown new-vs-update, or unresolved non-blocking decisions. |
| `readiness = blocked` | Supported | UI must show blocker and prevent lock | Used for contradictions, impossible constraints, unsafe replacement/duplication, or policy conflicts. |
| Degraded Semantix behavior | Partially supported | Phalanx must emit fallback if Semantix is unreachable | If Semantix returns a degraded response it should block lock. If the service is unreachable, Phalanx should create the degraded envelope. |
| Staff handoff | Supported as packet output | Phalanx locks artifact and invokes Staff | Staff must consume the locked `SpecArtifact` or derived handoff packet after user approval, not live chat state. |

## Required User Flow

1. User opens Spec Studio and enters a primary directive.
2. Phalanx creates a mutable spec session and sends Semantix the initial requirement plus available context.
3. Semantix responds with:
   - current alignment packet
   - next Semantix turn
   - findings
   - section coverage deltas
   - readiness
4. User answers by selecting an option or entering free text.
5. Phalanx appends the user turn and asks Semantix to re-evaluate the full current session state.
6. Semantix returns updated findings, decisions, sections, coverage, and next turn.
7. Loop continues until Semantix reports readiness `ready`.
8. User explicitly locks the spec.
9. Phalanx mints an immutable `SpecArtifact`.
10. Phalanx starts a run from the locked artifact. Staff reads the artifact, not the raw transcript.

## Readiness Semantics

Semantix readiness is a gate. Phalanx must not silently proceed to Staff planning when readiness is not `ready`.

```ts
type Readiness = "ready" | "needs_user" | "blocked";
```

Readiness meanings:

- `ready`: Semantix believes the spec is sufficiently aligned for lock, there are zero blocker findings, every required section is covered, negative requirements are preserved, and all must-level requirements have acceptance criteria.
- `needs_user`: Semantix needs user clarification, confirmation, or a decision before lock.
- `blocked`: Semantix found a contradiction, impossible constraint, missing target surface, unsafe scope ambiguity, or policy conflict that cannot be resolved without changing the request.

Lock requirements:

- readiness is `ready`
- alignment percent is 100
- open blocker count is 0
- user explicitly clicks lock
- backend recomputes coverage and blockers before accepting lock

## Core Packet

Semantix should return a packet with this minimum shape on every evaluation turn.

```ts
export type SemantixAlignmentPacket = {
  contractVersion: 1;
  source: "semantix";
  sessionId: string;
  iteration: number;
  readiness: Readiness;
  blockingReasons: BlockingReason[];

  originalUserRequest: string;
  alignedRequirement: string;

  requirements: RequirementFact[];
  flow: FlowFacts;

  inScope: string[];
  outOfScope: string[];
  assumptions: Assumption[];
  openQuestions: OpenQuestion[];
  risks: Risk[];
  userDecisions: UserDecision[];
  acceptanceSummary: string[];

  existingSystemContext: ExistingSystemContext;
  contextSources: ContextSource[];
  groundedFacts: GroundedFact[];

  findings: Finding[];
  coverage: CoverageState;
  nextTurn: SemantixTurn | null;
};
```

## Requirement Facts

Requirements must be stable, individually addressable facts. Staff should be able to map them into `feature_checklist`, `feature_puzzle`, `verify_command`, and `decision_log`.

```ts
export type RequirementFact = {
  id: string; // "REQ-001"
  type:
    | "functional"
    | "nonfunctional"
    | "constraint"
    | "negative"
    | "acceptance"
    | "integration";
  text: string;
  priority: "must" | "should" | "could";
  sourceRef: string; // user turn id, decision id, section id, flow node, uploaded doc ref
  acceptance: string;
  status: "proposed" | "confirmed" | "contested" | "superseded";
  supersededBy?: string;
};
```

Invariants:

- Keep original user wording in `originalUserRequest`.
- Preserve negative requirements as first-class `type: "negative"` entries.
- Do not collapse multiple requirements into one broad item.
- Do not invent acceptance criteria without marking the source as assumption or Semantix recommendation.
- Stable IDs must not be reused after reconsideration. Supersede instead.

## Flow Facts

If the user's request or supplied HTML/spec describes screens, states, transitions, or data dependencies, Semantix must expose them structurally.

```ts
export type FlowFacts = {
  pages: FlowPage[];
  states: FlowState[];
  transitions: FlowTransition[];
  dataNeeded: DataNeed[];
};

export type FlowPage = {
  id: string;
  name: string;
  purpose: string;
  sourceRef: string;
};

export type FlowState = {
  id: string;
  name: string;
  pageId?: string;
  description: string;
  sourceRef: string;
};

export type FlowTransition = {
  id: string;
  from: string;
  to: string;
  trigger: string;
  guard?: string;
  result: string;
  sourceRef: string;
};

export type DataNeed = {
  id: string;
  name: string;
  consumerRef: string;
  requiredFor: string;
  knownSource?: string;
  unresolved: boolean;
};
```

## Existing System Context

For update work, Semantix must not assume a greenfield build. Phalanx should provide existing-system context whenever available.

```ts
export type ExistingSystemContext = {
  mode: "new" | "update" | "unknown";
  systemName?: string;
  currentBehavior?: string;
  targetSurfaces: TargetSurface[];
  knownFiles: KnownFile[];
  existingFlows: ExistingFlow[];
  existingConstraints: string[];
  doNotChange: string[];
  reuseRequirements: string[];
  compatibilityRequirements: string[];
  migrationConcerns: string[];
  observedProblems: string[];
  referenceArtifacts: ReferenceArtifact[];
};
```

Update-mode readiness rules:

- If `mode` is `unknown`, readiness cannot be `ready`.
- If the target surface is unclear, readiness must be `needs_user`.
- If the user asks to replace or duplicate existing behavior without explicit approval, readiness must be `blocked` or `needs_user`.
- Reuse and do-not-change boundaries must become requirement facts.

## Context Sources and Grounded Facts

Semantix should separate grounded facts from interpretation.

```ts
export type ContextSource = {
  id: string;
  kind: "user" | "html" | "spec" | "phalanx" | "hoplon" | "repo" | "trace" | "upload";
  status: "used" | "unavailable" | "skipped";
  query?: string;
  summary: string;
  evidenceRefs: string[];
};

export type GroundedFact = {
  id: string; // "FACT-001"
  source: "user" | "html" | "spec" | "phalanx" | "hoplon" | "repo" | "trace" | "upload";
  text: string;
  confidence: "high" | "medium" | "low";
  evidenceRef: string;
};
```

Semantix interpretations belong in `assumptions`, `risks`, `recommendations`, or `findings`, not `groundedFacts`.

## Tool Context Requested From Phalanx

Semantix may ask Phalanx for focused context. Phalanx remains the tool broker.

```ts
export type SemantixContextRequest = {
  id: string;
  sessionId: string;
  iteration: number;
  purpose:
    | "identify_target_surface"
    | "summarize_current_behavior"
    | "find_existing_flow"
    | "find_reusable_component"
    | "find_constraints"
    | "collect_hoplon_evidence"
    | "inspect_reference_artifact";
  query: string;
  requestedFrom: Array<"phalanx" | "hoplon" | "repo" | "upload" | "trace">;
  constraints: {
    maxResults?: number;
    targetRepo?: string;
    targetPaths?: string[];
    allowedSources?: Array<"phalanx" | "hoplon" | "repo" | "trace" | "upload">;
    mustReturnEvidenceRefs?: boolean;
  };
  reason: string;
};
```

Example:

```json
{
  "id": "CTX-001",
  "sessionId": "spec_s1",
  "iteration": 2,
  "purpose": "identify_target_surface",
  "query": "Find whether a Run View or dashboard surface already exists for runtime observation summaries.",
  "requestedFrom": ["phalanx", "hoplon", "repo"],
  "constraints": {
    "maxResults": 5,
    "targetRepo": "Project-Phalanx",
    "allowedSources": ["phalanx", "hoplon", "repo"],
    "mustReturnEvidenceRefs": true
  },
  "reason": "The user asked for a dashboard-like update; Semantix must determine whether this is new work or an update."
}
```

Expected context response:

```ts
export type SemantixContextResponse = {
  requestId: string;
  status: "ok" | "empty" | "error";
  facts: GroundedFact[];
  artifacts: ReferenceArtifact[];
  summary: string;
  error?: string;
};
```

Tool guidelines:

- Hoplon is a context acquisition tool, not the source of the spec.
- Phalanx can use Hoplon to provide trace evidence, current behavior, flagged drift, or proof artifacts.
- Semantix must cite Hoplon-derived facts with evidence refs.
- Semantix should ask for more context only when it materially affects readiness.

## Findings

Findings are the single source of truth for what blocks or weakens the spec.

```ts
export type Finding = {
  id: string;
  kind: "gap" | "contradiction" | "assumption" | "risk" | "drift";
  sev: "blocker" | "concern" | "fyi";
  section: SectionId;
  ref: string;
  text: string;
  resolved: boolean;
  resolvedAt?: string;
  active?: boolean;
  raisedBy: "semantix" | "user" | "lint" | "phalanx" | "hoplon";
  trigger?: {
    type: "decision" | "free-text" | "boundary-check" | "context-fact" | "drift-check";
    refId: string;
  };
  resolutionDecisionId?: string;
};
```

Rules:

- Findings cannot be silently dismissed.
- Resolving a finding requires a user decision, a Semantix decision accepted by the user, or an explicit user dismiss action with an audit reason.
- Reconsidering a decision can reopen findings.
- Blocker findings prevent lock.

## Conversation Turns

Semantix turns are chat-like but structured.

```ts
export type SemantixTurn = {
  id: string;
  side: "semantix";
  at: string;
  phase: "crisp" | "socratic" | "adversarial" | "locked";
  target: SectionId;
  live?: boolean;
  findingRef?: string;
  body:
    | {
        kind: "question";
        q: string;
        ctx?: string;
        options?: Option[];
        offers?: Offer[];
      }
    | {
        kind: "finding";
        finding: FindingPayload;
        q?: string;
        options?: Option[];
        offers?: Offer[];
      };
};

export type Option = {
  id: string;
  label: string;
  description?: string;
  tag?: "recommend" | "risk" | "neutral";
};

export type Offer = "decide" | "skip" | "free" | "dontknow";
```

Phalanx should store Semantix and user turns append-only. The collapsed answered-bubble pattern is a frontend rendering choice.

## Decisions

Every answer creates a decision.

```ts
export type UserDecision = {
  id: string;
  turnId: string;
  section: SectionId;
  questionRef: string;
  question: string;
  kind: "choice" | "free" | "decided-by-semantix" | "dismiss";
  answer:
    | { kind: "choice"; optId: string; label: string; tag?: "recommend" | "risk" }
    | { kind: "free"; text: string }
    | { kind: "decided-by-semantix"; optId: string; rationale: string }
    | { kind: "dismiss"; reason: string };
  at: string;
  flagged?: { reviewer: string; reason: string }[];
  supersededBy?: string;
};
```

Decision rules:

- Reconsider creates a new decision and marks the old one superseded.
- User decisions can include free text and may trigger a full re-evaluation.
- `decided-by-semantix` must be flagged for human visibility.
- User dismissals must carry a reason and cannot dismiss hard policy blockers.

## Sections and Coverage

Semantix reports coverage by section, but Phalanx computes lock eligibility server-side.

```ts
export type SectionId =
  | "intent"
  | "scope"
  | "boundaries"
  | "success"
  | "constraints"
  | "assumptions"
  | "stakeholders"
  | "risks"
  | "failure"
  | "nfr";

export type CoverageState = {
  alignmentPct: number;
  sections: SpecSection[];
  openBlockers: number;
  openConcerns: number;
  openFYI: number;
};

export type SpecSection = {
  id: SectionId;
  name: string;
  required: "must" | "should" | "could";
  coverage: number;
  status: "locked" | "covered" | "weak" | "empty";
  annotations: number;
};
```

Coverage rules:

- Coverage is computed, not manually set by the UI.
- A section is `covered` only when all required questions for that section are answered and it has zero open blocker findings.
- The whole spec locks atomically.

## Lock Artifact

At lock time, Phalanx mints an immutable artifact from the latest Semantix alignment packet plus audit state.

```ts
export type SpecArtifact = {
  id: string;
  parentSpecId?: string;
  version: string;
  lockedAt: string;
  lockedBy: { userId: string; email: string };
  iteration: number;
  alignmentPct: 100;

  packet: SemantixAlignmentPacket;

  sections: SpecSection[];
  decisions: UserDecision[];
  findings: Finding[];
  audit: AuditEvent[];

  inputs: {
    primaryDirective: string;
    boundaries: string[];
    successCriteria: string[];
  };

  handoff: {
    targetRepo: string;
    branchHint?: string;
    forbiddenAreas: string[];
    requiredApprovers: string[];
  };
};
```

Immutability rules:

- Locked artifacts are immutable.
- Changes after lock require a child Spec session with `parentSpecId`.
- Drift findings from a run may be appended to a separate audit stream that references the locked artifact, but must not mutate the artifact body.

## Staff Handoff

When starting a Phalanx Run from a locked spec, Staff should receive a compact, explicit context block.

```text
USER-APPROVED SEMANTIX ALIGNMENT PACKET
<SemantixAlignmentPacket JSON>

Use this packet as authoritative requirement context.
Do not reinterpret negative requirements as optional.
Do not proceed beyond inScope boundaries.
Treat outOfScope and handoff.forbiddenAreas as hard constraints.
If readiness is not "ready", stop and request user alignment.
```

Staff may transform the packet into Phalanx's existing design doc fields, but must not discard:

- original user request
- canonical aligned requirement
- stable requirement IDs
- negative requirements
- open assumptions and their source
- success criteria
- flow facts
- existing-system constraints
- forbidden areas
- required approvers

## Drift Detection Contract

Phalanx Run should check planning and execution outputs against the locked spec.

Drift examples:

- Plan proposes work outside `inScope`.
- Plan omits a must-level requirement.
- Planner ignores a negative requirement.
- Execution touches `handoff.forbiddenAreas`.
- Hoplon evidence contradicts a success criterion.
- Staff invents a new target surface not present in the packet.

Drift event:

```ts
export type SpecDriftFinding = {
  id: string;
  specId: string;
  specVersion: string;
  runId: string;
  pieceId?: string;
  requirementRef?: string;
  sectionRef?: SectionId;
  kind: "scope" | "negative_requirement" | "acceptance" | "forbidden_area" | "flow" | "assumption";
  sev: "blocker" | "concern" | "fyi";
  text: string;
  evidenceRefs: string[];
  suggestedAction: "replan" | "fork_spec" | "manual_override";
};
```

Drift handling:

- Blocker drift should stop dispatch or require explicit human override.
- Manual override must be audited.
- Spec amendments after lock require a child Spec session.

## Minimal Phalanx API Needed by Semantix

The exact transport can be REST, WebSocket, tRPC, or internal function calls. The shape matters more than the path.

```http
POST /api/specs
POST /api/specs/:id/turns
POST /api/specs/:id/context-requests
POST /api/specs/:id/decide-all
POST /api/specs/:id/skip
PATCH /api/specs/:id/decisions/:decisionId
POST /api/specs/:id/lock
```

Semantix evaluation request:

```ts
export type SemantixEvaluateRequest = {
  sessionId: string;
  trigger: "initial" | "user_turn" | "reconsider" | "context_response" | "decide_all" | "skip";
  userTurn?: {
    id: string;
    body:
      | { kind: "text"; text: string }
      | { kind: "free"; text: string }
      | { kind: "choice"; picked: string; label: string };
  };
  currentPacket?: SemantixAlignmentPacket;
  decisions: UserDecision[];
  findings: Finding[];
  contextResponses: SemantixContextResponse[];
};
```

Semantix evaluation response:

```ts
export type SemantixEvaluateResponse = {
  packet: SemantixAlignmentPacket;
  events: SpecEvent[];
  contextRequests: SemantixContextRequest[];
};
```

## Degraded and Unavailable Behavior

Semantix degraded states must be visible to the user and must not silently pass into Staff planning.

If Semantix is partially available and can return a packet, it should return:

- `readiness: "needs_user"`
- at least one blocker finding explaining the degradation
- `alignmentPct: 0` unless a prior packet is still valid and explicitly marked stale-safe by Phalanx
- no new requirement facts unless they can be produced from already-validated prior state
- `nextTurn: null` or a turn explaining that alignment cannot continue

If Semantix is fully unreachable, Phalanx should generate the degraded envelope itself. That fallback envelope should be clearly marked with a Phalanx-owned source such as `source: "phalanx-degraded"` and should prevent lock or run start unless a separate explicit bypass policy exists.

Semantix degraded sample:

```json
{
  "contractVersion": "semantix.phalanx.spec-studio.v1",
  "source": "semantix",
  "sessionId": "spec_degraded",
  "iteration": 3,
  "readiness": "needs_user",
  "readinessReason": "Semantix alignment is degraded; lock cannot be trusted.",
  "blockingReasons": [
    {
      "id": "BR-DEGRADED-001",
      "text": "Semantix model or service unavailable."
    }
  ],
  "approvalRequired": true,
  "originalUserRequest": "Update the run dashboard with observation summaries.",
  "alignedRequirement": "",
  "requirements": [],
  "flow": {
    "pages": [],
    "states": [],
    "transitions": [],
    "dataNeeded": []
  },
  "scope": {
    "inScope": [],
    "outOfScope": [],
    "negativeRequirements": []
  },
  "assumptions": [],
  "openQuestions": [],
  "risks": [],
  "userDecisions": [],
  "acceptanceSummary": [],
  "existingSystemContext": {
    "mode": "unknown"
  },
  "contextSources": [],
  "groundedFacts": [],
  "findings": [
    {
      "id": "F-DEGRADED-001",
      "kind": "risk",
      "sev": "blocker",
      "section": "intent",
      "ref": "SEMANTIX",
      "text": "Alignment review did not complete. Phalanx should not lock or start Staff planning from this packet.",
      "resolved": false,
      "raisedBy": "semantix"
    }
  ],
  "coverage": {
    "alignmentPct": 0,
    "sections": [],
    "openBlockers": 1,
    "openConcerns": 0,
    "openFYI": 0
  },
  "nextTurn": null
}
```

## Sample Packets

These examples show intended semantics. They are intentionally compact and omit unchanged optional fields when the example does not depend on them.

### Greenfield Ready

```json
{
  "contractVersion": "semantix.phalanx.spec-studio.v1",
  "source": "semantix",
  "sessionId": "spec_greenfield_ready",
  "iteration": 4,
  "readiness": "ready",
  "readinessReason": "All must-level scope, success, and boundary questions are answered.",
  "blockingReasons": [],
  "approvalRequired": true,
  "originalUserRequest": "Build a notes app with markdown support.",
  "alignedRequirement": "Build a new notes app that lets users create, edit, delete, search, and preview markdown notes locally.",
  "requirements": [
    {
      "id": "REQ-001",
      "type": "functional",
      "text": "Users can create, edit, delete, and search notes.",
      "priority": "must",
      "sourceRef": "dec_001",
      "acceptance": "A user can complete CRUD and search flows from the UI.",
      "status": "confirmed"
    },
    {
      "id": "REQ-002",
      "type": "functional",
      "text": "Users can preview markdown formatting before saving.",
      "priority": "must",
      "sourceRef": "dec_002",
      "acceptance": "Markdown syntax renders in a preview state for headings, lists, links, and code blocks.",
      "status": "confirmed"
    }
  ],
  "flow": {
    "pages": [
      {
        "id": "PAGE-001",
        "name": "Notes workspace",
        "purpose": "Create, edit, search, and preview notes.",
        "sourceRef": "REQ-001"
      }
    ],
    "states": [],
    "transitions": [],
    "dataNeeded": []
  },
  "scope": {
    "inScope": ["New local notes application", "Markdown preview"],
    "outOfScope": ["Cloud sync", "Multi-user collaboration"],
    "negativeRequirements": []
  },
  "assumptions": [],
  "openQuestions": [],
  "risks": [],
  "userDecisions": [],
  "acceptanceSummary": ["CRUD, search, and markdown preview work locally."],
  "existingSystemContext": {
    "mode": "new"
  },
  "contextSources": [],
  "groundedFacts": [],
  "findings": [],
  "coverage": {
    "alignmentPct": 100,
    "sections": [],
    "openBlockers": 0,
    "openConcerns": 0,
    "openFYI": 0
  },
  "nextTurn": null
}
```

### Update Ready With Existing-System Context

```json
{
  "contractVersion": "semantix.phalanx.spec-studio.v1",
  "source": "semantix",
  "sessionId": "spec_update_ready",
  "iteration": 7,
  "readiness": "ready",
  "readinessReason": "The target surface, reuse constraints, and non-change boundaries are confirmed.",
  "blockingReasons": [],
  "approvalRequired": true,
  "originalUserRequest": "Add email verification to the existing signup flow.",
  "alignedRequirement": "Update the existing web signup flow to require email verification before onboarding completion.",
  "requirements": [
    {
      "id": "REQ-001",
      "type": "functional",
      "text": "After password signup, user sees a check-email state.",
      "priority": "must",
      "sourceRef": "dec_002",
      "acceptance": "Signup redirects to check-email and account remains unverified until verification.",
      "status": "confirmed"
    },
    {
      "id": "REQ-002",
      "type": "negative",
      "text": "Do not modify billing code.",
      "priority": "must",
      "sourceRef": "dec_003",
      "acceptance": "No changed files under billing paths.",
      "status": "confirmed"
    },
    {
      "id": "REQ-003",
      "type": "constraint",
      "text": "Reuse the existing email sender.",
      "priority": "must",
      "sourceRef": "FACT-001",
      "acceptance": "The implementation calls the existing email sender instead of adding a new dependency.",
      "status": "confirmed"
    }
  ],
  "flow": {
    "pages": [],
    "states": [
      {
        "id": "STATE-001",
        "name": "Check email",
        "description": "Post-signup state shown until the verification link is used.",
        "sourceRef": "REQ-001"
      }
    ],
    "transitions": [],
    "dataNeeded": []
  },
  "scope": {
    "inScope": ["Web signup flow", "Verification email send", "Verified account state"],
    "outOfScope": ["OAuth signup behavior", "Billing code"],
    "negativeRequirements": ["Do not modify billing code.", "Do not alter OAuth signup behavior."]
  },
  "existingSystemContext": {
    "mode": "update",
    "systemName": "auth-gateway",
    "targetSurfaces": [
      {
        "id": "surf_signup",
        "kind": "ui-flow",
        "name": "Signup flow"
      }
    ],
    "doNotChange": ["OAuth signup behavior", "billing code"],
    "reuseRequirements": ["Reuse existing email sender"]
  },
  "contextSources": [],
  "groundedFacts": [],
  "findings": [],
  "coverage": {
    "alignmentPct": 100,
    "sections": [],
    "openBlockers": 0,
    "openConcerns": 0,
    "openFYI": 0
  },
  "nextTurn": null
}
```

### Ambiguous New-vs-Update Needs User

```json
{
  "contractVersion": "semantix.phalanx.spec-studio.v1",
  "source": "semantix",
  "sessionId": "spec_ambiguous_surface",
  "iteration": 1,
  "readiness": "needs_user",
  "readinessReason": "Semantix cannot determine whether this is new functionality or an update to an existing surface.",
  "blockingReasons": [
    {
      "id": "BR-001",
      "text": "Target surface is ambiguous."
    }
  ],
  "approvalRequired": true,
  "originalUserRequest": "Add a better run dashboard.",
  "alignedRequirement": "",
  "requirements": [],
  "flow": {
    "pages": [],
    "states": [],
    "transitions": [],
    "dataNeeded": []
  },
  "scope": {
    "inScope": [],
    "outOfScope": [],
    "negativeRequirements": []
  },
  "existingSystemContext": {
    "mode": "unknown"
  },
  "openQuestions": [
    {
      "id": "Q-001",
      "section": "scope",
      "question": "Should this update the existing Run View, or create a new dashboard?",
      "options": ["Update existing Run View", "Create a new dashboard", "Not sure"]
    }
  ],
  "findings": [
    {
      "id": "F-001",
      "kind": "gap",
      "sev": "blocker",
      "section": "scope",
      "ref": "Q-001",
      "text": "Target surface is ambiguous.",
      "resolved": false,
      "raisedBy": "semantix"
    }
  ],
  "coverage": {
    "alignmentPct": 42,
    "sections": [],
    "openBlockers": 1,
    "openConcerns": 0,
    "openFYI": 0
  },
  "nextTurn": {
    "id": "t_sem_001",
    "side": "semantix",
    "at": "2026-04-30T00:00:00.000Z",
    "phase": "crisp",
    "target": "scope",
    "body": {
      "kind": "question",
      "q": "Should this update an existing Phalanx surface or create a new one?",
      "options": [
        { "id": "opt_existing", "label": "Update existing Run View", "tag": "recommend" },
        { "id": "opt_new", "label": "Create a new dashboard", "tag": "risk" },
        { "id": "opt_unknown", "label": "Not sure", "tag": "neutral" }
      ],
      "offers": ["free", "dontknow"]
    }
  }
}
```

### Replacement Or Duplicate Without Approval Blocked

```json
{
  "contractVersion": "semantix.phalanx.spec-studio.v1",
  "source": "semantix",
  "sessionId": "spec_duplicate_blocked",
  "iteration": 2,
  "readiness": "blocked",
  "readinessReason": "The request appears to duplicate or replace an existing surface without explicit approval.",
  "blockingReasons": [
    {
      "id": "BR-001",
      "text": "Replacement of existing Run View requires explicit user approval and migration boundary."
    }
  ],
  "approvalRequired": true,
  "originalUserRequest": "Create a new run dashboard instead of the current one.",
  "alignedRequirement": "",
  "existingSystemContext": {
    "mode": "update",
    "targetSurfaces": [
      {
        "id": "surf_run_view",
        "kind": "ui-page",
        "name": "Existing Run View"
      }
    ]
  },
  "requirements": [],
  "scope": {
    "inScope": [],
    "outOfScope": [],
    "negativeRequirements": []
  },
  "findings": [
    {
      "id": "F-001",
      "kind": "contradiction",
      "sev": "blocker",
      "section": "boundaries",
      "ref": "BND-001",
      "text": "Existing Run View is present, but the request asks for a duplicate or replacement without approval.",
      "resolved": false,
      "raisedBy": "semantix"
    }
  ],
  "coverage": {
    "alignmentPct": 20,
    "sections": [],
    "openBlockers": 1,
    "openConcerns": 0,
    "openFYI": 0
  },
  "nextTurn": null
}
```

### Hoplon-Grounded Update

```json
{
  "contractVersion": "semantix.phalanx.spec-studio.v1",
  "source": "semantix",
  "sessionId": "spec_hoplon_grounded",
  "iteration": 5,
  "readiness": "ready",
  "readinessReason": "Hoplon-grounded target surface and reuse boundary are clear.",
  "blockingReasons": [],
  "approvalRequired": true,
  "originalUserRequest": "Add observation summaries to the run dashboard.",
  "alignedRequirement": "Update the existing Run View right panel to include observation summaries without adding a second panel.",
  "requirements": [
    {
      "id": "REQ-001",
      "type": "constraint",
      "text": "Reuse the existing Run View right panel rather than adding a second panel.",
      "priority": "must",
      "sourceRef": "FACT-001",
      "acceptance": "No new duplicate right-panel shell is introduced.",
      "status": "confirmed"
    },
    {
      "id": "REQ-002",
      "type": "functional",
      "text": "Show observation summaries in the existing right panel.",
      "priority": "must",
      "sourceRef": "dec_004",
      "acceptance": "The right panel renders observation summary content for a selected run.",
      "status": "confirmed"
    }
  ],
  "existingSystemContext": {
    "mode": "update",
    "systemName": "Phalanx Run View",
    "targetSurfaces": [
      {
        "id": "surf_run_view_right_panel",
        "kind": "ui-panel",
        "name": "Run View right panel"
      }
    ],
    "reuseRequirements": ["Reuse the existing Run View right panel"]
  },
  "contextSources": [
    {
      "id": "SRC-001",
      "kind": "hoplon",
      "status": "used",
      "query": "Find existing Run View right-panel observation surface.",
      "summary": "Hoplon found a current right-panel observation summary component.",
      "evidenceRefs": ["hoplon://trace/run-view/right-panel#obs-summary"]
    }
  ],
  "groundedFacts": [
    {
      "id": "FACT-001",
      "source": "hoplon",
      "text": "The current Run View already has a right panel that displays observation analysis.",
      "confidence": "high",
      "evidenceRef": "hoplon://trace/run-view/right-panel#obs-summary"
    }
  ],
  "scope": {
    "inScope": ["Existing Run View right panel"],
    "outOfScope": ["New dashboard shell", "Second right panel"],
    "negativeRequirements": ["Do not introduce a duplicate run dashboard."]
  },
  "assumptions": [],
  "findings": [],
  "coverage": {
    "alignmentPct": 100,
    "sections": [],
    "openBlockers": 0,
    "openConcerns": 0,
    "openFYI": 0
  },
  "nextTurn": null
}
```

## Contract Gaps and Preconditions

Semantix can support the Spec Studio flow, but the following gaps must be aligned with Phalanx before implementation:

1. **Stable IDs require session state.** Semantix can preserve requirement/finding IDs only when Phalanx sends the prior packet, decisions, findings, and context responses on every evaluation request.
2. **Decision IDs should be Phalanx-owned.** Semantix can propose decision semantics, but Phalanx should mint canonical decision IDs because decisions are audit events.
3. **Hoplon queries require a Phalanx broker.** Semantix should never call Hoplon directly in this integration. It emits context requests; Phalanx returns grounded facts with evidence refs.
4. **Grounded facts require evidence refs.** Any Hoplon/repo/trace fact without an evidence ref should be treated as low-confidence or excluded from `groundedFacts`.
5. **Phalanx is the lock authority.** Semantix readiness is advisory for lock. Phalanx must recompute coverage, stale state, and blocker counts before minting a `SpecArtifact`.
6. **Canonical coverage templates are not Semantix-owned.** Semantix can report coverage hints, but Phalanx should own the section templates and coverage formula.
7. **Update safety depends on context.** If existing-system context is missing for an update-like request, Semantix must return `needs_user` or emit context requests, not mark the packet ready.
8. **Degraded service behavior needs a Phalanx fallback envelope.** If Semantix is unreachable, Phalanx must produce the visible degraded state and block lock/run start.
9. **Staff handoff is post-lock only.** Staff should consume the locked `SpecArtifact` or derived handoff packet after user approval. Semantix should not emit Staff design docs, feature puzzles, verify commands, or implementation plans.
10. **Hoplon is not spec authority.** Hoplon facts can ground the current-system state. User approval and the locked artifact remain the authority for desired behavior.

## Open Questions

These should be resolved before live write-path implementation.

1. Should `SpecArtifact.packet.requirements` be the only Staff handoff input, or should Staff receive both `packet` and rendered section prose?
2. Are required questions global, repo-specific, or artifact-template-specific?
3. Can a user lock with a skipped concern if it is explicitly dismissed with audit reason?
4. Are blocker findings ever dismissible, or must they become non-blockers through a new decision?
5. What is the concrete Hoplon query API Phalanx will expose to Semantix?
6. Should Spec Studio support collaborative sessions, or single-writer only for v1?
7. Where does immutable artifact storage live: DB JSON, object storage, or git-backed artifact file?
8. How should child spec versions map to existing Phalanx runs already in progress?

## Non-Goals

Semantix does not:

- Generate Phalanx's final architecture design doc.
- Create Staff feature puzzles.
- Choose implementation files except as grounded existing-system context.
- Execute code.
- Modify repositories.
- Override Phalanx policy gates.
- Treat Hoplon output as user intent.

## Acceptance Criteria for This Integration

- Phalanx can create a Spec Studio session from a raw directive.
- Semantix can return a structured packet with readiness and findings.
- User free text triggers full re-evaluation.
- Negative requirements are preserved as stable requirement facts.
- Existing-system update context can be supplied before lock.
- Hoplon facts can be included as grounded evidence.
- Lock is refused unless readiness is `ready` and blocker count is zero.
- Staff receives the locked packet as authoritative context.
- Phalanx Run can raise spec-drift findings that reference the locked artifact.
