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
- Deterministic execution owns all state mutation
- Human approval is represented as explicit graph nodes
- Runtime behavior is governed by **hard validation schemas**, not prompts

---

## Core Principles

1. **No transcript-driven execution**
2. **All semantic output must be admitted via schema validation**
3. **Approval is a structural node, not a flag**
4. **Artifacts are self-contained and immutable**
5. **The runtime decides; the model proposes**

---

## Node Types (v0)

Only three node types are allowed:

- `semantic_generation`
- `deterministic_execution`
- `approval_gate`

---

## Semantic Node Output Contract (NEW)

A `semantic_generation` node succeeds only if:

- The model output parses as valid JSON
- The output matches EXACTLY the node’s `hard_validation_schema`
- No additional properties are present (strict mode)

All schemas MUST include:

```json
"additionalProperties": false
```

Failure to validate results in:

- immediate rejection
- no retry or repair loop
- node marked as failed

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
