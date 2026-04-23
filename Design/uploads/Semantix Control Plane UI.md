# Semantix Control Surface

## v1 Review Surface / Control Room Specification

## 0. Relationship To Semantix

This document specifies the Semantix Control Surface: the review and control product that realizes
Semantix's third identity, the human review methodology for turning probabilistic plans into
engineering artifacts.

At the ecosystem level, the Review Surface is a distinct product surface. At the architectural
level, it is how Semantix review becomes operational. Semantix defines the contract; the Review
Surface exposes that contract, together with orchestration, enforcement, critique, and telemetry,
in one place a human can approve or reject.

This spec describes one software-engineering instantiation of that layer. In v1, Phalanx is the
primary domain runtime underneath it, but the underlying abstractions are intended to be portable
across other vertical runtimes.

Put differently: this is not a Phalanx-first dashboard. It is the human review and control surface
for Semantix-managed runs, rendered over a runtime implementation.

## 1. Purpose

The Control Surface is not a dashboard.

It is a pre-execution control surface where users:

- understand what the system will do
- identify uncertainty and risk
- intervene before side effects occur
- approve or block execution

Primary goal:

**Make AI behavior inspectable before it becomes real.**

## 2. Assumed Components

This spec assumes the reader has, at minimum, the following layered stack picture:

| Component | Role In The Stack | What It Contributes To The UI |
| --- | --- | --- |
| Computation providers | Raw capability access | model, tool, retrieval, and provider metadata when relevant |
| Semantix | Universal contract, review, and control layer | intent contract, constraints, blueprint structure, semantic boundaries |
| Phalanx | Domain runtime for software engineering | execution graph, ordering, retries, approval checkpoints, state transitions |
| Hoplon | Hard mutation boundary and diff enforcement | scoped diffs, AST validation, enforcement results, mutation authority |
| CT-MCP | Semantic verifier and challenger | contradiction flags, weak-reasoning signals, critique payloads |
| LLM Tracker | Observability, replay, and audit trail | trace handles, provenance, retries, replay metadata, decision history |
| Guardrail | Narrow execution wedge for local commands | capability and command-scope metadata where relevant |

The Control Surface does not replace these systems. It composes them into one trust-forming view.

One available execution runtime in v1 is Phalanx for software engineering. Later versions can add
other runtimes, generic workflows, and runtime adapters under the same surface.

### 2.1 Adapter Contracts

The architecture wants three distinct contracts:

- `ProviderAdapterContract`: completion, tool call, retrieval, embeddings, verifier call
- `RuntimeAdapterContract`: compile domain plan, expose nodes and edges, simulate effects, execute
  node, pause or resume, return diffs and risks
- `ReviewControlContract`: intent review, graph rendering model, node inspection model, state diff
  model, approval semantics, audit semantics

Phalanx implements the runtime adapter contract for software engineering. The Control Surface is
the primary UI for the review and control contract owned by Semantix.

## 3. Product Boundaries

The Control Surface is:

- a compiled artifact viewer
- an intervention system
- a trust surface for pre-execution review

The Control Surface is not:

- the system of record for execution state
- a chat-first interface
- a software-engineering shell
- a replacement for orchestration, enforcement, or telemetry systems
- a place where client-only approval can bypass backend policy

The backend runtime remains the source of truth. In the software-engineering instantiation that
runtime is typically Phalanx. The UI is a versioned projection of backend state.

## 4. Design Principles

### 4.1 Review Structure, Not Vibes

Humans are not approving a reassuring paragraph from a model. They are approving the proposed
execution structure: intent, dependencies, tools, policies, and predicted side effects.

### 4.2 Local Intervention Over Global Restart

Users should be able to challenge and repair a node, context slice, or constraint set without
restarting the entire plan. Partial regeneration is a product requirement, not a nice-to-have.

### 4.3 Risk Visibility Before Convenience

The surface should make uncertainty obvious before it makes actions easy. Missing inputs, weak
grounding, critique warnings, stale approvals, and irreversible effects should all be legible at a
glance.

### 4.4 Deterministic Trust Anchors

Every side effect must be previewable, policy-checked, and tied back to deterministic contracts or
explicit review events.

