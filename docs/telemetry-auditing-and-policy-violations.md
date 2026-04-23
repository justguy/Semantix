# Semantix Telemetry, Auditing, and Policy Violations

## Purpose

Autonomous systems need stronger telemetry than ordinary applications because the interesting
question is often not just "what failed?" but "where did the forbidden action come from?"

This document outlines what a production-ready Semantix runtime should record when a
`PolicyViolation` or related security-sensitive event occurs.

## Core Thesis

When the runtime blocks a dangerous action, the audit system should preserve enough state to
determine whether the blocked action was:

- directly induced by user input
- introduced through retrieved or tool-provided content
- invented by the model during drift
- produced as a workaround after an earlier deny

You may not always be able to prove malicious intent in a human sense, but you should be able
to reconstruct the provenance of the dangerous proposal.

## Audit Principle

Every dangerous argument must carry a provenance trail or be explicitly marked as
model-invented.

This is the most important telemetry rule in the system.

If a forbidden path, command, identifier, or external target appears in a blocked action, the
auditing layer should help answer:

- did the user ask for it directly?
- did retrieved content inject it?
- did a tool output contain it?
- did the model synthesize it without evidence?

## Required Audit Event Structure

When a `PolicyViolation`, `ApprovalRequired`, or `CapabilityViolation` occurs, the runtime
should emit a structured audit event.

### Core Execution Fields

- `session_id`
- `run_id`
- `thread_id`
- `semantic_frame_id`
- timestamp
- compiler version
- runtime version
- model id and version
- current task and phase
- active policy name
- violated rule id
- decision type: `policy_violation`, `approval_required`, or `capability_violation`

### Tool And Argument Fields

- attempted tool or function name
- normalized arguments after deterministic parsing
- rejected argument field
- rejected value
- whether the tool call was direct, extracted, or proposed through an intermediate plan

### Runtime Control Fields

- retry count before denial
- whether the circuit breaker tripped
- whether the semantic frame was invalidated
- fallback path taken
- approval flow triggered or not

## Provenance Fields

The most important fields are the provenance fields that explain where the dangerous action came
from.

### Input Provenance

- user input hash
- redacted user input snapshot
- request metadata
- authenticated user or session principal

### Context Provenance

- active context manifest
- source ids for every loaded document or tool output
- source ordering
- content hashes
- token counts per source
- relevant source spans or snippets

### Prompt And Template Provenance

- compiled prompt template id
- semantic operator id
- active constraint ids
- active policy ids

### Output Provenance

- final blocked candidate output
- prior failed candidates when they show escalation or workaround behavior
- field-level attribution for dangerous arguments when available
- explicit marker when the argument appears to be model-invented

## Confidence And Entropy Signals

If Semantix surfaces a semantic confidence heatmap in the IDE, the telemetry layer should
capture the evidence used to compute it.

Useful signals include:

- token-level or span-level logprob summaries
- provenance strength for critical arguments
- constraint friction, such as retry count before the candidate became valid
- critique outcomes from verifier or judge passes

These should not replace hard policy decisions, but they are valuable review signals for humans
who need to understand where the system was grounded versus where it had to guess.

### Suggested Confidence Labels

- `grounded`
  Directly supported by deterministic state or active context
- `synthesized`
  Structurally valid but phrased or composed by the model
- `high_entropy`
  Weakly grounded, low-confidence, or dependent on semantic leaps

## Provenance Resolution Strategy

If Semantix mandates provenance for dangerous arguments, the runtime should not rely on the
model's self-report as the source of truth.

The correct design is a hybrid:

- deterministic reverse-attribution is the ground truth
- model-declared `source_id` is advisory metadata

### Why Not Trust A Declared `source_id` Alone

If the model is allowed to satisfy provenance requirements simply by outputting:

- `source_id: "user_input"`
- `source_id: "doc_17"`

then provenance becomes another field the model can hallucinate, manipulate, or forge under
pressure.

That makes it useful as a signal, but not as a security primitive.

### Why Reverse-Attribution Must Be Canonical

The runtime already knows:

- the active context manifest
- the exact loaded sources
- the content hashes
- the tokenized or chunked spans visible to the model
- the normalized tool arguments about to be executed

That means the deterministic runtime is in the best position to compute provenance itself before
the tool call happens.

## Recommended Hybrid Model

Semantix should require two things for sensitive tool arguments:

1. the runtime computes deterministic provenance
2. the model may optionally declare its claimed source

The runtime then compares them.

This gives you:

- a trustworthy provenance result for enforcement
- an additional behavioral signal for auditing

### Deterministic Provenance Pass

Before executing a sensitive tool call, the runtime should:

1. canonicalize the argument value
2. search the active context manifest for exact and normalized matches
3. search retrieved documents, user input, and tool outputs for matching spans
4. resolve the best-supported source span if one exists
5. mark the argument as `model_invented` if no supported origin can be found

This is the provenance result that policy enforcement should trust.

### Model-Declared Source As Advisory Metadata

The language or runtime may also ask the model to emit a source reference alongside the value,
for example:

```rust
struct ProposedPath {
    value: string,
    source_id: string
}
```

This can be useful because it surfaces what the model believes it is relying on.

But the runtime should treat that field as a claim to be checked, not as proof.

### Mismatch As A Security Signal

If the model declares one source and deterministic provenance resolves another, that mismatch
should be logged as a meaningful event.

