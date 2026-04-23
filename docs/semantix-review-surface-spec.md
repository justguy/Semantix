# Semantix Review Surface Spec

## Working Title

**Semantix Review Surface v1**

Core interaction model:

- **Execution Graph**: what the system plans to do
- **Node Inspector**: why a step exists, what it can see, and how safe it is
- **State Diff**: what will become real if execution continues

This is the missing human interaction and visualization layer across Semantix, Phalanx, Hoplon, CT-MCP, Guardrail, and LLM Tracker.

---

## 1. Purpose

The Review Surface exists to answer one question before the system acts:

> **What is this system about to do, why, and do I trust it?**

It is not a chat UI, a debugging dashboard, or a passive observability screen.
It is the control room where humans:

- inspect the compiled plan
- understand where the system is grounded vs guessing
- review predicted side effects
- intervene locally
- approve, edit, challenge, or reject execution

This is the surface where Semantix becomes legible and trustworthy.

---

## 2. Product Thesis

Current AI systems usually expose either:

- chat transcripts
- logs
- raw traces
- orchestration graphs with little semantic meaning

Those are not enough for human trust.

Semantix needs a first-class review artifact that merges:

- the **semantic plan**
- the **deterministic control structure**
- the **safety and policy boundaries**
- the **predicted state changes**
- the **confidence and provenance signals**

The Review Surface is that artifact.

---

## 3. Strategic Role In The Stack

### Semantix
Provides:
- Intent Contract
- context scopes
- constraints
- semantic regions
- compiled blueprint metadata

### Phalanx
Provides:
- execution graph
- node ordering
- orchestration state
- approval checkpoints
- pause/resume lifecycle

### Hoplon
Provides:
- file diffs
- structural validation
- AST evidence
- scope enforcement results
- blocked mutations

### CT-MCP
Provides:
- contradiction flags
- critique results
- semantic risk markers
- bounded rewrite recommendations
- escalation signals

### LLM Tracker
Provides:
- trace history
- provenance
- token/context lifecycle
- execution replay metadata
- model and verifier metadata

### Guardrail
Provides:
- command-level contract checks
- parameter risk flags
- command preview surfaces
- approval reuse cues for bounded automation

### Review Surface
Combines all of the above into one human-facing interaction layer.

---

## 4. Design Principles

### 4.1 Review Structure, Not Vibes
Humans do not approve a reassuring paragraph from the model.
They approve:

- structure
- capability exposure
- sequence
- predicted side effects
- risk posture

### 4.2 Local Intervention Over Global Restart
If one node is weak, the user should challenge that node directly instead of restarting the whole run.

### 4.3 Show Where The System Is Guessing
The interface must expose where output is:

- grounded
- transformed
- bridged
- unsupported

### 4.4 Side Effects Must Be Concrete
The user should always see what changes if execution proceeds.
No irreversible action should feel hidden behind fluent language.

### 4.5 Human Speed And Silicon Speed Must Stay Separate
The system can simulate, validate, and critique automatically.
But ambiguity, policy boundaries, and approval-gated transitions must slow down for human judgment.

### 4.6 The Safe Path Must Feel Easier Than The Unsafe One
The UI should make it faster to challenge, tighten, and approve safely than to ignore uncertainty.

---

## 5. v1 Scope

The first version should focus on three tightly integrated surfaces:

1. **Execution Graph**
2. **Node Inspector**
3. **State Diff**

That is enough to demonstrate the core Semantix workflow:

1. compile plan
2. inspect nodes
3. review predicted changes
4. intervene locally
5. approve or reject execution

Out of scope for v1:

- full collaborative multi-user workflows
- rich reporting exports
- full historical replay studio
- advanced layout customization
- deep prompt editing surfaces
- token-by-token provenance rendering

---

## 6. Primary Users

### 6.1 Engineering Manager / Technical Approver
Needs to know:
- whether the system understood the task
- whether risky actions are bounded
- whether the plan is safe to authorize

### 6.2 Staff / Senior Engineer
Needs to know:
- what each step can see
- what each step can do
- where weak assumptions exist
- how to correct one node without collapsing the run

### 6.3 Operator / Reviewer
Needs to know:
- what changed
- what is blocked
- what requires explicit approval
- whether the system can continue safely

### 6.4 Builder / Architect
Needs to know:
- whether the Semantix program compiled into the right execution structure
- whether the constraints and boundaries are doing real work

