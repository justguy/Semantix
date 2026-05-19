# Spec Studio Batch + Contradiction Probe

Four-turn session proving two patterns not covered by the sequential probe:

1. **Batch gap presentation** — multiple independent questions surfaced in one `nextTurn`; user answers all in one `user_turn`
2. **Contradiction detection** — free-text answer contradicts a prior declared decision; evaluator raises a blocker, shifts to `adversarial` phase, and requires reconciliation before the spec can proceed

## Quick start

```bash
npm run probe:spec-studio-batch --workspace packages/stx
```

No running server required — the probe starts its own in-process server.

---

## Session parameters

| Field | Value |
|---|---|
| `sessionId` | `sess_batch_probe_001` |
| `originalUserRequest` | `"Build an expense reporting app"` |
| Evaluator | `createSpecStudioBatchProbeEvaluator` |
| Source file | `packages/stx/src/spec-studio-batch-probe-evaluator.js` |

---

## Turn sequence

### T0 — initial → batch of 3 independent questions

**Request trigger:** `initial`

Instead of asking one question, the evaluator surfaces all three independent structural gaps at once.

**Response:**
```
readiness:          needs_user
alignmentPct:       10%
openConcerns:       4
nextTurn.body.kind: batch
questions:
  Q-SYSTEM-TYPE  "Is this a new system or updating an existing one?"
                 options: OPT-NEW | OPT-UPDATE
  Q-USER-TYPE    "Who is the primary user of this system?"
                 options: OPT-ADMIN | OPT-END-USER | OPT-BOTH
  Q-TIMELINE     "What is the target delivery timeline?"
                 options: OPT-Q1 | OPT-Q2 | OPT-Q3 | OPT-UNKNOWN
```

These three questions are **independent** — no answer depends on another. Batching them eliminates two round-trips.

---

### T1 — user answers all 3 batch questions

**Request trigger:** `user_turn`
**User turn body:**
```json
{
  "kind": "batch",
  "answers": [
    { "questionId": "Q-SYSTEM-TYPE", "kind": "choice", "picked": "OPT-NEW",      "label": "New system" },
    { "questionId": "Q-USER-TYPE",   "kind": "choice", "picked": "OPT-END-USER", "label": "End user"   },
    { "questionId": "Q-TIMELINE",    "kind": "choice", "picked": "OPT-Q2",       "label": "Q2 2026"    }
  ]
}
```

**Response:**
```
readiness:    needs_user
alignmentPct: 65%         ← jumped from 10% in a single turn
openConcerns: 1
mode:         new         ← recorded from Q-SYSTEM-TYPE answer
nextTurn:     T-BATCH-Q2 (socratic, question)
question:     "Describe the core workflow the user needs to complete in this system."
```

The alignment jump from 10% → 65% in one turn is the key batch payoff — three gaps closed simultaneously.

---

### T2 — free text triggers contradiction

**Request trigger:** `user_turn`
**User turn body:**
```json
{
  "kind": "free",
  "text": "Users submit expense reports for approval. We'll route approvals through the existing SAP Finance API."
}
```

The word `"existing"` combined with `"SAP"` contradicts the `mode: "new"` declaration from T1.

**Response:**
```
readiness:    needs_user
alignmentPct: 45%         ← regresses from 65%; prior system-type alignment is invalidated
openBlockers: 1
findings:
  FND-CONTRA-001
    kind:     contradiction
    sev:      blocker
    section:  intent
    ref:      T-BATCH-Q2
    text:     "Description references existing infrastructure but system
               type was declared as 'new'."
    resolved: false
    raisedBy: semantix
nextTurn:     T-BATCH-Q3 (adversarial, question)
question:     "Your description references existing infrastructure, but you
               indicated this is a new system. How do you want to reconcile this?"
options:      OPT-NEW-WITH-INTEGRATION | OPT-UPDATE-EXISTING
```

Notable: the evaluator shifts to `phase: "adversarial"` for the reconciliation question — the correct phase for a direct challenge to a prior declaration.

**Contradiction detection rule (probe):**
The evaluator tests free text against the pattern `/\b(existing|legacy|current|sap|erp|oracle|salesforce)\b/i` when `existingSystemContext.mode === "new"`. In a live LLM-backed evaluator this would be semantic reasoning over the full packet.

---

### T3 — user reconciles contradiction → ready

