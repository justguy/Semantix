# Semantix ADR v0 (Revised)
## Artifact-First Control Plane with Strict Semantic Admission

---

## Status
APPROVED WITH TARGETED CLARIFICATIONS (v0 LOCK)

---

## Decision

Semantix v0 adopts an **artifact-first, graph-based execution model** where:

- All execution is driven by a compiled `.xplan` artifact
- The Control Plane is the single source of truth
- Semantic steps must **compile into strictly validated JSON outputs**
- Semantic steps must lower deterministic critique inputs into the artifact when CT-MCP review is required
- Deterministic execution owns all state mutation
- Human approval is represented as explicit graph nodes
- Runtime behavior is governed by **hard validation schemas**, not prompts

---

## Core Principles

1. **No transcript-driven execution**
2. **All semantic output must be admitted via schema validation**
3. **Critical review consumes admitted structure, not loose prose**
4. **Approval is a structural node, not a flag**
5. **Artifacts are self-contained and immutable**
6. **The runtime decides; the model proposes**

---

## Node Types (v0)

Only three node types are allowed:

- `semantic_generation`
- `deterministic_execution`
- `approval_gate`

CT-MCP is not a fourth node type in v0. It is a deterministic critique subsystem invoked after semantic admission and before approval readiness. Its findings are merged into the same review artifact fields used by other deterministic validators: issues, evidence, interventions, risk flags, and recommendations.

---

## Semantic Node Output Contract (NEW)

A `semantic_generation` node succeeds only if:

- The model output parses as valid JSON
- The output matches EXACTLY the node’s `hard_validation_schema`
- No additional properties are present (strict mode)
- Required critique-lowering fields such as `ct_review_input` are present when specified by the schema

All schemas MUST include:

```json
"additionalProperties": false
```

Failure to validate results in:

- immediate rejection
- no retry or repair loop
- node marked as failed

---

## CT-MCP Critique Input (NEW)

When a semantic proposal can reach approval, the strict schema may require a `ct_review_input` object. This object is not an optional explanatory appendix. It is the compiler-lowered structure that deterministic critical review consumes.

The default code-change schema requires:

- `reasoning_chain`: claims, evidence, assumptions, conclusions, and explicit relations
- `plan_steps`: step identifiers, dependencies, and optional shared resources
- `assumptions`: confidence-bearing assumptions with falsification conditions
- `numeric_claims`: arithmetic claims that can be recomputed
- `concurrency`: ordered operations, shared resources, and protections

If `ct_review_input` is missing or malformed, semantic admission fails under the same strict schema rules as any other required field. If CT-MCP finds contradictions, missing prerequisites, unsafe confidence, arithmetic mismatch, or concurrency hazards, the runtime records deterministic review issues and blocks or escalates approval according to issue severity.

This keeps the trust boundary clear: the model performs semantic lowering, but the artifact owns the lowered structure, and deterministic review owns the decision about whether it is safe enough to approve.

---

## Constraint Merging Semantics (NEW)

Hard constraints are merged at compile time.

If merging produces an **unsatisfiable schema**:

- compilation fails
- no artifact is emitted

---

## Approval Semantics (NEW)

Approval binds to:

- `artifact_hash`
- `node_id`
- `node_revision`

Approval becomes INVALID if:

- upstream node output changes
- constraints change
- state_effect_preview changes

---

## State Effect Preview

For v0:

- `state_effect_preview` is **advisory only**
- used for UI and review surface
- not enforced at runtime

---

## Host Function Boundary (NEW)

- `target_symbol` must map to pre-registered deterministic functions
- no dynamic resolution
- no model-defined execution targets

---

## Path Validation (Artifact 3 Clarification)

All path validation assumes:

- canonicalized absolute paths
- normalized input before schema validation

Example (tightened):

```json
"pattern": "^(?!/root(/|$)).*"
```

---

## Artifact Structure

Each `.xplan` artifact includes:

- `artifact_metadata`
- `intent_contract`
- `semantic_frames`
- `execution_graph`

---

## Validation Rules

At ingest:

1. Canonicalize JSON
2. Compute `artifact_hash = sha256(canonical_json)`
3. Validate structure
4. Reject malformed artifacts

---

## Execution Rules

During runtime:

- Semantic nodes produce JSON proposals
- Proposals are validated strictly
- Deterministic nodes execute only validated output
- Approval gates pause execution until approved
- State transitions are owned by the Control Plane

---

## Required Schema Strictness

ALL schemas must:

- define explicit types
- define required fields
- include `"additionalProperties": false`

---

## Failure Modes

| Condition | Behavior |
|----------|--------|
| Schema mismatch | Hard reject |
| Missing required field | Hard reject |
| Extra field | Hard reject |
| Invalid path | Hard reject |
| Missing `ct_review_input` when required | Hard reject |
| CT-MCP blocking critique issue | Pause with blocked approval |
| Unsatisfied constraint | Compile failure |
| Stale approval | Reject action |

---

## Test Artifacts (v0 Targets)

### Artifact 1: Semantic → Deterministic Flow
- Validate JSON output
- Pass to host function

### Artifact 2: Approval Gate
- Pause execution
- Persist state
- Resume only on approval

### Artifact 3: Constraint Lowering
- Enforce regex boundary
- Reject forbidden paths

---

## What v0 Does NOT Include

- Multi-runtime routing
- Context caching
- Advanced provenance verification
- AST-level enforcement (Hoplon)
- Dynamic graph expansion
- CT-MCP as an independent orchestration runtime or agent

These are deferred to later phases.

---

## Summary

Semantix v0 proves:

- semantic execution can be **compiled into strict IR**
- execution can be **governed by deterministic validation**
- approval can be **structural and enforceable**

> This is not an agent system.  
> This is a governed execution system.

---

## Final Statement

Semantix v0 establishes the invariant:

**No semantic output may become real unless it passes a deterministic contract.**