### 4.5 The Safe Path Must Feel Easier Than The Unsafe One

Safe actions should be obvious and low-friction. Risky or blocked actions should require more
intentionality, more context, and more backend confirmation, not less.

### 4.6 Approval Must Bind To Fresh State

An approval is valid only for the exact plan version, graph version, node revision, and diff set
that the user reviewed. Stale approvals must be rejected server-side.

## 5. Review Session Model

Each rendered Control Surface state is keyed to a versioned review artifact. At minimum, the backend
emits:

- `planVersion`
- `graphVersion`
- `artifactHash`
- `intentContractVersion`
- `generatedAt`
- freshness state: `fresh`, `stale`, or `superseded`

The client may cache and render prior artifacts, but only the backend can declare one current.

## 6. Layout Overview

Three synchronized panels plus top and bottom bars:

```text
+-------------------------------------------------------------+
|                     Intent Bar (Top)                        |
+-------------------+---------------------+-------------------+
|                   |                     |                   |
| Execution Graph   | Node Inspector      | State Diff Panel  |
|                   |                     |                   |
+-------------------+---------------------+-------------------+
|                  Action Bar (Bottom)                        |
+-------------------------------------------------------------+
```

The layout should keep structure, explanation, and consequences visible at the same time.

## 7. Top Bar: Intent Contract

### 7.1 Purpose

The top bar defines the frozen goal and boundaries for the current review artifact.

### 7.2 Required Content

- primary directive
- strict boundaries
- success state
- current status: `draft`, `pending_review`, `approved`, `rejected`, `modified`, or `stale`
- `planVersion`
- freshness badge

### 7.3 Actions

- `edit`
- `approve`
- `reject`
- `view history`

Approving the intent contract does not imply approving the execution graph. They are separate
review events.

## 8. Bottom Action Bar

### 8.1 Purpose

The bottom bar exposes global review actions and aggregate risk state.

### 8.2 Actions

- `approve all`
- `approve selected nodes`
- `reject plan`
- `run simulation`
- `execute`

### 8.3 Global Status

- total node count
- risk summary by color
- pending approvals
- blocked actions count
- stale approvals count

Actions that are invalid for the current artifact state must be visually disabled, not merely
warned after click.

## 9. Execution Graph

### 9.1 Purpose

The Execution Graph is the primary structural view of the proposed run.

### 9.2 Node Types

| Type | Meaning |
| --- | --- |
| Semantic | LLM generation, extraction, ranking, or other bounded semantic work |
| Deterministic | Logic, validation, transformation, or replayable computation |
| Tool | External system interaction |
| Policy Gate | Hard or soft policy decision point |
| Approval | Human intervention required before progress continues |

### 9.3 Node Summary

Each node may surface:

- title
- type badge
- status color
- input summary
- output summary
- risk indicators
- dependency count
- approval state
- owner and contributing systems

### 9.4 Status Colors And Meaning

| Color | Meaning |
| --- | --- |
| Green | Deterministic or strongly grounded and currently safe |
| Yellow | Synthesized but acceptable, or minor warnings present |
| Orange | Weak grounding, missing context, or review advised |
| Red | Blocked, stale, contradictory, or high-risk and intervention required |

Grounding labels for semantic output spans are:

- `grounded`: directly supported by user input, retrieved evidence, or tool output
- `transformed`: deterministically derived from grounded material
- `bridged`: plausible connective reasoning that is not directly evidenced
- `unsupported`: no adequate provenance or validation support

### 9.5 Node Summary Field Population Rules

Summary fields are conditional. The graph should render only meaningful fields for a node rather
than filling cards with placeholder dashes.

- Pure deterministic nodes may omit grounding labels entirely.
- Policy gates may omit source counts when no source concept exists.
- Approval nodes may omit output summaries if they produce no new artifact.
- Confidence bands appear only when probabilistic uncertainty is part of the node's meaning, or
  when a deterministic node aggregates upstream semantic uncertainty.
- If a field is omitted, the layout compacts cleanly rather than reserving empty space.

### 9.6 Interaction

On hover:

- show summary tooltip
- highlight incoming and outgoing edges
- expose dominant risk flags

