# Semantix: A Semantic Programming Language and Control Plane for Governed LLM Execution

*The missing artifact is not another clever prompt. It is a compiled, reviewable execution contract.*

## Executive Summary

Large language models are good at semantic work and bad at being trusted as the final authority over real-world state. Humans think in intent, goals, constraints, and outcomes. LLMs operate over tokens, probabilities, and pattern completion. Current AI software stacks often respond to that mismatch by pushing more burden onto humans: larger prompts, more transcript reading, more hand-built validators, and more orchestration glue.

Semantix proposes a different split of responsibility.

- Humans define intent, invariants, success conditions, permissions, and escalation rules.
- Models perform bounded semantic work such as generation, extraction, summarization, ranking, and interpretation.
- Compilers and runtimes translate soft instructions into hard boundaries where possible.
- Deterministic systems remain the authority over state, permissions, side effects, and approval-gated execution.

Semantix is best understood first as a semantic programming language for AI. It translates human intent into bounded semantic contracts that machines can execute. Operationally, those compiled contracts are enforced through a semantic control plane for LLM-mediated execution.

Concretely, Semantix includes:

- a language surface for fenced semantic computation
- a compiler and runtime architecture for deterministic boundaries around model behavior
- a human review methodology that turns probabilistic plans into inspectable engineering artifacts

Its central claim is simple:

**LLM outputs should become proposals that must pass deterministic contracts before they become real.**

This paper describes that architecture, the trust model behind it, the review surface that makes it human-usable, and the phase-1 proof of concept that uses Codex as the initial runtime adapter.

The proof sequence matters. A narrow v0 proves governance. A sharper v0.5 proves that one risky workflow becomes obviously safer and more usable with Semantix than with a bare LLM. A fuller v1 broadens that into a new programming model.

In that sense, Semantix is to LLM execution what a compiler is to CPUs: a translation layer that turns human-readable intent into bounded machine behavior.

It should be read as a design and implementation direction, not as a claim that every subsystem is already complete in production form.

## 1. The Problem: Today's LLM Stacks Put Trust In The Wrong Place

Most current LLM tooling is optimized for access to model capability, not for governance of model-mediated execution.

That creates a recurring pattern:

- too much trust in the model to preserve structure
- too much burden on humans to hand-build every guardrail
- too much hidden state in prompts, transcripts, and conversational drift
- too little visibility into what the system will actually change before it acts

The root mismatch is representational. Humans do not naturally think in next-token distributions, and models do not naturally reason in human intent contracts. Prompt engineering tries to persuade a model to behave across that gap. Production systems need something stricter: a way to translate what the human means into bounded machine behavior, then govern what the model can see, what it may propose, what rules must hold, and what must happen before side effects are allowed.

The missing artifact is not another clever prompt. It is a compiled, reviewable execution contract.

Semantix exists to supply that missing layer.

## 2. The Semantix Thesis

Semantix treats semantic computation as something that must be translated and fenced rather than merely prompted.

Humans should not have to speak "LLM" to get reliable machine behavior. They should be able to declare intent, boundaries, and success conditions in a structure the system can compile. Semantix is that translation layer: a programming model that bridges how humans think and how LLMs operate.

Its operating model is:

- the programmer defines the model's visible context
- the programmer defines the rules that generated outputs must satisfy
- the runtime permits semantic work only inside those boundaries
- deterministic systems admit, reject, downgrade, retry, escalate, or pause based on contract state

This is the core difference between prompt engineering and governed execution. Prompting asks a model to behave. Semantix programs the boundaries inside which the model is allowed to behave.

Semantix does not attempt to make a model intrinsically deterministic. It makes the shell around the model deterministic enough to engineer, debug, test, review, and trust.

The basic beginner-facing primitives are:

- `context`: the scoped working set for one semantic step
- `constraint`: the rules the generated result must satisfy
- `~>`: the explicit boundary where execution crosses from deterministic code into semantic generation