**Request trigger:** `user_turn`
**User turn body:**
```json
{
  "kind": "choice",
  "picked": "OPT-NEW-WITH-INTEGRATION",
  "label": "New app that integrates with existing infrastructure",
  "questionTurnId": "T-BATCH-Q3"
}
```

**Response:**
```
readiness:    ready
alignmentPct: 100%
openBlockers: 0
openConcerns: 0
nextTurn:     null
findings:
  FND-CONTRA-001  resolved: true    ← blocker cleared
requirements: 3 captured (see below)
```

---

## Terminal packet — requirements

| ID | Type | Text | Priority | Status |
|---|---|---|---|---|
| REQ-001 | functional | End users can submit expense reports. | must | confirmed |
| REQ-002 | functional | Approval routing integrates with existing backend infrastructure. | must | confirmed |
| REQ-003 | constraint | System must be delivered by Q2 2026. | must | confirmed |

---

## Alignment progression

```
T0  initial                    10%  ██░░░░░░░░░░░░░░░░░░  4 concerns
T1  batch (3 answers)          65%  █████████████░░░░░░░  1 concern   ← batch jump
T2  free (contradiction)       45%  █████████░░░░░░░░░░░  1 blocker   ← regression
T3  choice (reconcile)        100%  ████████████████████  resolved
```

A skip (multi-turn probe) stalls alignment but does not lose ground — the information is unknown.
A contradiction actively regresses alignment because something previously declared is now contested.

---

## Contradiction lifecycle

```
T1  mode declared: "new"
T2  free text: "...existing SAP Finance API..."
     → FND-CONTRA-001 raised  (kind=contradiction, sev=blocker, resolved=false)
     → phase shifts to "adversarial"
     → alignment stalls
T3  user picks OPT-NEW-WITH-INTEGRATION
     → FND-CONTRA-001 resolved=true
     → blocker clears
     → spec → ready
```

---

## Contract changes

This probe required two extensions to the base contracts.

### `spec-studio-contracts.js` — new `nextTurn.body.kind`

`"batch"` added to allowed nextTurn body kinds alongside `"question"` and `"finding"`.

Validation: batch body requires `questions: []` (non-empty array). Each question carries `id`, `q`, and optional `options`.

### `spec-studio-evaluator.js` — new user turn body kind

`"batch"` added to `USER_TURN_BODY_KIND_VALUES`.

Validation: batch user turn body requires `answers: []` (non-empty array). Each answer carries `questionId` and the same fields as the corresponding single-question answer type.

---

## Files

| File | Purpose |
|---|---|
| `packages/stx/src/spec-studio-batch-probe-evaluator.js` | Evaluator — batch surfacing + contradiction detection |
| `packages/stx/scripts/probe-spec-studio-batch.js` | Probe runner — starts in-process server, runs 4 turns, asserts |
| `packages/stx/tests/fixtures/spec-studio-batch/t0-initial.json` | T0 request body |
| `packages/stx/tests/fixtures/spec-studio-batch/t1-batch-answers.json` | T1 request body (batch answers) |
| `packages/stx/tests/fixtures/spec-studio-batch/t2-free-contradiction.json` | T2 request body (contradicting free text) |
| `packages/stx/tests/fixtures/spec-studio-batch/t3-choice-reconcile.json` | T3 request body (reconciliation choice) |

---

## Evaluator routing logic

```
initial
  → T-BATCH-Q1 (batch: Q-SYSTEM-TYPE, Q-USER-TYPE, Q-TIMELINE)

T-BATCH-Q1 + user_turn/batch
  → T-BATCH-Q2 (free text: core workflow)
    records mode from Q-SYSTEM-TYPE answer

T-BATCH-Q2 + user_turn/free
  [existing-infra keyword + mode=new]  → T-BATCH-Q3 (adversarial, contradiction)
                                          raises FND-CONTRA-001
  [no contradiction]                   → ready

T-BATCH-Q3 + user_turn/choice OPT-NEW-WITH-INTEGRATION → ready (resolves FND-CONTRA-001)
T-BATCH-Q3 + user_turn/choice OPT-UPDATE-EXISTING       → ready (resolves FND-CONTRA-001)
```

---

## Relationship to other probes

| Probe | Turns | Patterns covered |
|---|---|---|
| `probe:spec-studio-json` | 2 | Basic initial → choice → ready transport |
| `probe:spec-studio-multi-turn` | 6 | Sequential gaps, skip, blocker, deferred resolution |
| `probe:spec-studio-batch` | 4 | Batch gap surfacing, free-text contradiction, adversarial reconciliation |
