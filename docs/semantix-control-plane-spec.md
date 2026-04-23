# Semantix Control Plane

## Runtime Orchestration, Review Coordination, And Execution Governance

## 0. Purpose Of This Spec

This document defines the Semantix Control Plane as the backend service that sits between:

- one or more Semantix Control Surface clients for user interaction
- pluggable execution backends for actually doing work

It is the system that turns Semantix review and approval semantics into a running execution loop.

This spec is execution-facing. It assumes:

- the architectural framing in [semantix-overview.md](/Users/adilevinshtein/Documents/dev/Semantix/docs/semantix-overview.md:1090)
- the review semantics and DTO expectations in [Semantix Control Plane UI.md](/Users/adilevinshtein/Documents/dev/Semantix/docs/Semantix%20Control%20Plane%20UI.md:1)
- the Codex-backed phase-1 implementation direction in [semantix-codex-poc-v2.md](/Users/adilevinshtein/Documents/dev/Semantix/semantix-codex-poc-v2.md:1)

## 1. Position In The Stack

The clean layering is:

1. **Semantix Control Surface Clients**
   Human review and control clients, such as:
   - browser UI
   - terminal-native CLI or TUI such as `stx`
2. **Semantix Control Plane**
   Backend daemon that owns review artifacts, approvals, freshness, execution coordination,
   multi-turn runtime session and turn coordination, and event streaming
3. **Execution Adapter Layer**
   Pluggable adapters that bridge the control plane to concrete execution systems
4. **Execution Backends**
   CLI runtimes, domain runtimes, or provider-backed executors
5. **Computation Providers And Tools**
   Models, retrieval systems, tools, MCP servers, local shell and filesystem access

The Control Plane is not the UI, not the raw provider layer, and not the execution engine itself.

## 2. Design Goal

The Control Plane should make execution:

- bounded
- inspectable
- governable
- resumable
- reviewable

It should be able to coordinate pluggable execution backends over time, including examples such as:

- `CodexCliRuntimeAdapter`
- `ClaudeCliRuntimeAdapter`
- `PhalanxRuntimeAdapter`
- provider-backed executors over services such as OpenRouter or Gemini

For phase 1, the execution plug is intentionally narrow:

- exactly one runtime adapter is implemented: `CodexCliRuntimeAdapter`
- exactly one active execution backend is assumed per run
- the UI and contract model must still be designed so additional adapters can be added later

## 3. Core Responsibilities

The Control Plane owns:

- intent lifecycle
- plan compilation and graph persistence
- review artifact generation
- multi-client consistency
- node orchestration and dispatch
- runtime adapter selection
- approval gating
- freshness checking
- risk detection and escalation
- state tracking and checkpointing
- audit recording
- event streaming to the Control Surface

It does not:

- derive authoritative state from transcripts
- perform raw model generation as its primary job
- directly mutate external systems outside adapters
- depend on any single runtime implementation
- allow one client to bypass shared approval and freshness rules

## 4. Core Components

### 4.1 Control Plane Daemon

Central service responsible for:

- run lifecycle management
- review artifact persistence
- plan and node state tracking
- approval and freshness enforcement
- event broadcasting

### 4.2 Artifact Store

Persists:

- intent contracts
- execution plans
- review artifacts
- approval decisions
- audit records
- checkpoints

### 4.3 Adapter Registry

Maintains available execution and provider adapters:

- registers adapters
- tracks capabilities and health
- resolves runtime selection
- exposes installed adapters to the control plane

### 4.4 Execution Coordinator

Responsible for:

- dispatching approved work to adapters
- collecting structured results
- merging adapter events into normalized run events
- pausing at approval gates or stale-state boundaries

### 4.5 Approval And Freshness Gatekeeper

Responsible for:

- version binding
- stale-state rejection
- invalidation propagation
- resume eligibility

### 4.6 Event Streamer

Streams normalized events to the Control Surface and other consumers.

### 4.7 Client Session Gateway

Coordinates multiple control-surface clients against the same backend truth.

It is responsible for:

- serving the current review artifact to browser and terminal-native clients
- accepting approvals and interventions from either client form
- rejecting stale actions consistently
- broadcasting updated state to all subscribed clients

## 5. Adapter Model

The Control Plane should support two adapter families, while keeping phase 1 deliberately simple.

### 5.1 ProviderAdapterContract