These primitives matter because they force semantic work to be explicit rather than ambient.

Put bluntly, `~>` is where the model is allowed to think. It is the moment where human intent becomes machine speculation under deterministic control. Everything downstream exists to govern what happens after that invocation.

### 2.1 A Minimal Embedded Example

The conceptual surface can be taught with `context`, `constraint`, and `~>`, but the current v0 implementation direction is an embedded DSL inside TypeScript rather than a standalone language frontend. In that embedded form, the same boundary can look like this:

```ts
type EmailVerificationPlan = {
  target_symbol: "applyEmailVerificationPatch";
  patch_plan: Array<{
    path: string;
    action: "create" | "modify";
    summary: string;
  }>;
  state_effect_preview: {
    summary: string;
  };
};

const emailVerification = assign<EmailVerificationPlan>({
  directive: "Add email verification to the signup flow.",
  context: ["src/routes/auth.ts", "src/models/User.ts", "src/lib/email.ts"],
  constraints: [
    "Token must be single-use",
    "Token must expire after 24 hours",
    "Do not modify billing or payments",
    "Do not add new dependencies",
  ],
});
```

The exact surface syntax may evolve, but the important point is stable: the semantic step is explicit, typed, and compiler-lowered into a governed execution-plan artifact. The model does not mutate the system directly. It proposes a typed plan that must pass deterministic admission before a pre-registered execution target may act.

## 3. Dual Execution: The Model Proposes, The Runtime Decides

Semantix is built around a dual execution model.

The logic unit owns:

- arithmetic
- exact comparison
- control flow
- typed data
- file, API, and database access
- permission checks
- policy enforcement
- replayable state transitions

The neural unit owns bounded semantic work such as:

- generation
- summarization
- classification
- semantic matching
- extraction from unstructured input
- ranking and refinement

The important rule is not subtle:

**The neural unit may propose. The deterministic runtime must decide.**

That is also why Semantix should be understood as more than a system for generating answers. In this model, LLMs propose actions, patches, classifications, summaries, or decisions. Semantix, through its deterministic runtime and control-plane machinery, decides whether those proposals are allowed to become real.

That stance changes the architecture completely. The runtime is not a convenience wrapper around a model call. It is a governance engine with deterministic ownership of side effects.

Its job is to:

- decide what execution is allowed to proceed
- block actions that violate hard constraints or policy
- downgrade trust when only soft semantic checks are satisfied
- force escalation when residual risk exceeds system authority
- ensure that nothing becomes real until the required contract has been met

Without this stance, Semantix collapses back into structured prompting. With it, Semantix becomes enforceable.

## 4. From Language To Typed Admission

One of the most important transitions in any AI system is the move from fuzzy language into trusted program state.

Semantix treats that as an admission problem, not a trust-the-model problem.

For structured extraction, the runtime should:

1. derive a schema from the target type
2. generate under that schema
3. parse deterministically
4. validate against the required type
5. retry within a bounded budget if parsing fails
6. admit the value only when it is structurally valid

The same philosophy applies to semantic predicates. A semantic match may still be useful, but the scoring threshold, benchmark set, model version, and acceptable error tradeoff must be versioned operational settings rather than hidden intuition.

Semantix therefore distinguishes between constraints that can compile into hard machinery and constraints that remain softer verification obligations.

Hard-checkable examples include:

- schemas and type checks
- field presence
- max length
- allowlists and denylists
- tool signatures
- permission and budget checks

Softer semantic examples include:

- empathetic tone
- preserving a critical warning
- persuasive but not manipulative language
- capturing a nuanced caveat

The compiler must make that distinction explicitly. Each constraint is classified as `hard`, `soft_verified`, or `hybrid` based on declared checker type and compiler inference; when the boundary is ambiguous, the safe default is `hybrid`, combining a best-effort deterministic check with semantic verification and escalation rules.

