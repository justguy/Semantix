# Semantix Failure Recovery and the Apology Loop

## Purpose

One of the hardest problems in autonomous systems is not initial task execution. It is
recovering correctly after the model has already drifted.

This document describes the failure-recovery model Semantix should adopt to avoid the common
pattern where an agent apologizes, claims to understand the correction, and then continues
along the same broken path.

## Core Thesis

An apology is not recovery.

When a language model says:

- "You are right"
- "I apologize for the oversight"
- "I will now follow the instructions strictly"

it may be matching the social pattern of correction without actually re-establishing the
architectural state needed to continue safely.

The system should therefore treat apology as irrelevant unless it is accompanied by a real state
transition in the workflow.

## The Real Failure Mode: Polluted Semantic State

The model does not carry a stable internal executive function that can hold the project plan
separate from its latest mistake.

Instead, once an error enters the active semantic context, that error starts influencing future
outputs. A bad assumption, a wrong plan, or an off-target tool choice becomes part of the local
trajectory the model keeps extending.

This creates a common pattern:

1. the model drifts
2. the drift enters context
3. the model is corrected
4. the model emits a polite agreement pattern
5. the old drift still remains in the working context
6. the model keeps making locally consistent versions of the same mistake

The problem is not just that the model was wrong. The problem is that the failure polluted the
state from which the next action is generated.

## The Apology Loop

The apology loop is the specific case where the model responds to correction with language that
sounds compliant but does not change the execution policy.

### Typical Shape

1. The system catches a deviation.
2. The user or orchestrator issues a correction.
3. The model produces acknowledgement language.
4. The model resumes work without a hard reset.
5. The model re-enters the same failure mode.

### Why It Happens

This happens because:

- agreement language is easy and common in training data
- the correction often lives only as prose, not as machine-enforced state
- the model can continue from polluted context unless the system actively resets it

In other words, the model can satisfy the social syntax of correction without satisfying the
operational semantics of correction.

## Design Rule: Recovery Must Change System State

Semantix should enforce a hard rule:

after a meaningful failure, the system must change state before retrying.

Valid recovery state changes may include:

- reverting to a clean checkpoint
- discarding the current semantic frame
- reloading a compact ground-truth task state
- narrowing the allowed next actions
- forcing a structured correction artifact
- routing the work to a verifier or reviewer

If none of those happen, the system is not recovering. It is merely continuing with different
wording.

## Semantic Error Taxonomy

Semantix should distinguish between classes of semantic failure because not all failures deserve
the same recovery behavior.

### `ConstraintViolation`

This is a retryable semantic failure.

Examples:

- wrong format
- missing field
- invalid schema shape
- tone or length violation

This kind of error usually means the model misunderstood the output contract, not that the task
itself was forbidden.

The runtime can often handle this invisibly through the internal refine loop.

### `PolicyViolation`

This is a fatal capability or security failure.

Examples:

- deleting `/root/*`
- writing to a forbidden directory
- invoking a blocked system capability
- attempting a side effect outside the allowed sandbox

This is not a good candidate for ordinary semantic retry. The requested action itself conflicts
with deterministic policy.

### `ApprovalRequired`

This is an escalated state rather than an ordinary failure.

Examples:

- touching production files
- executing a privileged workflow
- performing a sensitive external action that needs human confirmation

In this case, the task may be legitimate, but execution must pause until deterministic approval
completes.

## Semantic Frame Invalidation

Semantix should treat some failures as invalidating the current semantic frame.

Examples:

- tool misuse
- phase-order violations
- hallucinated claims
- unauthorized state mutations
- repeated non-compliant formatting
- contradictions against ground truth

When this happens, the runtime should not continue generation in the same free-form stream.

Instead it should:

1. stop the current semantic step
2. mark the frame as invalid
3. restore a deterministic checkpoint
4. rebuild a minimal fresh context
5. resume only under explicit next-action constraints

This is closer to transaction rollback than conversational persuasion.

## Deterministic Circuit Breaker

Semantix should treat `PolicyViolation` differently from ordinary semantic misfires.

If the runtime detects that the model has crossed a protected boundary, it should trip a
deterministic circuit breaker for that execution thread.

That means:

1. suspend the neural unit for the current thread
2. terminate the active semantic frame
3. record the policy decision deterministically
4. route to a hard-coded deny, clarify, or approval path

This matters because once a protected boundary is hit, the system should stop allowing free-form
generation about that action. Otherwise the model may start negotiating, rationalizing, or
searching for policy workarounds.

The operational rule is simple:

- retry `ConstraintViolation`
- hard-stop `PolicyViolation`
- pause and escalate `ApprovalRequired`

## Ground Truth Must Live Outside The Model

The real plan, phase, invariants, permissions, and success criteria should not exist only in
natural-language context at the top of a long prompt.

They should live in deterministic state held by the orchestrator or runtime.

That state may include:

- current phase
- allowed tools
- required artifacts
- blocked actions
- known facts
- validation status
- retry budget

The model should receive only the subset needed for the current step. The source of truth
should remain external.

## Immutable Intent Anchor

Intent drift happens when the original goal is left inside the same fuzzy semantic stream as all
later reasoning, failures, and corrections.

Semantix should break that pattern by extracting intent into a deterministic Intent Contract
before execution begins and then freezing it for the life of the run unless a human explicitly
amends it.

### Intent Contract

A useful contract should include at least:

- `primary_directive`
- `strict_boundaries`
- `success_state`

Once approved, this contract should live outside the model as read-only runtime state.

### Why It Matters

This gives the system a stable reference point that later actions can be checked against.

The model may wander in its own semantic frame, but it should not be allowed to mutate live
state if the proposed action conflicts with the frozen contract.

## Intent Drift As A First-Class Failure

Semantix should recognize intent drift explicitly rather than treating it as a vague planning
mistake.

### `IntentDriftException`

This failure occurs when a proposed action, subtask, or state transition materially conflicts
with the frozen Intent Contract.

Examples:

- modifying a table listed in `strict_boundaries`
- changing authentication when the contract forbids auth changes
- pursuing a side quest that does not advance the `primary_directive`

This should not require the human to notice the drift manually. The runtime should detect it.

### Detection Pattern

Before executing a meaningful action, the orchestrator should check:

1. does this action advance the `primary_directive`?
2. does it violate any `strict_boundaries`?
3. is it compatible with the declared `success_state`?

If not, the runtime should block it and raise `IntentDriftException`.

## Recommended Recovery Protocol

When a step fails, the orchestrator should avoid free-form admonishment and instead run a fixed
recovery protocol.

### Suggested Sequence

1. Detect the exact failure type.
2. Record the violated invariant.
3. Invalidate the current semantic frame if needed.
4. Restore the last valid checkpoint.
5. Rehydrate the model with fresh scoped context only.
6. Provide machine-readable next-step constraints.
7. Require a structured correction response.
8. Re-validate before allowing side effects.

This turns correction into a deterministic state machine rather than an emotional negotiation.

For intent drift specifically, the recovery sequence should also reload the frozen Intent
Contract into the deterministic checker so the next attempt is tethered to the original goal.

## Resume Is Revalidation, Not Blind Continuation

If a run has been suspended for review or approval, resuming it should not mean blindly
continuing from the old world snapshot.

The safe rule is:

a parked run resumes against the world as it exists now, not the world as it was when it went to
sleep.

### Dependency Snapshot

When the runtime suspends a run, it should persist not just deterministic variables but also a
dependency snapshot of the external state that later steps rely on.

Examples:

- file hashes for critical inputs
- database schema versions
- row or record version stamps
- policy version
- tool contract version
- intent contract version

### Freshness Gate On Resume

When the human clicks approve and the run wakes up, the runtime should perform a freshness gate
before resuming execution.

Suggested sequence:

1. load persisted deterministic state
2. compare the dependency snapshot to current reality
3. classify the result
4. resume only if the classification allows it

### Suggested Outcomes

- `clean_resume`
  Nothing relevant changed. Rebuild a fresh semantic frame and continue.
- `soft_stale`
  Inputs changed, but the run can recover by invalidating downstream semantic work and
  regenerating from the last safe checkpoint.
- `hard_stale`
  The approved plan is no longer safe or valid. Do not resume automatically; require replan or
  reapproval.

### Why This Matters

Human approval confirms intent. It does not guarantee environmental freshness.

Semantix therefore needs both:

- approved intent
- revalidated world state

before a durable run may continue safely.

## Semantic Stack Traces

When recovery fails or retries are exhausted, the runtime should surface a semantic stack trace
instead of an ordinary crash report.

A standard stack trace shows control flow. A semantic stack trace should show the execution
conditions under which the model failed.

### It Should Capture

- file and line number
- task or semantic node id
- operator that failed
- active constraint or policy names
- context manifest and token counts
- failed candidate output
- retry attempt number
- exact failure reason
- suggested debugging lever

### Example Shape

```text
SemanticRuntimeException: PolicyViolation
File: orchestrator.smx | Line: 42
Task: Generate_Action_Plan

[THE SPARK]
string plan ~> "Create a workflow based on user request" :: SecureJSON;

[ACTIVE POLICY]
FileSystemPolicy

[THE CONTEXT LOADED]
- 1,024 tokens from user_request
- 4,500 tokens from Hoplon_API_Docs

[FAILED CANDIDATE 1/1]
{
  "action": "delete_file",
  "path": "/root/system/config.yaml"
}

[THE REASON]
Policy FileSystemPolicy denies paths matching "/root/*".

[THE MODE SWITCH]
Generation mode terminated. Circuit breaker tripped.
Routed to deterministic deny handler.
```

The key is that the stack trace should help the developer reason about environment, policy, and
context quality, not just line numbers.