---

## 7. Core User Questions

The Review Surface must let a user answer these quickly:

- Did the system understand the task correctly?
- What are the major execution steps?
- Which nodes are deterministic, semantic, or hybrid?
- What context is visible to each node?
- Which tools are visible at each stage?
- Where is the system grounded versus inventing glue?
- What is predicted to change if I approve?
- What is blocked by policy or structure?
- Which nodes are risky, overloaded, or under-specified?
- What can I edit locally to make this safe?

---

## 8. Information Architecture

### Top-Level Layout

A three-panel layout is recommended.

#### Panel A: Execution Graph
Visual representation of plan structure and node health.

#### Panel B: Node Inspector
Detailed information for the selected node.

#### Panel C: State Diff
Deterministic view of predicted or completed side effects.

A slim top bar should carry run-level status and global actions.

---

## 9. Execution Graph Spec

## 9.1 Purpose
The Execution Graph is the human-readable plan.
It shows:

- what the system intends to do
- in what order
- with what dependencies
- where approvals and validations occur
- where risk is concentrated

## 9.2 Node Types
Each node must declare a type:

- **Deterministic**
- **Semantic**
- **Hybrid**
- **Approval Gate**
- **Validation Gate**
- **Policy Gate**
- **Side Effect**

Optional future node types:
- Human Input
- Retry Loop
- Fallback Branch
- Escalation Branch

## 9.3 Node Status States
Each node should display status clearly:

- Not Started
- Planned
- Ready
- Running
- Waiting For Review
- Passed
- Warned
- Blocked
- Failed
- Skipped

## 9.4 Risk / Confidence Coloring
Recommended color semantics:

- **Green**: deterministic or directly grounded
- **Yellow**: transformed but acceptable
- **Orange**: weak grounding, unresolved assumption, or overloaded step
- **Red**: approval-required, high-risk, policy-sensitive, or unsupported
- **Gray**: inactive / not started / skipped

## 9.5 Node Summary Fields
Every graph node should surface:

- title
- node type
- status
- grounding band
- confidence band
- approval requirement indicator
- side-effect indicator
- source count
- tool count

## 9.6 Edge Semantics
Edges should distinguish:

- execution order
- data dependency
- approval dependency
- fallback path
- retry path

v1 may simplify this visually while still preserving the underlying model.

## 9.7 Graph Interactions
Users should be able to:

- click a node to inspect it
- zoom and pan
- collapse or expand subgraphs
- filter by risk, status, or type
- highlight approval-required nodes
- highlight nodes with predicted side effects
- trace downstream impact from one selected node

## 9.8 Graph-Level Controls
Suggested controls:

- Show only risky nodes
- Show only side-effecting nodes
- Show policy gates
- Show approvals
- Show deterministic vs semantic split
- Reset layout

---

## 10. Node Inspector Spec

## 10.1 Purpose
The Node Inspector explains a node in enough detail for a human to decide whether it is safe, correct, and adequately bounded.

## 10.2 Required Sections

### A. Summary
- node title
- node id
- type
- current status
- owner subsystem (Semantix / Phalanx / Hoplon / CT-MCP / Tracker / Guardrail)
- short purpose statement

### B. Intent Linkage
Shows how this node maps back to the frozen Intent Contract:

- relevant directive
- relevant boundary
- success-state linkage
- why this node exists

### C. Context Scope
Shows exactly what the node can see:

- context sources
- retrieved docs / chunks
- upstream outputs
- scoped variables
- context exclusions
- freshness status

### D. Constraints
Shows active output / behavior constraints:

- hard constraints
- soft constraints
- semantic requirements
- schema expectations
- budget / time / retry ceilings

### E. Capability Visibility
Shows what the node can do:

- visible tools
- hidden tools
- permission level
- policy mode status
- approval preconditions

### F. Grounding & Provenance
Shows epistemic status:

- grounding band
- transformed content presence
- bridged assumption count
- unsupported claim warnings
- provenance strength
- source coverage confidence

### G. CT-MCP / Verification Signals
Shows challenge data:

- contradiction flags
- unresolved assumptions
- critique summary
- bounded rewrite recommendation
- escalation recommendation

### H. Output Preview
Shows what this node is expected to produce:

- structured output preview
- generated text summary
- extracted schema view
- ranking / classification result preview