Semantix does not pretend every rule becomes a theorem. Some become deterministic gates. Others become explicit review, verification, downgrade, or escalation obligations.

That honesty is part of the design.

## 5. The Invariants Semantix Protects

Semantix is easiest to reason about when framed as invariant protection. When something goes wrong, the first question is not "what prompt should we add?" It is "which invariant broke, and who owns it?"

### 5.1 Structural Invariants

The output must match the required type or schema exactly.

Owner:
- parser
- schema validator
- type system
- deterministic runtime

### 5.2 Contextual Invariants

The model may operate only over the exact scoped information for the current step, and that working set must not silently persist forever.

Owner:
- context manager
- checkpointing system
- semantic frame lifecycle

### 5.3 Policy Invariants

The system must never act outside allowed permissions or policy boundaries.

Owner:
- capability system
- policy engine
- approval layer
- deterministic circuit breakers

### 5.4 Semantic Invariants

The meaning of the result must satisfy higher-order requirements, not just formatting.

Owner:
- layered verification
- provenance and grounding checks
- semantic critique systems
- human review for high-risk cases

For high-risk semantic claims, verification should not rely on the same model family and evidence path as generation when avoidable. Otherwise the review layer collapses toward one correlated signal, and trust must be downgraded or escalated rather than overstated.

This framing also explains Semantix's failure philosophy. Constraint failures may retry. Policy violations hard-stop. Approval-required boundaries pause and escalate. Recovery is architectural, not rhetorical. There is no apology loop.

## 6. Human Workflow: Declare Intent, Review Blueprint, Authorize Execution

Semantix replaces the usual "write code, run code, see if it breaks" loop with a workflow better suited to AI systems:

1. declare intent
2. review blueprint
3. authorize execution

### 6.1 Declare Intent

The system drafts an explicit `IntentContract` from the human request. That draft is itself semantic work, so it is not trusted merely because it exists. It must be reviewed and approved before becoming a deterministic anchor.

A minimal intent contract contains:

- `primary_directive`
- `strict_boundaries`
- `success_state`

This matters because the approved contract becomes a tether to the original goal. If a proposed action no longer advances the directive, crosses a boundary, or breaks the success state, the system halts, replans, or escalates rather than allowing drift to harden into system history.

### 6.2 Review Blueprint

Before execution, Semantix compiles the approved intent into a reviewable execution-plan artifact (`.xplan` in v0). In this paper, `blueprint` refers to that compiled execution-plan artifact, while the `review artifact` is the human-facing projection of the same underlying compiled object. At minimum, that compiled plan should show:

- the frozen intent contract
- semantic frames and context scopes
- visible tools and capability boundaries
- active constraints and policies
- predicted side effects
- fallback paths
- approval checkpoints
- risk markers and confidence signals

This is the point where chat gives way to engineering artifacts.

### 6.3 Authorize Execution

Approval is not a chat reply. It is workflow state.

For durable systems, the correct sequence is:

1. snapshot deterministic state
2. persist the review artifact
3. flush active semantic working memory
4. mark the run `pending_review`
5. resume only after an explicit approve, edit, or reject event

The system should not keep live computation idling while waiting for human judgment. It should pause logically and resume only after valid approval against fresh state.

## 7. The Review Surface: A Control Room, Not A Transcript

The Semantix review surface is where trust is formed.

Conceptually, the Review Surface is the human-facing product surface. Operationally, it is rendered by one or more clients over shared control-plane truth.

It is not a dashboard for watching AI think. It is the control room where humans approve proposed reality before reality changes.

That surface may be rendered as:

- a browser UI
- a terminal-native CLI or TUI such as `stx`

The client form may change. The semantics cannot.

The strongest shape for the control room is three synchronized panels plus global bars:

