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

Milestone 1 draft contract:

```ts
type ConstraintIR = {
  id: string;
  version: 1;
  sourceRef: string;
  target: {
    kind: "semantic_output" | "state_effect" | "tool_call" | "runtime_node";
    nodeId?: string;
    outputRef?: string;
    stateEffectId?: string;
  };
  schema?: {
    format?: "json" | "text" | "markdown" | "code" | "custom";
    jsonSchema?: object;
    requiredFields?: string[];
    forbiddenFields?: string[];
    parser?: string;
  };
  pathPolicy?: {
    root?: string;
    allow?: string[];
    deny?: string[];
    operations?: string[];
  };
  capabilities?: {
    required?: string[];
    forbidden?: string[];
    approvalRequired?: string[];
  };
  approval?: {
    required: boolean;
    gateId?: string;
    reason?: string;
    freshness?: "artifact" | "node" | "state_effect";
  };
  retry?: {
    maxAttempts: number;
    retryOn?: string[];
    failOn?: string[];
    repairInstructions?: string;
  };
  verifier?: {
    mode: "none" | "advisory" | "required";
    checks?: Array<{
      id: string;
      kind: "groundedness" | "entailment" | "contradiction" | "similarity" | "custom";
      threshold?: number;
      failureSeverity?: "hard" | "soft";
    }>;
  };
  provenance?: {
    required: boolean;
    sources?: string[];
    evidenceRefs?: string[];
    attachToOutput?: boolean;
  };
  failure?: {
    defaultSeverity: "hard" | "soft";
    classes: Array<{
      code: string;
      class:
        | "schema"
        | "path_policy"
        | "capability"
        | "approval"
        | "verifier"
        | "provenance"
        | "runtime";
      severity: "hard" | "soft";
      retryable: boolean;
      message: string;
    }>;
  };
  compiledArtifacts?: {
    schemaValidatorRef?: string;
    fieldValidatorRef?: string;
    pathPolicyRef?: string;
    approvalMarkerRef?: string;
    retryPolicyRef?: string;
    failurePolicyRef?: string;
    verifierRef?: string;
    constrainedDecoderRef?: string;
  };
};
```

The IR intentionally carries policy and provenance before executable functions exist. The next
compiler slice can attach `compiledArtifacts` without changing the language surface again.

### Milestone 2: Deterministic Constraint Compiler

Implement a first compiler slice that lowers constraint declarations into executable artifacts.

Minimum artifacts:

- JSON schema or equivalent structural validator
- file path policy
- required/forbidden field validators
- approval-required marker
- retry/fail policy

The slice should stay narrow enough to test without live model calls.

Delivered compiler slice:

- `compileConstraintBundle` lowers `ConstraintIR` records into deterministic `constraintBundle`
  entries for strict compiler envelopes.
- The bundle records stable identities, compiled artifact refs, and validator groups for schema,
  required/forbidden fields, path policies, approval markers, retry policies, failure policies, and
  verifier policy markers.
- If a semantic node has no explicit `ConstraintIR`, the compiler emits a fallback IR from the
  node `hard_validation_schema` so existing strict compiler consumers remain compatible.
- Illegal hard constraints fail deterministically before admission, including required/forbidden
  field overlap, capability require/forbid overlap, all allowed paths being denied, invalid retry
  policy, invalid verifier mode, and malformed failure classes.

### Milestone 3: Runtime Admission Loop

Route semantic outputs through the compiled artifacts before they become trusted program state.

The loop should:

- parse model output
- validate against compiled structure
- classify violations
- retry within a fixed budget when retry is allowed
- fail closed when hard constraints remain violated
- persist admission evidence for audit

Delivered runtime slice:

- The Codex runtime adapter now executes a bounded semantic-admission loop from the compiled
  `constraintBundle` retry policy.
- Admission attempts are classified with deterministic reason codes, failure classes, severity,
  retryability, constraint identity, evidence, and stdout hash.
- Retryable schema failures can be regenerated inside the fixed budget; exhausted retries and hard
  path-policy failures fail closed without storing `admittedOutput` or emitting approval gates.
- Control-plane run state persists admission evidence on both admitted and rejected semantic nodes.

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

Implemented v1 bundle shape:

- `reviewedArtifact`: artifact id, run id, plan version, graph version, artifact hash, freshness
  state, and generation timestamp.
- `compiledConstraintIdentities`: each `ConstraintIR` id, version, target, verifier policy,
  provenance policy, failure policy, and stable identity hash.
- `candidateMetadata`: execution nodes with revision, execution/review status, approval
  requirement, constraint refs, runtime binding, and risk flags.
- `validationResults`: runtime admission evidence per semantic node, including final attempt,
  attempts, status, and admitted output hash.
- `verifierResults`: configured verifier checks and reported results, always labeled as advisory
  evidence unless a Semantix policy consumes the result.
- `shownStateEffects`: reviewer-visible effect metadata plus preview content, preview source,
  fidelity, and synthetic-preview marker.
- `reviewEvents` and `replayTimeline`: persisted audit records in sequence, including approval,
  stale rejection, intervention, resume, and completion events.
- `signature`: an unsigned deterministic envelope with canonical payload hash and a detached
  signature path. Production key provisioning, rotation, KMS/HSM integration, certificate
  transparency, and timestamp authority integration remain out of scope for this slice.

Implemented audit redaction and size guardrails:

- Default audit export classifies bundle fields as required, optional, hash-only, redacted, or
  disallowed.
- Raw preview content, verifier/provider payloads, semantic frame context, admitted model output,
  and model-derived summaries are represented by deterministic hashes, byte sizes, safe summaries
  where available, and explicit redaction reasons.
- Bundle generation emits size metadata for preview content, verifier evidence, semantic context,
  admitted output, and redacted review-event details.
- The default export fails closed if a disallowed raw payload key remains in the bundle.
- Replay from a default bundle proves identity and policy decisions from hashes; reconstructing raw
  payload bodies requires separate operator-approved retention.

Implemented verifier drift guardrails:

- A deterministic fixture corpus records check kind, threshold, comparator, provider result,
  Semantix policy decision, expected risk flags, and fixture migration metadata.
- Default tests lock Semantix-owned verifier policy decisions against provider-output drift,
  policy-threshold drift, missing-evidence drift, and unavailable-provider fail-closed behavior.
- Live verifier/provider sampling remains opt-in and is not part of the default test suite.

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
- `stx-p2-009`: run provider-bound proof matrix and readiness checks.
- `stx-p2-010`: add audit replay drift sentinels.
- `stx-p2-011`: define audit payload redaction and size guardrails.
- `stx-p2-012`: calibrate verifier drift guardrails.

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