On click:

- open Node Inspector
- focus related state diff entries
- highlight invalidation scope if the node is stale

### 9.7 Graph Features

- zoom and pan
- collapse and expand subgraphs
- highlight critical path
- filter by node type, risk level, approval required, owner, or freshness state

## 10. Node Inspector

### 10.1 Purpose

The Node Inspector is the deep inspection and intervention surface for one selected node.

### 10.2 Inspector Sections

The inspector may render up to ten sections:

1. Overview
2. Context
3. Constraints
4. Output Preview
5. CT-MCP Critique
6. Tooling
7. Proposed Changes
8. Approvals And Gates
9. Replay And Trace
10. Audit Metadata

### 10.3 Conditional Rendering Rule

The inspector renders only populated sections. Empty sections are omitted entirely. Reviewers
should not stare at blank cards for capabilities that do not apply to the selected node.

### 10.4 Interventions

Allowed interventions in v1:

- edit context
- edit constraints
- split node
- regenerate node
- mark requires approval

Interventions mutate the backend plan, not the client-local copy.

## 11. Core DTO Sketches

The DTOs below are sketches, not frozen API contracts. Their purpose is to pin down semantics that
must stay consistent across subsystems.

These are Semantix-level abstractions, not Phalanx-specific internals. A domain runtime maps its
own execution model into these shapes so the Control Surface can stay portable across domains.
They belong to the `ReviewControlContract`, not the `RuntimeAdapterContract`.

### 11.1 ExecutionPlan

`ExecutionPlan` is the top-level Semantix abstraction for a proposed run. Phalanx may realize it as
an engineering workflow plan, but another runtime could realize the same abstraction for support,
compliance, finance, or research.

```ts
interface ExecutionPlan {
  id: string;
  runtimeKind: string;
  planVersion: number;
  intent: IntentContract;
  nodes: ExecutionNode[];
  approvalGates: ApprovalGate[];
  stateEffects: StateEffect[];
  checkpoints: ResumeCheckpoint[];
}
```

### 11.2 Portable Supporting Types

The Review Surface expects the backend runtime to preserve the meaning of the following Semantix
abstractions:

- `ConstraintSet`: hard and soft rules attached to a node or execution region
- `CapabilityScope`: the visible tools, data, and permissions for a node or region
- `ApprovalGate`: a freshness-bound checkpoint that must be satisfied before a node or effect may advance
- `RiskSignal`: a normalized warning emitted by policy, provenance, critique, or runtime checks
- `StateEffect`: a proposed externally visible change before it is rendered into a diff view
- `ProvenanceRecord`: the evidence chain behind a value, output span, or decision
- `ResumeCheckpoint`: a safe boundary for suspension and later resumption

### 11.3 IntentContract

```ts
interface IntentContract {
  id: string;
  primaryDirective: string;
  strictBoundaries: string[];
  successState: string;
  status: "draft" | "pending_review" | "approved" | "rejected" | "modified" | "stale";
  planVersion: number;
  contractVersion: number;
  artifactHash: string;
}
```

### 11.4 ExecutionNode

`grounding` and `confidenceBand` are related but not interchangeable.

- `grounding` answers: where did this content come from?
- `confidenceBand` answers: how much should the system trust this node right now?

Confidence must be derived from shared signals, not subsystem-specific vibes.

Required confidence signals:

- `provenanceStrength`: how much of the node output is grounded or transformed from trusted input
- `verifierAgreement`: how strongly validators, critique layers, and policy checks agree
- `retryStability`: how little repair friction was required to reach the current node output
- `changeSafety`: how bounded the blast radius is, weighted by reversibility and permission scope

Normalized score:

`confidenceScore = 0.40 * provenanceStrength + 0.25 * verifierAgreement + 0.20 * retryStability + 0.15 * changeSafety`

Banding:

- `high`: score >= 0.80 and no blocking verifier conflicts
- `medium`: score >= 0.55 and < 0.80, with no hard blocker
- `low`: score < 0.55, or any unresolved `unsupported` content, verifier conflict, stale approval,
  or missing required input