### I. Side-Effect Preview
If relevant, show:

- downstream mutations
- files touched
- APIs called
- external actions triggered
- whether action is reversible

### J. Actions
Node-level human actions should include:

- Approve node
- Challenge node
- Edit constraints
- Add source
- Remove source
- Split node
- Require approval
- Re-run node
- Reject node

---

## 11. State Diff Spec

## 11.1 Purpose
The State Diff answers:

> **What becomes real if this continues?**

It must be deterministic, inspectable, and never replaced by prose alone.

## 11.2 State Diff Categories
The diff panel should group changes by type:

- Files
- API Calls
- Database Mutations
- Messages / Emails / Notifications
- Tickets / Tasks / Workflow State
- Command Execution
- Policy State Changes

## 11.3 Diff States
Each proposed change should be labeled:

- Proposed
- Simulated
- Approved
- Executed
- Blocked
- Rejected
- Rolled Back

## 11.4 Required Fields Per Change
Each change record should show:

- resource type
- target resource
- action type
- originating node
- structural validation result
- policy result
- approval requirement
- reversibility
- confidence / provenance cues

## 11.5 File Change View
For file operations, support:

- path
- create / modify / delete
- line or AST summary
- structural validity
- out-of-scope detection
- Hoplon evidence if blocked

## 11.6 Command / External Action View
For commands and external effects, support:

- command or API preview
- parameters
- bounded parameter status
- risk flags
- Guardrail contract status
- environment or target system

## 11.7 State Diff Interactions
Users should be able to:

- filter changes by status or type
- sort by risk or originating node
- click a change to jump to its originating node
- approve a specific change if policy allows
- reject a specific change
- inspect validation evidence

---

## 12. Run-Level Header / Control Bar

The top bar should summarize the run as a whole.

Required fields:

- run status
- current phase
- total nodes
- blocked nodes
- approval-required nodes
- predicted side effects count
- current risk band
- freshness state

Primary actions:

- Approve run
- Pause run
- Reject run
- Recompile / refresh
- Export review artifact

---

## 13. Human Intervention Model

The Review Surface should support targeted intervention.

## 13.1 Challenge Flow

1. user selects a node
2. system shows why it is weak, risky, or overloaded
3. user edits one part of the execution artifact
4. system regenerates only the affected region
5. downstream impact is recomputed
6. user re-reviews the changed portion

## 13.2 Supported v1 Interventions

- add missing source
- remove irrelevant source
- tighten or edit a constraint
- split one node into two
- mark node as approval-required
- reject a predicted side effect
- request re-generation for one node

## 13.3 Explicit Human Decisions
The system should preserve human decisions as workflow state, not chat text.

Examples:

- approved as-is
- approved with local edits
- rejected due to policy risk
- blocked pending more context
- escalated for manual handling

---

## 14. Data Model Sketch

The exact implementation can evolve, but the UI needs stable DTO-style contracts.

## 14.1 ExecutionNode

```ts
interface ExecutionNode {
  id: string;
  title: string;
  type: 'deterministic' | 'semantic' | 'hybrid' | 'approval_gate' | 'validation_gate' | 'policy_gate' | 'side_effect';
  status: 'planned' | 'ready' | 'running' | 'waiting_review' | 'passed' | 'warned' | 'blocked' | 'failed' | 'skipped';
  grounding: 'grounded' | 'transformed' | 'bridged' | 'unsupported';
  confidenceBand: 'high' | 'medium' | 'low';
  approvalRequired: boolean;
  sideEffecting: boolean;
  sourceCount: number;
  toolCount: number;
  owner: 'semantix' | 'phalanx' | 'hoplon' | 'ct_mcp' | 'tracker' | 'guardrail';
}
```

## 14.2 NodeInspectorPayload

```ts
interface NodeInspectorPayload {
  nodeId: string;
  purpose: string;
  intentLinks: {
    directive?: string;
    boundaries?: string[];
    successState?: string;
  };
  context: {
    visibleSources: string[];
    upstreamInputs: string[];
    excludedSources?: string[];
    freshness: 'clean' | 'soft_stale' | 'hard_stale';
  };
  constraints: {
    hard: string[];
    soft: string[];
    schema?: string;
    budgets?: string[];
  };
  capabilities: {
    visibleTools: string[];
    hiddenTools?: string[];
    permissionLevel?: string;
    approvalPreconditions?: string[];
  };
  verification: {
    contradictionFlags?: string[];
    critiqueSummary?: string;
    escalationRecommended?: boolean;
  };
  outputPreview?: {
    summary?: string;
    structuredData?: unknown;
  };
  sideEffects?: string[];
}
```