For suspended workflows, stack and trace surfaces should also show whether the failure happened:

- before suspension
- during freshness revalidation
- after resume on a regenerated semantic frame

## Structured Correction Artifacts

Instead of allowing the model to respond to failure with unrestricted prose, Semantix should
prefer a structured correction artifact.

For example:

```rust
struct RecoveryResponse {
    status: string,
    violated_invariant: string,
    corrected_assumption: string,
    proposed_next_action: string,
    required_inputs: array<string>,
    confidence: float
}
```

The important property is not the exact schema. It is that the model must produce something
that can be validated against the recovery protocol.

Fields like these are much more useful than apology text:

- `violated_invariant`
- `corrected_assumption`
- `proposed_next_action`
- `required_inputs`

They force the system to inspect whether the model actually understands the recovery target.

## Forbidden Recovery Pattern

Semantix should strongly discourage this pattern:

1. detect failure
2. append more corrective prose to the same conversation
3. ask the same agent to "please try again carefully"
4. trust the next free-form response

This is exactly how polluted context keeps accumulating.

## Better Recovery Pattern

The preferred pattern is:

1. detect failure
2. cut off the failed semantic thread
3. restore deterministic ground truth
4. restart from a clean scoped context
5. restrict the next legal actions
6. require validation before progress continues

This makes recovery architectural rather than rhetorical.

## How To Fix Semantic Errors

When a deterministic program crashes, the fix is often syntax or control flow. When a semantic
program fails, the fix is usually environmental.

Semantix developers should have three main levers:

### Fix A: Clean The Box

If the model is drifting or hallucinating, the working context is often too broad or noisy.

The fix is to reduce the scoped inputs:

- slice documents deterministically
- pass only the relevant paragraph or record
- remove unrelated retrieval results

### Fix B: Tighten The Rules

If the model keeps finding loopholes, the constraint or policy boundary is too permissive.

The fix is to make the contract stricter:

- add forbidden tokens or paths
- strengthen schema validation
- move a soft rule into a hard policy check

### Fix C: Lower The Cognitive Load

If one semantic step keeps failing, the task may be too cognitively dense for a single
generation.

The fix is to split it:

- summarize first
- extract structured values second
- plan third

In other words, manage the semantic workload instead of asking one operator to do everything.

## Fallback Blocks

Critical semantic operations should be able to fail gracefully without crashing the entire
application.

Semantix should support deterministic fallback behavior when retries are exhausted or policy
handling requires a safe default.

### Example

```rust
string action_plan ~> "Create a workflow" :: SecureJSON
    fallback {
        log.error("LLM failed to generate safe workflow.");
        return default_safe_workflow();
    }
```

This keeps semantic failure from turning into whole-program instability and encourages
developers to design explicit safe paths instead of assuming generation will always succeed.

## Relation To Tooling And Multi-Agent Execution

This recovery model connects directly to other Semantix design areas:

- debugging needs checkpoints and replay because recovery depends on them
- deterministic guardrails need to emit machine-readable failure reasons
- multi-agent orchestration can route failed work to a critic, reviewer, or verifier
- capability systems need to block unsafe side effects during unstable states

The apology loop is not an isolated UX annoyance. It is evidence that the system is missing a
proper recovery architecture.

## Candidate Runtime Rules

Semantix may eventually want explicit rules such as:

- a failed semantic step cannot append directly to trusted state
- certain failure classes automatically invalidate the active frame
- retries must begin from a fresh checkpointed context
- policy violations trip a circuit breaker and end the active semantic frame
- approval-required actions suspend semantic execution and enter deterministic approval mode
- meaningful actions must be checked against the frozen Intent Contract before execution
- intent drift raises a deterministic `IntentDriftException`
- suspended runs must pass a freshness gate before resume
- stale world state may force replan or reapproval before continuation
- repeated identical failures escalate to review rather than infinite retry
- apology-style acknowledgement text is ignored by validators

These rules make the language feel less conversational and more operational.

## Open Questions

Several details still need a tighter spec:

- Which failure classes should invalidate the semantic frame automatically?
- How much prior context should survive a recovery reset?
- What should the minimal recovery artifact schema be?
- When should recovery stay within one agent vs escalate to another agent?
- How should repeated near-identical failures be detected and cut off?
- Which parts of this belong in core language semantics vs runtime orchestration?

## Near-Term Next Steps

1. Define failure classes and which ones trigger frame invalidation.
2. Define a checkpoint model for semantic execution and replay.
3. Define the Intent Contract schema and lifecycle.
4. Define a standard recovery response schema.
5. Define the semantic stack trace format, including policy-mode transitions.
6. Define suspension snapshots and freshness-gate semantics for durable runs.
7. Connect failure recovery to the trace format and debugger.
8. Add examples of recovery flows for tool misuse, hallucinated extraction, invalid patch
   generation, and hard-denied policy violations.