- an Intent Bar that shows the frozen directive, boundaries, success state, status, plan version, and freshness
- an Execution Graph that shows node types, dependencies, risk colors, approval gates, and conditional summaries
- a Node Inspector that exposes deep details for one selected node
- a State Diff Panel that shows what will actually change in files, APIs, databases, or external systems
- a Bottom Action Bar that exposes aggregate risk state and global actions such as approve, simulate, reject, or execute

This design embodies several product principles:

- review structure, not vibes
- local intervention over global restart
- risk visibility before convenience
- deterministic trust anchors
- the safe path must feel easier than the unsafe one
- approval must bind to fresh state

The question the control room must answer is always the same:

**What is this system about to do, and do I trust it?**

## 8. Make Uncertainty Legible

A major weakness of current AI tooling is that it hides the difference between grounded reasoning and invented connective tissue.

Semantix aims to expose that hidden layer.

At the node level, the review surface should show:

- grounding status
- confidence band and confidence score
- loaded sources
- missing inputs
- verifier result
- expected side effects
- required next action

Confidence needs to mean something more precise than a single reassuring number. In Semantix, it should be a structured aggregation of provenance strength, source coverage, verifier agreement, retry friction, critique signals, and change safety, with each contributing signal versioned independently, the aggregation method itself treated as a versioned runtime setting, and the whole score recomputed when relevant inputs, verifier settings, or model settings change. It is not model self-report. It is a runtime-owned summary of how much evidence the system has to trust the node right now.

The color model is intentionally simple:

- green: deterministic or strongly grounded
- yellow: synthesized but still acceptably supported
- orange: weak grounding, missing evidence, or unresolved ambiguity
- red: blocked, stale, contradictory, or high-risk

For semantic output, the provenance labels should distinguish:

- `grounded`
- `transformed`
- `bridged`
- `unsupported`

This leads to a defining interaction:

**Show me where you're guessing.**

For practical review, that legibility must be concrete rather than theatrical. The strongest warning is not `confidence: 0.6`. It is: "This step uses `signToken()` but no such symbol exists in the current codebase," or "This parameter was invented; no supporting context was found." Each issue should carry the evidence that triggered it and an explicit next move such as add missing source, fix the assumption, split the step, require approval, or block execution.

This is how Semantix interrupts fluent nonsense before it hardens into side effects.

That is a stronger review model than reading polished prose and hoping it is trustworthy.

## 9. Local Intervention And Partial Regeneration

Human oversight should not require restarting an entire run every time one step looks weak.

Semantix treats local intervention as a product requirement.

Allowed v1 interventions include:

- edit context
- edit constraints
- split a node
- regenerate a node
- mark a node as requiring approval

When an intervention occurs, the backend should compute the minimal invalidation set:

- an intent edit invalidates the whole graph and all approvals
- a context edit invalidates the node and downstream consumers
- a constraint edit invalidates the node, associated validators, downstream dependents, and affected approvals
- a tool or capability change invalidates approvals granted under the prior capability surface
- verifier or model setting changes invalidate confidence, critique, and approval state for affected descendants

Invalidated nodes become `stale`. Stale approvals become void.

This matters because it turns human review into targeted architecture work rather than blanket suspicion.

## 10. The Control Plane: Backend Truth For Review And Execution

The Semantix Control Plane is the execution-facing realization of the Semantix language model. It is not the whole identity of Semantix; it is the backend service that enforces compiled Semantix contracts across clients and runtimes.

The Semantix Control Plane sits between control-surface clients and pluggable execution backends.

Its clean layering is:

1. control-surface clients
2. Semantix Control Plane
3. execution adapter layer
4. execution backends
5. computation providers and tools

The Control Plane is not the UI, not the provider layer, and not the execution engine itself.

In v0, these responsibilities are realized by a local, ephemeral runtime scoped to a single `stx` invocation with an in-process HTTP surface rather than a long-lived multi-tenant daemon. The component breakdown here describes the target architecture that emerges as persistence, multi-client coordination, and runtime diversity expand.