Examples:

- declared `source_id=user_input`, but the value only appears in retrieved content
- declared `source_id=doc_4`, but no matching span exists there
- declared a valid source id, but the argument is still model-invented after deterministic
  search

These mismatches are valuable telemetry for detecting drift, deception, or prompt injection.

## Practical Attribution Pipeline

For dangerous arguments such as paths, commands, URLs, account ids, or SQL identifiers, the
runtime should use a deterministic attribution pipeline.

### Suggested Steps

1. Normalize the argument.
   Examples: trim whitespace, canonicalize slashes, resolve relative paths when safe, lowercase
   case-insensitive identifiers.
2. Attempt exact substring attribution against loaded source spans.
3. Attempt normalized-match attribution.
   Example: `/root/system/config.yaml` vs `/root/system/config.yaml\n`.
4. Attempt structured-origin attribution.
   Example: the value came from a parsed JSON field in a retrieved tool result.
5. If no origin is found, mark as `model_invented`.

### Attribution Methods

Useful method labels include:

- `exact_span_match`
- `normalized_span_match`
- `structured_field_match`
- `tool_output_lineage`
- `model_declared_only`
- `model_invented`

These should be part of the audit event, not just debugger output.

## Distinguishing Prompt Injection From Hallucination

Telemetry should support post-hoc classification of the likely source of the violation.

### Signals Suggesting Prompt Injection Or Manipulation

- the forbidden target appears directly in user input
- the forbidden target appears in retrieved content loaded into context
- override language appears in context, such as:
  - "ignore policy"
  - "simulation only"
  - "emergency override"
  - "authorized by admin"
- the dangerous action closely copies hostile text from context
- the violation disappears when the suspect context source is removed in replay

### Signals Suggesting Hallucination Or Drift

- the forbidden target does not appear in any loaded source
- the model invents a restricted path or parameter from a vague request
- retries produce inconsistent forbidden values
- the model starts proposing workaround behavior after an earlier deny
- the violation persists even after suspicious context is removed

These are not absolute proofs, but they are operationally useful distinctions for root-cause
analysis.

## Checkpoints And Replay

For security-sensitive failures, the audit system should preserve enough state to replay the
decision deterministically.

That means storing or linking:

- checkpoint id before the semantic step
- trace id for the failed frame
- policy-engine decision record
- deterministic handler result
- whether the runtime entered policy mode

This allows investigators to reproduce the blocked path without rerunning the full workload or
reopening live systems.

## Human Review And Escalation

Some blocked actions will need human analysis, especially when:

- the violation touches privileged resources
- the user repeatedly pushes for restricted actions
- the system detects likely prompt injection
- an `ApprovalRequired` path was attempted without proper prerequisites

In those cases, telemetry should also preserve:

- reviewer queue or escalation id
- incident severity
- related prior denials in the same session
- human disposition if a human later reviewed the event

## Privacy And Redaction

Because audit logs may contain sensitive prompts, paths, and tool outputs, Semantix should not
assume that full raw logging is always acceptable.

The telemetry system should support:

- redacted content snapshots
- hashed raw inputs with reversible secure storage when allowed
- field-level masking
- policy-based retention
- explicit labeling of security-sensitive artifacts

Good auditing is not just about collecting more text. It is about collecting reconstructable
state without creating a second security problem.

## Suggested Event Shape

```rust
struct PolicyViolationAuditEvent {
    session_id: string,
    run_id: string,
    semantic_frame_id: string,
    task: string,
    phase: string,
    model_id: string,
    policy_name: string,
    violated_rule_id: string,
    tool_name: string,
    normalized_arguments: json,
    rejected_argument: string,
    rejected_value: string,
    context_manifest: array<string>,
    source_hashes: array<string>,
    candidate_output: string,
    provenance_status: string,
    resolved_source_id: string,
    resolved_source_span: string,
    attribution_method: string,
    model_declared_source_id: string,
    provenance_mismatch: bool,
    retry_count: int,
    circuit_breaker_tripped: bool,
    fallback_taken: string
}
```

The exact schema can evolve, but the event must preserve enough structured state to support
security review, replay, and root-cause analysis.

## Relationship To Other Docs

This telemetry model depends on the broader Semantix architecture:

- the deterministic runtime doc defines policy boundaries and circuit breakers
- the failure-recovery doc defines semantic error taxonomy and policy-mode transitions
- the debugging doc defines trace and replay expectations
- the orchestration doc explains why these controls are necessary for real autonomous systems

## Open Questions

Several details still need tighter specification:

- Which policy events should be retained long term versus sampled?
- How much raw prompt/context text should be stored versus hashed?
- How should replay work when protected content cannot be exposed to investigators?
- What confidence thresholds should be used for "likely injection" vs "likely hallucination"?
- How should deterministic provenance handle transformed values that are not copied verbatim from
  context?

## Near-Term Next Steps

1. Define the canonical audit event schema for `PolicyViolation` and `ApprovalRequired`.
2. Define the deterministic provenance-resolution pipeline for sensitive arguments.
3. Add provenance markers and optional model-declared `source_id` fields to extracted arguments.
4. Connect policy audit events to trace ids, checkpoints, and replay artifacts.
5. Define redaction and retention rules for sensitive telemetry.
6. Add example investigations showing prompt injection, model drift, workaround attempts, and
   provenance mismatches.