This contract is for direct provider-facing capabilities:

- completion
- tool call
- retrieval
- embeddings
- verifier call

Examples:

- `OpenRouterProviderAdapter`
- `GeminiProviderAdapter`

These adapters talk to computation providers directly.

### 5.2 RuntimeAdapterContract

This contract is for execution plugs that can carry out approved work on behalf of the control
plane.

Examples:

- `CodexCliRuntimeAdapter`
- `ClaudeCliRuntimeAdapter`
- `PhalanxRuntimeAdapter`
- provider-backed execution wrappers that use one or more provider adapters under the hood

### 5.3 Phase 1 Decision

In phase 1:

- `CodexCliRuntimeAdapter` is the only implemented runtime adapter
- provider adapters may exist later, but are not required for the first executable slice
- runtime selection is effectively fixed to `codex_cli`

This keeps the control-plane architecture pluggable without pretending the first build already
supports many backends.

## 6. System Diagram

```text
Browser Control Surface ─┐
                         ├─> Semantix Control Plane (Daemon)
stx Control Surface ─────┘
                                ↓
                        Execution Adapter Layer
                                ↓
                            Codex CLI (v1)

Later:
    ├─ Claude CLI
    ├─ Phalanx Runtime
    ├─ OpenRouter-backed Executor
    └─ Gemini-backed Executor
```

## 7. Core Data Contracts

These contracts are aligned to the current Control Surface spec. The backend may have additional
internal fields, but it must preserve these meanings at the API boundary.

### 7.1 IntentContract

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

### 7.2 ReviewArtifact

```ts
interface ReviewArtifact {
  artifactId: string;
  runId: string;
  planVersion: number;
  graphVersion: number;
  artifactHash: string;
  generatedAt: number;
  freshnessState: "fresh" | "stale" | "superseded";
  intent: IntentContract;
  plan: ExecutionPlan;
}
```

### 7.3 ExecutionPlan

```ts
interface ExecutionPlan {
  id: string;
  runtimeKind: string;
  planVersion: number;
  graphVersion: number;
  artifactHash: string;
  intent: IntentContract;
  nodes: ExecutionNode[];
  edges: ExecutionEdge[];
  approvalGates: ApprovalGate[];
  stateEffects: StateEffect[];
  checkpoints: ResumeCheckpoint[];
  status:
    | "draft"
    | "pending_review"
    | "approved_for_execution"
    | "running"
    | "paused"
    | "completed"
    | "failed"
    | "stale";
}
```

### 7.4 ExecutionNode

`ExecutionNode` needs both review-facing and execution-facing state. Do not collapse them into one
ambiguous status field.

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
  revision: number;
  dependsOn: string[];
  gatingOwner: SystemId;
  contributingSystems: SystemId[];
  reviewStatus: "ready" | "warning" | "blocked" | "approved" | "stale";
  executionStatus: "not_started" | "queued" | "running" | "succeeded" | "failed" | "paused";
  grounding?: GroundingLabel;
  confidenceBand?: ConfidenceBand;
  confidenceScore?: number;
  sourceCount?: number;
  riskFlags: string[];
  approvalRequired: boolean;
  inputSummary?: string;
  outputSummary?: string;
  constraints?: ConstraintSet;
  capabilityScope?: CapabilityScope;
  runtimeBinding?: RuntimeTarget;
}
```

### 7.5 NodeInspectorPayload

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

### 7.6 StateEffect

`StateEffect` is the control-plane abstraction for a proposed externally visible change. The Control
Surface may render it as a `ProposedChange` in the diff panel.

```ts
type ReversibilityStatus =
  | "reversible"
  | "reversible_within_window"
  | "irreversible";