Its responsibilities include:

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
- event streaming

Its core components include:

- a control plane daemon
- an artifact store
- an adapter registry
- an execution coordinator
- an approval and freshness gatekeeper
- an event streamer
- a client session gateway

This gives Semantix one backend truth that can be consumed consistently by both browser and terminal-native clients.

## 11. Freshness-Bound Approval

Freshness is not an implementation detail. It is part of the trust model.

Every mutating review action must bind to the exact artifact version the human reviewed. At minimum, that means carrying:

- `planVersion`
- `artifactHash`
- relevant node revision
- any relevant change identifier or diff reference

The backend must reject stale actions server-side.

The minimum stale-state rules are:

- if the intent contract changes, the plan becomes stale
- if a node's context or constraints change, the node and downstream dependents become stale
- if the runtime capability surface changes, prior approvals become stale
- stale reviewed state cannot be reused for execution

Trust cannot depend on a UI being lucky enough to still be current.

## 12. Eventing, Audit, And Replay

Semantix treats review and execution as first-class auditable workflow, not ephemeral conversation.

Normalized events should include:

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

For each review event, the backend should persist:

- artifact identifiers and hashes
- plan and graph versions
- reviewed node revisions and risk state
- proposed changes shown to the reviewer
- enforcement and critique summaries in effect
- reviewer identity
- the action taken
- optional reason or annotation
- timestamp

This is how Semantix makes replay, debugging, and audit possible without reconstructing truth from transcripts after the fact.

## 13. Runtime Adapters And The Phase-1 Codex POC

Semantix is designed for pluggable runtimes. Over time, it should be able to coordinate adapters such as:

- `CodexCliRuntimeAdapter`
- `ClaudeCliRuntimeAdapter`
- `PhalanxRuntimeAdapter`
- provider-backed executors over systems such as OpenRouter or Gemini

For phase 1, the execution plug is intentionally narrow:

- one runtime adapter is implemented: `CodexCliRuntimeAdapter`
- one active execution backend is assumed per run
- runtime selection is effectively fixed to `codex_cli`

For the current v0 implementation direction, Semantix is also not introduced as a standalone language toolchain. The v0 language surface is realized as a TypeScript-embedded DSL compiled by a custom transformer. That embedded form gives Semantix a real compiler path, host-language type checking, and immediate editor integration without requiring a multi-year standalone language infrastructure build. A standalone surface remains open as a later option if adoption warrants.

The Codex proof of concept is important because it makes the architectural separation concrete.

The POC is not:

- a Codex UI
- a transcript viewer
- a claim that Codex becomes Semantix

It is a demonstration that Semantix can govern an already-capable runtime and make its execution:

- bounded
- inspectable
- governable
- resumable
- reviewable

The phase-1 system should prove:

- existing agent runtimes can already execute complex work
- what they lack by default is structured review, approval semantics, and trust formation
- Semantix can sit above a live runtime without collapsing into transcript-driven control
- trust can form from structured objects rather than conversational logs
- runtime execution can be interrupted, reviewed, and resumed under Semantix control

Codex proves the loop. Semantix proves the control.

### 13.1 From Governance Proof To Product Pull

A governance proof is necessary, but by itself it can still feel abstract. A system can show execution graphs, approval gates, strict schemas, pause and resume, and still leave a user thinking that the architecture is correct without yet feeling indispensable.

That is why the next proof after v0 should be narrower rather than broader. Semantix v0.5 should combine the governance backbone with one real workflow where the system is visibly better than "just using an LLM." The target reaction is simple: **I would not run this workflow without Semantix.**

