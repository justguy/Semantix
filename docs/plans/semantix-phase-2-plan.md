# Semantix Phase 2 Plan

Status: draft for tracker execution
Created: 2026-05-12
Scope owner: Semantix

## Purpose

Phase 2 should start only after the remaining Phase 1 closeout gaps are either fixed or explicitly
reclassified as upstream limitations. Phalanx integration is intentionally out of this plan; it can
proceed on its own track once `PHALANX_SEMANTIX_HTTP_URL` wiring is exercised.

The Phase 2 thesis is:

Semantix should move from governed review artifacts around semantic execution to compiled
constraint machinery that deterministically admits, rejects, retries, audits, and explains semantic
outputs.

The center of gravity is the Constraint Engine described in
`docs/compiler-pipeline-and-neural-bytecode.md`. Constraints must stop being prompt decoration and
become executable contracts: schemas, validators, path policies, retry rules, approval checks,
verifier hooks, and audit evidence.

## Phase 1 Closeout Gate

Phase 1 is not closed until these local gaps are handled:

1. Codex `app-server` protocol is revalidated against the installed Codex CLI version.
2. Resume and steering semantics are either implemented against the current protocol or explicitly
   reclassified as a deferred upstream limitation.
3. Preview fidelity is made honest: real runtime diff bodies are distinguished from synthesized
   metadata-only previews.
4. Browser-host verification is rerun outside the sandbox that previously produced local socket
   `EPERM`.
5. `KNOWN_GAPS.md`, the control-plane README, and tracker evidence match the final state.

The completion signal is a short Phase 1 readiness record that includes current Codex version,
app-server protocol proof, browser-host proof, preview behavior, test results, and the remaining
deferred items if any.

## Phase 2 Scope

Included:

- Formal constraint intermediate representation for `context`, `constraint`, and `~>` lowering.
- Constraint compilation into deterministic artifacts.
- Runtime admission of semantic outputs through compiled validators.
- Bounded retry/fail behavior for constraint violations.
- Path and capability policies derived from constraints.
- Typed verifier/provider hooks where deterministic validation is insufficient.
- Golden examples and fixture tests for extraction, summarization, routing, and file-change
  admission.
- Audit bundle export and signed review artifact planning.
- Provenance and replay foundations tied to compiled constraints.

Excluded:

- Phalanx Spec Studio product integration.
- Multi-user collaboration UI.
- Distributed execution.
- Enterprise policy administration.
- A full standalone Semantix language server or IDE.
- Multi-runtime execution in a single run unless a narrow design spike proves it is needed for the
  Constraint Engine.

## Milestones

### Milestone 1: Constraint IR

Define the durable data model the compiler emits for constraints. The model must support:

- schema constraints
- allow and deny path policies
- capability requirements
- approval requirements
- retry policy
- verifier policy
- provenance requirements
- hard vs soft failure classification

Deliverables:

- `ConstraintIR` draft contract
- examples lowered from existing Semantix syntax docs
- compatibility notes for `IntentContract`, `ExecutionPlan`, `StateEffect`, and strict compiler
  envelopes

### Milestone 2: Deterministic Constraint Compiler

Implement a first compiler slice that lowers constraint declarations into executable artifacts.

Minimum artifacts:

- JSON schema or equivalent structural validator
- file path policy
- required/forbidden field validators
- approval-required marker
- retry/fail policy

The slice should stay narrow enough to test without live model calls.

### Milestone 3: Runtime Admission Loop

Route semantic outputs through the compiled artifacts before they become trusted program state.

The loop should:

- parse model output
- validate against compiled structure
- classify violations
- retry within a fixed budget when retry is allowed
- fail closed when hard constraints remain violated
- persist admission evidence for audit

### Milestone 4: Verifier And Provider Hooks

Add a narrow verifier/provider hook for checks that cannot be handled by deterministic validators
alone. This should not move authority into the provider layer. Providers may advise; Semantix
still decides.

Examples:

- contradiction check
- semantic entailment check
- groundedness check
- semantic similarity threshold check

### Milestone 5: Proof Matrix

Create a fixture matrix that proves the Constraint Engine handles representative Semantix programs:

- structured extraction
- constrained summarization
- semantic routing
- safe file change proposal
- blocked path mutation
- retryable schema failure
- non-retryable policy failure

The matrix should include both positive and negative cases, with no live service requirement for the
core deterministic path.

### Milestone 6: Audit, Provenance, And Replay Foundation

Define and implement the first exportable audit bundle around constraint admission.

Minimum contents:

- reviewed artifact identity
- compiled constraint identity
- semantic candidate metadata
- deterministic validation results
- verifier results when used
- retry attempts
- final admission or rejection outcome
- state effects shown to the reviewer

Replay does not need to reproduce model tokens. It must reproduce the deterministic admission
decision from the recorded candidate and compiled constraints.

## Architecture Principles

- Constraints compile into machinery, not advice.
- Providers and runtimes propose; Semantix admits or rejects.
- Hard constraints fail closed.
- Soft verifier findings can downgrade confidence but cannot silently override hard validators.
- Every admitted semantic value has a provenance record.
- Every side effect remains freshness-bound and previewable.
- A synthesized preview must be labeled as such.
- Tests should prove behavior without live services first; live proofs are additive.

## Phase 2 Task Map

The tracker should contain two sets of tasks:

Phase 1 closeout tasks:

- `stx-p1-001`: revalidate Codex app-server protocol.
- `stx-p1-002`: settle resume and steering semantics.
- `stx-p1-003`: close preview fidelity gap.
- `stx-p1-004`: rerun browser-host verification.
- `stx-p1-005`: publish Phase 1 readiness record.

Phase 2 tasks:

- `stx-p2-000`: Phase 2 Constraint Engine epic.
- `stx-p2-001`: formalize Constraint IR.
- `stx-p2-002`: implement deterministic constraint compiler slice.
- `stx-p2-003`: implement runtime admission loop.
- `stx-p2-004`: add verifier/provider hook contract.
- `stx-p2-005`: build Constraint Engine proof matrix.
- `stx-p2-006`: define audit bundle and signed review artifact path.
- `stx-p2-007`: implement provenance and replay foundation.
- `stx-p2-008`: run Phase 2 readiness review and decide runtime expansion.

## Risks

- Codex app-server protocol may not expose true resume or steering. If so, Phase 1 should close with
  an explicit upstream limitation instead of pretending the capability exists.
- Constraint compilation can sprawl. Phase 2 should start with a small IR and one deterministic
  compiler path before expanding syntax.
- Provider-backed verification can accidentally become authority. The contract must keep verifier
  output advisory unless bound by deterministic policy.
- Replay can be overpromised. The Phase 2 target is deterministic replay of admission decisions, not
  token-level reproduction.

## Exit Criteria

Phase 2 is ready to close when:

1. A Semantix constraint lowers into deterministic validation artifacts.
2. A semantic output candidate is admitted only after passing the compiled artifacts.
3. Retryable and non-retryable failures are distinguishable and tested.
4. File/path policy violations are blocked before side effects.
5. Audit evidence explains why a candidate was admitted, retried, or rejected.
6. Provenance records connect admitted values back to context, constraints, verifier evidence, and
   artifact versions.
7. The proof matrix passes without live services.
8. A live smoke proof demonstrates the same path with the active runtime.