```ts
type SystemId =
  | "semantix"
  | "phalanx"
  | "hoplon"
  | "ct_mcp"
  | "llm_tracker"
  | "guardrail";

type GroundingLabel = "grounded" | "transformed" | "bridged" | "unsupported";
type ConfidenceBand = "high" | "medium" | "low";

interface ExecutionNode {
  id: string;
  title: string;
  nodeType: "semantic" | "deterministic" | "tool" | "policy_gate" | "approval";
  status: "ready" | "warning" | "blocked" | "approved" | "stale";
  revision: number;
  dependsOn: string[];
  gatingOwner: SystemId;
  contributingSystems: SystemId[];
  grounding?: GroundingLabel;
  confidenceBand?: ConfidenceBand;
  confidenceScore?: number;
  confidenceSignals?: {
    provenanceStrength: number;
    verifierAgreement: number;
    retryStability: number;
    changeSafety: number;
  };
  sourceCount?: number;
  riskFlags: string[];
  approvalRequired: boolean;
  inputSummary?: string;
  outputSummary?: string;
}
```

`gatingOwner` is the subsystem that determines whether the node can advance. It is intentionally
single-valued. `contributingSystems` captures the reality that multiple subsystems may inform or
constrain the node.

### 11.5 NodeInspectorPayload

```ts
interface NodeInspectorPayload {
  node: ExecutionNode;
  overview?: object;
  context?: object;
  constraints?: object;
  outputPreview?: object;
  critique?: object;
  tooling?: object;
  proposedChanges?: ProposedChange[];
  approvals?: object;
  replay?: object;
  audit?: object;
}
```

The payload shape is sparse by design. Frontend rendering must treat every section other than
`node` as optional.

### 11.6 ProposedChange

`ProposedChange` is the Review Surface view model for a Semantix `StateEffect`.

Reversibility is not a boolean. The surface must distinguish:

- `reversible`
- `reversible_within_window`
- `irreversible`

```ts
type ReversibilityStatus =
  | "reversible"
  | "reversible_within_window"
  | "irreversible";

interface ProposedChange {
  id: string;
  kind: "file" | "api" | "database" | "external_action";
  operation: string;
  target: string;
  summary: string;
  diffRef?: string;
  policyState: "pass" | "block" | "review_required";
  riskFlags: string[];
  reversibility: {
    status: ReversibilityStatus;
    mechanism?: string;
    windowSeconds?: number;
  };
  enforcement: {
    owner: "phalanx" | "hoplon" | "policy";
    status: "pass" | "block" | "review_required";
    details?: string;
  };
}
```

Examples:

- git-backed file patch: `reversible`
- database write inside rollback window: `reversible_within_window`
- sent email or external webhook to third party: `irreversible`

## 12. State Diff Panel

### 12.1 Purpose

The State Diff Panel shows what will actually change in the real world if the current plan
executes.

### 12.2 Categories

- files: create, modify, delete
- APIs: calls and payloads
- database operations
- external actions

### 12.3 Risk Indicators

- policy violations
- irreversible actions
- derived logic with weak grounding
- stale approvals
- capability drift

### 12.4 Hoplon Integration

Each change may include:

- AST validation status
- scope boundary check
- enforcement result: `pass`, `block`, or `review_required`

### 12.5 Reversibility Presentation

The UI should render reversibility as a first-class badge, not buried metadata. Approval thresholds
are expected to differ across reversible, reversible-within-window, and irreversible changes.

### 12.6 Actions

- approve change
- block change
- require approval
- view full diff

If `policyState` is `block`, the surface must not render an approval path for that change.

## 13. Approval, Freshness, And Backend Truth

The backend runtime is the source of truth. In the software-engineering instantiation described
here, that runtime is usually Phalanx.

Every mutating UI action must carry, at minimum:

- `planVersion`
- `graphVersion`
- selected `nodeId`
- selected `nodeRevision`
- relevant `artifactHash`
- relevant `diffRef` or change identifier when approving a change

The backend must reject actions against stale state. Expected behavior:

1. user clicks approve or regenerate
2. client submits versioned request
3. backend compares request versions to current versions
4. if mismatched, backend rejects with stale-state error and current artifact metadata
5. UI marks the current view stale and offers refresh or re-open on the latest artifact