For software engineering, the strongest candidate is code-change execution. A useful example is a request such as: add email verification to the signup flow without touching billing or introducing new dependencies. The system produces a plan graph, a proposed patch, and a diff preview. The proposal looks plausible, but it wires the flow through `signToken()` even though no such helper exists in the repository. Semantix checks the codebase, finds no supporting symbol, marks the node as invented or unsupported, and surfaces explicit next moves: add missing source, replace the assumption with an existing utility, split the step, require approval, or block execution. The important moment is that a fluent but ungrounded change is stopped before it touches authentication code or persistent state.

The defining moment is not that the system computes a confidence score. It is that it says, concretely, this proposed change depends on a symbol that is not in your codebase or on an assumption that is not grounded in the loaded context.

The strict node-level IR still matters in that flow. It lives inside the `.xplan` artifact as the compiler-facing contract that semantic nodes must satisfy. But for the human, its value becomes visible through concrete artifacts: diff previews, issue messages, evidence panes, intervention suggestions, and approval state rather than raw validator internals.

Seen this way, the proof ladder is:

- v0: Semantix can govern execution.
- v0.5: Semantix can expose a plausible model mistake before it causes damage in one real workflow.
- v1: Semantix grows into a broader programming model and language surface.

This sequencing matters because pull comes from visible leverage, not from abstract correctness alone.

## 14. Semantix In The Broader Stack

Semantix is the center of gravity in a broader execution stack.

The computation provider layer exposes raw capabilities:

- LLM APIs
- tool calling
- embeddings
- retrieval
- MCP servers
- provider-specific quirks

But that is not where trust is formed.

Semantix defines the portable contract and review model across domains:

- intent contracts
- execution plans and nodes
- constraints
- capability scopes
- approval and verification surfaces
- provenance, risk, and resume semantics

In a fuller Semantix ecosystem, the control plane composes with adjacent subsystems that each take one critical responsibility out of the model's context window and move it into infrastructure. Examples include:

- Phalanx, a domain runtime for software engineering, implements Semantix abstractions for multi-step engineering workflows, approval checkpoints, and bounded mutation in that domain.
- Hoplon, the deterministic enforcement layer, constrains filesystem and code mutation through scoped write authority, AST verification, snapshots, and deterministic diffs.
- CT-MCP, the semantic critique layer, challenges contradictions, fabricated logic, and weak reasoning, then forces bounded rewrite or escalation when semantic confidence is too weak.
- LLM Tracker, the observability and memory layer, records task state, execution history, provenance, and replay context so the system does not have to recover long-term commitments from chat alone.
- Guardrail, the smaller local entry point, applies the same contract-first philosophy to commands, scripts, and scoped local execution without pretending to be the whole orchestrator.

The Review Surface then merges these outputs into a single trust-forming view, rendered through a browser client, terminal-native client, or another client form over the same control-plane truth.

That separation matters. Semantix should not collapse into just another orchestrator or domain runtime. Its role is to make probabilistic systems human-governable.

## 15. Why Semantix Matters

Semantix matters because current AI construction patterns are still too close to this:

- prompts
- chains
- orchestration glue
- hope

Its alternative is an execution discipline:

- contracts
- compiled execution
- enforced boundaries
- review and approval
- replay and audit

The larger shift is cultural as much as technical.

For the last two years, the industry has repeatedly forced humans to speak "LLM" by writing larger prompts, reading raw JSON, and reconstructing state from transcripts. Semantix argues for the reverse direction: forcing the LLM stack to speak "Human" by translating probabilistic plans into familiar engineering artifacts and executable semantic contracts that teams can inspect, challenge, approve, and govern.

In one sentence:

**Semantix is a semantic programming language that bridges human intent and LLM execution by compiling intent into governed contracts and enforcing them through deterministic machinery.**

## 16. Conclusion

The next phase of AI engineering is not simply making agents more active. It is making their execution programmable, legible, bounded, interruptible, freshness-checked, and safe to approve.

Semantix is a proposal for that missing layer.

It gives models room to do what they are good at. It gives deterministic systems authority over what matters. And it gives humans a programming model, compiler path, and control room where trust can be formed before reality changes.