## 14.3 ProposedChange

```ts
interface ProposedChange {
  id: string;
  category: 'file' | 'api' | 'database' | 'message' | 'command' | 'workflow';
  target: string;
  action: string;
  status: 'proposed' | 'simulated' | 'approved' | 'executed' | 'blocked' | 'rejected' | 'rolled_back';
  originatingNodeId: string;
  policyStatus: 'pass' | 'warn' | 'block';
  structuralStatus?: 'valid' | 'invalid' | 'unknown';
  reversible?: boolean;
  evidence?: string[];
}
```

---

## 15. Example End-To-End UX Flow

### Scenario
User asks the system to update a service, generate a migration, and open a pull request.

### Flow
1. Semantix compiles the intent and constraints.
2. Phalanx builds the execution graph.
3. CT-MCP flags one migration node as weakly grounded.
4. Hoplon predicts three file changes and blocks one out-of-scope path.
5. Guardrail marks one command parameter as risky.
6. The Review Surface opens with:
   - one orange node
   - one blocked diff
   - one approval-required side effect
7. User clicks the orange node.
8. Node Inspector shows missing schema input and a bridged assumption.
9. User adds the missing schema source.
10. System regenerates only that node and recomputes downstream dependencies.
11. Orange node becomes yellow, blocked path disappears, diff narrows.
12. User approves the run.
13. System continues execution.

---

## 16. MVP Acceptance Criteria

The v1 is successful if a user can:

1. see the full plan as a graph
2. click any node and understand its context, constraints, tools, and risk
3. see all predicted side effects in deterministic form
4. identify which nodes are weak or blocked
5. challenge or edit one node without restarting the full run
6. approve or reject execution with confidence

---

## 17. Non-Functional Requirements

### Performance
- graph should render quickly for medium-sized runs
- node selection should feel immediate
- local regeneration should feel scoped, not global

### Auditability
- human decisions must be persisted
- diffs and node state transitions must be replayable
- approval actions should be attributable and durable

### Safety
- risky actions must not be hidden behind collapsed UI by default
- approval-required nodes must be visually obvious
- blocked changes must carry evidence

### Clarity
- avoid jargon-first presentation
- raw traces can exist, but not as the primary surface
- the first read should orient an engineer in seconds

---

## 18. Suggested UI Composition

A practical v1 component tree could look like:

- `ReviewSurfaceShell`
  - `RunHeader`
  - `ExecutionGraphPanel`
    - `GraphToolbar`
    - `ExecutionGraphCanvas`
    - `NodeLegend`
  - `NodeInspectorPanel`
    - `NodeSummaryCard`
    - `IntentLinkCard`
    - `ContextScopeCard`
    - `ConstraintCard`
    - `CapabilityCard`
    - `GroundingCard`
    - `VerificationCard`
    - `OutputPreviewCard`
    - `NodeActionsBar`
  - `StateDiffPanel`
    - `DiffToolbar`
    - `ChangeGroupList`
    - `ChangeDetailView`

---

## 19. Product Positioning

This surface should be described internally and externally as:

> **the place where humans inspect, challenge, and approve compiled AI execution before it becomes real**

Not:
- an agent dashboard
- a chat assistant UI
- a workflow monitor
- a trace browser

Those may exist around it, but this is the trust surface.

---

## 20. Future Extensions

After v1, natural extensions include:

- review packs for async approval
- multi-user comments and threaded challenge flows
- replay mode and historical diffing
- richer provenance overlays
- semantic span highlighting
- comparative branch review
- scenario simulation / sandbox mode
- approval policies by role
- exportable audit artifacts

---

## 21. Bottom Line

The Review Surface is how Semantix comes together across all layers.

Without it:
- Semantix remains conceptual
- Phalanx feels like orchestration glue
- Hoplon feels like a narrow enforcement subsystem
- CT-MCP feels like critique machinery
- LLM Tracker feels like observability

With it:
- the system becomes legible
- human trust has a home
- approval becomes structural
- side effects become visible
- semantic uncertainty becomes actionable

This should be treated as a first-class product surface, not a supporting dashboard.
