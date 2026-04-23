# Semantix × Codex POC Architecture

## Demonstrating Governed AI Execution Over An Existing Runtime

## 1. Purpose

This document narrows the broader Semantix architecture into one concrete proof of concept.

The overview defines Semantix as the universal control layer above computation providers and above
any one domain runtime. The Control Surface spec defines the human-facing review product for that
layer.

This POC shows how Semantix can govern an already-capable execution runtime, using Codex as the
concrete runtime in the prototype.

That distinction matters:

- this is not a Codex UI
- this is not a transcript viewer
- this is not a claim that Codex becomes the Semantix architecture
- this is a demonstration that Semantix can sit above an existing runtime and make its execution
  bounded, inspectable, governable, resumable, and reviewable

The same POC can be exercised through more than one client:

- a browser-based control surface
- a terminal-native `stx` control client

Both should talk to the same Semantix Control Plane.

> Codex proves the loop.  
> Semantix proves the control.

## 2. Objective

The POC must clearly show:

- existing agent runtimes can already execute complex, multi-step tasks
- what they lack by default is structured review, approval semantics, and trust formation
- Semantix adds the missing control layer without depending on raw transcripts as the source of
  truth

Concretely, the POC should demonstrate:

- `IntentContract`
- `ExecutionPlan`
- node-level inspection
- state-effect preview rendered as a diff view
- approval gates
- pause and resume behavior
- audit-friendly structured events

## 3. Relationship To The Other Docs

This document should be read as a concrete instance of the other two docs, not as a competing
architecture.

- [docs/semantix-overview.md](/Users/adilevinshtein/Documents/dev/Semantix/docs/semantix-overview.md:1090)
  defines the three-layer model:
  computation providers, domain runtimes, and the Semantix control layer.
- [docs/Semantix Control Plane UI.md](/Users/adilevinshtein/Documents/dev/Semantix/docs/Semantix%20Control%20Plane%20UI.md:1)
  defines the Semantix Control Surface and its review semantics.
- this POC shows one runtime-specific instantiation:
  Semantix Control Surface + Semantix control layer + Codex-backed runtime adapter.

In the broader system story, Phalanx remains the intended software-engineering domain runtime.
This POC uses Codex because it is an immediately available runtime that can prove the control model
against a live agent loop.

## 4. Stack Placement

The POC follows the same top-middle-bottom split as the overview.

### 4.1 Top: Semantix Control Surface

The UI layer renders the review and control contract:

- intent contract view
- execution graph
- node inspector
- state diff panel
- approval workflows

That top layer may be rendered as:

- a browser UI
- a terminal-native CLI or TUI such as `stx`

The client form changes presentation, not semantics.

### 4.2 Middle: Semantix Control Layer

Semantix owns the portable abstractions and review semantics:

- `IntentContract`
- `ExecutionPlan`
- `ExecutionNode`
- `ConstraintSet`
- `CapabilityScope`
- `ApprovalGate`
- `RiskSignal`
- `StateEffect`
- `ProvenanceRecord`
- `ResumeCheckpoint`

### 4.3 Middle: Codex Runtime Adapter

The Codex-specific adapter implements the runtime-facing contract for this POC.

Its job is to:

- accept approved nodes or subgraphs from Semantix
- dispatch them into Codex
- normalize Codex results into Semantix-shaped objects
- return structured run events, proposed effects, risk signals, provenance, and status transitions
- support pause and resume at safe checkpoints

This is where Codex-specific translation belongs. It should not leak into the Control Surface.

### 4.4 Bottom: Codex Runtime

Codex is the concrete workload engine in this prototype.

It:

- executes tasks
- performs multi-step reasoning
- creates or modifies files
- interacts with the local environment

For this POC, Codex should be treated as replaceable. The Semantix architecture must remain valid
if a different runtime is substituted later.

### 4.5 Underneath: Computation Providers And Tools

Under Codex sit the raw capabilities:

- model providers
- retrieval systems
- tools and MCP integrations
- local filesystem and shell access

Those providers matter operationally, but they are still below the Semantix control layer.

## 5. Contract Boundaries

To stay aligned with the other docs, the POC should respect three distinct contracts.

### 5.1 ProviderAdapterContract

This contract covers direct provider-facing calls such as:

- completion
- tool call
- retrieval
- embeddings
- verifier call

If the POC needs direct verifier or retrieval calls outside Codex, they belong here.

### 5.2 RuntimeAdapterContract

This contract is implemented in the POC by the Codex runtime adapter.

It covers:

- accepting Semantix-approved work units
- exposing node and edge status back to Semantix
- simulating or summarizing effects when possible
- executing nodes
- pausing and resuming
- returning diffs, risks, provenance, and status events

In a fuller runtime such as Phalanx, the runtime adapter may also participate in domain-plan
compilation. In this POC, Semantix should own the top-level review artifact and Codex should own
execution of approved work.

### 5.3 ReviewControlContract