interface StateEffect {
  id: string;
  kind: "file" | "api" | "database" | "external_action";
  operation: string;
  target: string;
  summary: string;
  previewRef?: string;
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

### 7.7 ApprovalGate

Approvals must bind to the exact reviewed artifact.

```ts
interface ApprovalGate {
  id: string;
  targetNodeId?: string;
  required: boolean;
  status: "pending" | "approved" | "rejected" | "stale";
  planVersion: number;
  artifactHash: string;
  nodeRevision?: number;
  reason?: string;
}
```

### 7.8 ResumeCheckpoint

```ts
interface ResumeCheckpoint {
  id: string;
  runId: string;
  planVersion: number;
  artifactHash: string;
  afterNodeId?: string;
  createdAt: number;
}
```

### 7.9 RiskSignal

```ts
interface RiskSignal {
  id: string;
  nodeId?: string;
  severity: "low" | "medium" | "high";
  message: string;
  source: "policy" | "provenance" | "critique" | "runtime" | "system";
}
```

### 7.10 RunEvent

```ts
interface RunEvent {
  timestamp: number;
  runId: string;
  type:
    | "run.created"
    | "artifact.generated"
    | "node.updated"
    | "state_effect.available"
    | "risk.detected"
    | "approval.required"
    | "approval.accepted"
    | "approval.rejected"
    | "approval.stale"
    | "checkpoint.created"
    | "run.paused"
    | "run.resumed"
    | "run.completed"
    | "run.failed";
  nodeId?: string;
  planVersion?: number;
  artifactHash?: string;
  payload?: unknown;
}
```

## 8. Runtime Adapter Contract

All runtime adapters must implement:

```ts
interface RuntimeAdapter {
  id: string;
  family: "cli_runtime" | "provider_backed_runtime" | "domain_runtime";
  displayName: string;

  getCapabilities(): Promise<RuntimeCapabilities>;
  healthCheck(): Promise<AdapterHealth>;

  executeNode(input: ExecuteNodeInput): Promise<ExecuteNodeResult>;
  simulateEffects?(input: SimulateEffectsInput): Promise<StateEffect[]>;

  pauseRun(input: PauseRunInput): Promise<void>;
  resumeRun(input: ResumeRunInput): Promise<void>;
  cancelRun(input: CancelRunInput): Promise<void>;

  streamEvents(input: StreamEventsInput): AsyncIterable<RunEvent>;
}
```

Notes:

- `executeNode` is the only truly required execution primitive in phase 1
- `simulateEffects` is optional at the adapter boundary, but the control plane must still present
  state effects before execution proceeds
- adapters return structured results, not transcript-derived truth

## 9. Provider Adapter Contract

Direct provider adapters implement:

```ts
interface ProviderAdapter {
  id: string;
  providerKind: "llm" | "retrieval" | "embedding" | "verifier" | "tool_router";
  displayName: string;

  getCapabilities(): Promise<ProviderCapabilities>;
  healthCheck(): Promise<AdapterHealth>;

  completion?(input: CompletionInput): Promise<CompletionResult>;
  retrieval?(input: RetrievalInput): Promise<RetrievalResult>;
  embeddings?(input: EmbeddingsInput): Promise<EmbeddingsResult>;
  verifierCall?(input: VerifierInput): Promise<VerifierResult>;
  toolCall?(input: ToolCallInput): Promise<ToolCallResult>;
}
```

Provider adapters are not required to ship phase 1, but the control plane should leave room for
them in the registry model.

## 10. Runtime Capabilities

```ts
interface RuntimeCapabilities {
  supportsMultiTurn: boolean;
  supportsFileMutation: boolean;
  supportsToolUse: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  supportsPauseResume: boolean;
  supportsLocalExecution: boolean;
  supportsModelSelection: boolean;
  supportsEffectSimulation: boolean;
}
```

## 11. Runtime Selection Policy

In the general model, runtime selection should consider:

- node type
- constraints
- required capabilities
- cost and latency targets
- sensitivity level
- local versus remote execution needs

```ts
interface RuntimeSelectionPolicy {
  selectRuntime(
    node: ExecutionNode,
    context: RuntimeSelectionContext
  ): RuntimeTarget;
}
```

For phase 1:

- the selection policy is fixed
- every executable node binds to `codex_cli`

## 12. UI-Facing Review And Control Contract

The Control Plane must expose enough structured behavior for the Control Surface to do its job
without consulting runtime transcripts.

That contract should be identical whether the client is:

- a browser UI
- a terminal-native CLI or TUI

Client form changes presentation and interaction ergonomics. It does not change backend truth.

At minimum, it should support:

- create or update intent
- compile plan and generate review artifact
- fetch current artifact by run
- submit interventions on nodes
- submit approval or rejection actions
- reject stale approvals
- execute approved nodes
- pause and resume from checkpoints
- stream normalized events

Terminal-native clients may project these capabilities into commands such as:

- `stx run`
- `stx graph`
- `stx inspect`
- `stx diff`
- `stx approve`
- `stx resume`

### 12.1 Bundled Browser Host

For phase 1, the same daemon that serves the review API also hosts the bundled browser UI that
`stx` builds into `packages/stx/dist/ui`.

Operational rules:

- static assets are served from that bundle directory by default unless `SEMANTIX_UI_DIR` overrides it
- `GET /` redirects to `/index.html`
- legacy browser entry routes such as `/chat`, `/canvas`, `/how-it-works`, and the older
  `/Design/*.html` paths redirect to `/index.html` so existing bookmarks land on the bundled app
- `GET /runs/:runId/previews?previewRef=...` resolves preview content JSON for the referenced
  `StateEffect` and returns the resolved `previewRef`, `mediaType`, `content`, and current run/artifact
  identity fields

Every mutating UI action must carry:

- `planVersion`
- `artifactHash`
- relevant node revision or change identifier

The backend must reject actions against stale state.

## 13. Freshness And Invalidation

The Control Plane owns invalidation logic for reviewed state.

Minimum rules:

- if the intent contract changes, the entire plan becomes stale
- if a node's context or constraints change, the node and downstream dependents become stale
- if the runtime capability surface changes, approvals granted under the prior surface become stale
- if reviewed state is stale, approval cannot be reused

Expected stale-state behavior:

1. the user submits an approval or intervention
2. the control plane compares `planVersion`, `artifactHash`, and node revision to current state
3. if they match, the action is accepted
4. if they do not match, the action is rejected as stale
5. a fresh review artifact is required before execution resumes

## 14. Execution Flow

1. The user submits a goal through the Control Surface.
2. The Control Plane drafts an `IntentContract`.
3. The Control Plane compiles a versioned `ExecutionPlan`.
4. The Control Plane emits a `ReviewArtifact`.
5. A browser UI or terminal-native client renders graph, inspector, and state effects from
   structured objects.
6. The user edits, approves, or rejects.
7. The Control Plane freshness-checks the action.
8. Approved nodes are dispatched to the selected runtime adapter.
9. The adapter executes work and streams normalized events.
10. The Control Plane merges execution results into node state, risk signals, and state effects,
    then broadcasts them to subscribed clients.
11. If an approval gate or stale-state boundary is reached, execution pauses.
12. The Control Plane resumes from a `ResumeCheckpoint` only after valid approval.
13. Audit records persist what was shown, what changed, and what was approved.

## 15. Event Model

Normalized events should include at least:

- `run.created`
- `artifact.generated`
- `node.updated`
- `state_effect.available`
- `risk.detected`
- `approval.required`
- `approval.accepted`
- `approval.rejected`
- `approval.stale`
- `checkpoint.created`
- `run.paused`
- `run.resumed`
- `run.completed`
- `run.failed`

## 16. Non-Negotiable Rules

- No transcript-driven UI
- Runtimes are replaceable
- Every meaningful action is a node or node-adjacent artifact
- All state effects are explicit before execution proceeds
- Review is structural, not conversational
- Approvals are freshness-bound
- Audit recording is required in v1

## 17. v1 Scope

Included:

- one runtime adapter: `CodexCliRuntimeAdapter`
- one shared control plane serving both browser and terminal-native clients
- single-backend execution per run
- execution graph persistence
- node inspection payloads
- state-effect preview
- approval flow
- freshness checks
- event streaming
- audit recording

Excluded for later phases:

- multi-user collaboration
- multi-runtime execution within one run
- advanced routing policies
- enterprise policy engine
- distributed execution
- provider-only execution paths without a runtime wrapper

## 18. Readiness Bar

This spec is ready for phase-1 implementation when the first build can do all of the following:

1. compile an `IntentContract` and `ExecutionPlan`
2. generate a versioned review artifact with `planVersion` and `artifactHash`
3. render that artifact in the Control Surface
4. reject stale approvals
5. dispatch approved work to `CodexCliRuntimeAdapter`
6. stream normalized events back to the UI
7. persist audit records for approval and execution events

## 19. Summary

The Semantix Control Plane:

- decouples execution from control
- standardizes structured interaction across pluggable runtimes
- provides one backend truth to multiple control-surface clients
- coordinates review, approval, freshness, and resume behavior
- enables the Control Surface to form trust without consulting transcripts

In phase 1, it does this with one execution plug: Codex CLI.
Later, the same control plane can coordinate additional runtimes without changing the Semantix
review model.