This rule holds even in v1, even if only one reviewer is expected. Trust cannot depend on the UI
being lucky enough to be current.

## 14. Invalidation And Partial Regeneration

Principle 4.2 requires an explicit invalidation model.

The minimal invalidation rules for v1 are:

| Change Type | Invalidates | Preserves |
| --- | --- | --- |
| Intent contract edit | entire graph, all approvals, all diff previews | prior audit history |
| Context edit on node N | node N, downstream consumers of N, their critiques, affected diff entries, approvals on affected descendants | unrelated sibling branches |
| Constraint edit on node N | node N, validators and policy gates using those constraints, downstream consumers, affected approvals | unrelated nodes not reachable from N |
| Tool binding or capability change | node N, downstream nodes, capability overlays, approvals granted under prior capability surface | unaffected branches without that capability |
| Verifier or model setting change | confidence, critique, and approval state for affected nodes and descendants | deterministic ancestors |

Invalidated nodes transition to `stale`. Any approval attached to a stale node or stale change is
treated as void until re-reviewed.

## 15. Core Interaction Flow

1. The system compiles the current task into a reviewable blueprint.
2. The backend emits a versioned review artifact.
3. The UI renders the intent contract, execution graph, and state diff.
4. The reviewer focuses first on orange and red nodes.
5. The reviewer selects a weak or blocked node.
6. The Node Inspector explains the node's context, constraints, critique, and consequences.
7. The reviewer edits context, tightens constraints, splits the node, or marks it for approval.
8. The client submits the intervention with freshness metadata.
9. The backend computes the minimal invalidation set.
10. The system regenerates only the affected node set and recomputes downstream dependencies
    according to Section 14.
11. The UI marks superseded approvals stale and refreshes the diff preview.
12. The reviewer approves, rejects, or continues intervention on the fresh artifact.
13. Execution resumes only after the backend persists the approval event.

## 16. MVP Acceptance Criteria

1. A reviewer can inspect the frozen intent contract, current status, and plan version before
   approving execution.
2. The execution graph renders node types, dependencies, risk colors, approval gates, and
   conditional summary fields without placeholder noise.
3. The Node Inspector renders only populated sections and supports local interventions on a
   selected node.
4. The State Diff Panel shows proposed changes, policy state, Hoplon enforcement status, and
   reversibility class.
5. Every mutating review action is freshness-checked against backend truth, and stale approvals are
   rejected.
6. Every approve, reject, edit, or execute event persists a durable review artifact record.
7. A policy-blocked action is never approvable through any UI path.

## 17. Audit Artifact And Persistence

Audit-artifact recording is v1 scope, even if a dedicated export UI ships later.

For each review event, the backend should persist a durable record containing:

- `artifactId`
- `planVersion`
- `graphVersion`
- `artifactHash`
- intent contract snapshot
- nodes shown to the reviewer, including revisions and risk state
- proposed changes shown, including diff references and reversibility
- enforcement and critique summaries in effect at approval time
- reviewer identity
- action taken: approve, reject, edit, execute, or require approval
- optional reason or annotation
- timestamp

The export interface can be deferred to v2. The recording cannot.

## 18. Technical Notes

Suggested stack:

- frontend: React
- styling: Tailwind
- graph rendering: React Flow
- state: Zustand
- diff viewer: Monaco Editor or equivalent
- transport: versioned HTTP or WebSocket responses with explicit freshness metadata

Implementation notes:

- client state should be normalized by `nodeId` and `revision`
- graph and diff panes should share selection state
- stale-state rejection should be a first-class UI path, not an exception toast

## 19. Positioning

The Control Surface is not a dashboard for watching AI think. It is the control room where humans
approve proposed reality before reality changes.

That distinction is the product.

## 20. Future Extensions

Likely v2 and later additions:

- export UI for audit bundles and signed review artifacts
- multi-user collaboration and reviewer presence
- real-time execution playback
- deeper provenance drill-down and span-level evidence browsers
- richer simulation and replay tooling

These extensions can wait. Trustworthy pre-execution review, freshness-checked approval, partial
regeneration, and durable audit recording cannot.