This contract is owned by Semantix.

It defines:

- intent review
- graph rendering model
- node inspection model
- state diff model
- approval semantics
- freshness semantics
- audit semantics

The Control Surface renders this contract. It must not infer it from Codex chat output.

That requirement applies equally to browser and terminal-native clients.

## 6. Key Principle

> The Semantix Control Surface must render structured Semantix objects, never raw Codex transcripts.

## 7. Non-Negotiable Design Rules

### 7.1 No Transcript-Driven UI

The UI must never derive truth from Codex conversation logs.

- no parsing chat history for authoritative state
- no reconstructing plan state from text
- no rendering execution truth from transcripts

This includes terminal-native clients. A CLI can render structured state. It must not become a
special transcript-only path.

All authoritative UI state must come from structured objects such as:

- `ExecutionPlan`
- `ExecutionNode`
- `NodeInspectorPayload`
- `StateEffect`
- `ProposedChange`
- `RiskSignal`

### 7.2 Codex Is A Runtime Implementation, Not The System

Codex must remain replaceable.

Semantix owns:

- intent
- constraints
- graph semantics
- approvals
- freshness rules
- audit semantics

Codex executes approved work through the runtime adapter.

### 7.3 Every Meaningful Action Must Be Represented As A Node

Nothing important is implicit.

Visible nodes should include:

- generation
- critique
- verification
- retry
- file mutation
- approval wait

If a step matters to trust, it should be visible in the graph.

### 7.4 State Effects Must Be Explicit Before Execution

Side effects must be surfaced before execution continues.

That includes:

- file diffs
- API calls
- system changes
- external actions

At the Semantix abstraction level these are `StateEffect` objects. In the Control Surface they are
rendered through the state diff model as proposed changes with:

- risk signals
- enforcement status
- reversibility

### 7.5 Review Is Structural, Not Conversational

Users interact with:

- graph
- nodes
- constraints
- diffs
- approval gates

Not with:

- chat logs
- prompt tweaking as the primary control mode

### 7.6 The Critique And Review Path Must Be Inspectable

Review cannot be hidden behind a pass or fail badge.

The system must expose the critique and review path as inspectable structure with:

- inputs
- evidence
- critique
- confidence
- gating outcome

### 7.7 Approvals Must Bind To Fresh, Versioned State

This POC should honor the same freshness rules as the Control Surface spec.

Every approval action should bind to:

- `planVersion`
- `artifactHash`
- relevant node revision

If state has changed underneath the reviewer, the approval must be rejected as stale and the UI
must require re-review.

### 7.8 Audit Recording Is Required In v1

The POC should persist structured review events, not just render them.

At minimum, approval and rejection events should record:

- plan version
- artifact hash
- node or change identifiers
- reviewer action
- timestamp

## 8. POC Execution Flow

1. The user submits a goal.
2. Semantix drafts an `IntentContract`.
3. Semantix compiles a versioned `ExecutionPlan` and review artifact.
4. A browser client or `stx` terminal client renders the graph, inspector, and state diff from
   structured Semantix objects.
5. The reviewer inspects nodes, edits constraints or context, and approves safe structure.
6. Approved nodes or subgraphs are dispatched to the Codex runtime adapter.
7. Codex executes the approved work against the local environment.
8. The adapter returns structured `RunEvent`, `StateEffect`, provenance, risk, and status data.
9. The Control Plane broadcasts updates so both browser and terminal-native clients can refresh
   graph state, node inspection payloads, and diff previews.
10. If an approval gate is reached, or if reviewed state becomes stale, execution pauses.
11. The reviewer approves, modifies, or rejects against the latest artifact version.
12. Semantix freshness-checks the action and resumes from a `ResumeCheckpoint` when valid.
13. Audit records persist what was shown, what changed, and what was approved.

## 9. Core Data Objects

Semantix-level objects:

- `IntentContract`
- `ExecutionPlan`
- `ExecutionNode`
- `ConstraintSet`
- `CapabilityScope`
- `ApprovalGate`
- `RiskSignal`
- `StateEffect`
- `ProvenanceRecord`
- `ResumeCheckpoint`

Control Surface view models:

- `NodeInspectorPayload`
- `ProposedChange`

POC runtime telemetry:

- `RunEvent`

## 10. What This POC Proves

If successful, the POC proves:

- an existing agent runtime can already do the work
- the missing layer is not more raw execution, but governance
- Semantix can sit above a live runtime without collapsing into a transcript viewer
- the Control Surface can form trust from structured objects rather than conversation logs
- runtime execution can be interrupted, reviewed, and resumed under Semantix control

## 11. Final Framing

This POC should leave the reader with the following conclusion:

- Codex is the concrete executor in the demo
- Semantix is the control layer that makes execution inspectable, interruptible, and safe to approve
- the architecture remains valid even if Codex is later replaced by Phalanx or another runtime

> Codex does the work.  
> Semantix makes the work inspectable, interruptible, and safe to approve.
