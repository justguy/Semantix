# Spec Studio Multi-Turn JSON Probe

Six-turn session proving the iterative Spec Studio discussion loop with multiple question types and a gap/blocker/resolve cycle.

## Quick start

```bash
npm run probe:spec-studio-multi-turn --workspace packages/stx
```

No running server required — the probe starts its own in-process server on an OS-assigned port and shuts it down on exit.

---

## Session parameters

| Field | Value |
|---|---|
| `sessionId` | `sess_mt_probe_001` |
| `originalUserRequest` | `"Build an expense reporting app"` |
| Evaluator | `createSpecStudioMultiTurnProbeEvaluator` |
| Source file | `packages/stx/src/spec-studio-multi-turn-probe-evaluator.js` |

---

## Turn sequence

### T0 — initial

**Request trigger:** `initial`

**Response:**
```
readiness:    needs_user
alignmentPct: 20%
openConcerns: 4
nextTurn:     T-MT-Q1 (socratic, target: intent)
question:     "Is this a new system or updating an existing one?"
options:      OPT-NEW | OPT-UPDATE
```

---

### T1 — choice: system type

**Request trigger:** `user_turn`
**User turn:** `{ kind: "choice", picked: "OPT-NEW", label: "New system" }`

**Response:**
```
readiness:    needs_user
alignmentPct: 35%
openConcerns: 3
mode:         new          ← set from user choice
nextTurn:     T-MT-Q2 (socratic, target: users)
question:     "Who is the primary user of this system?"
options:      OPT-ADMIN | OPT-END-USER | OPT-BOTH
```

---

### T2 — choice: user type

**Request trigger:** `user_turn`
**User turn:** `{ kind: "choice", picked: "OPT-END-USER", label: "End user" }`

**Response:**
```
readiness:    needs_user
alignmentPct: 50%
openConcerns: 3
nextTurn:     T-MT-Q3 (socratic, target: intent)
question:     "Describe the core action the user needs to accomplish in this system."
body.kind:    question (no options — free text expected)
```

---

### T3 — free text: core action

**Request trigger:** `user_turn`
**User turn:** `{ kind: "free", text: "Users need to submit expense reports and track approval status." }`

**Response:**
```
readiness:    needs_user
alignmentPct: 65%
openConcerns: 2
nextTurn:     T-MT-Q4 (crisp, target: constraints)
question:     "Do you have an existing authentication system to integrate with?"
options:      OPT-AUTH-YES | OPT-AUTH-NO | OPT-AUTH-SKIP
```

---

### T4 — skip: auth question

**Request trigger:** `skip` (no `userTurn`)

The auth question is skipped rather than answered. The evaluator raises a blocker and asks for explicit deferral confirmation before allowing the spec to proceed.

**Response:**
```
readiness:    needs_user
alignmentPct: 65%          ← stalls — blocker prevents advancement
openBlockers: 1
openConcerns: 1
findings:     [FND-AUTH-001: gap / blocker / section:constraints / resolved:false]
nextTurn:     T-MT-Q5 (crisp, target: constraints)
question:     "Auth was skipped. Confirm this is deferred to a later sprint."
options:      OPT-DEFER-CONFIRM | OPT-DEFER-REJECT
```

> If the user picks `OPT-DEFER-REJECT`, the evaluator loops back to T-MT-Q4 so they can answer the auth question directly.

---

### T5 — choice: confirm defer

**Request trigger:** `user_turn`
**User turn:** `{ kind: "choice", picked: "OPT-DEFER-CONFIRM", label: "Confirmed — defer auth to a later sprint" }`

**Response:**
```
readiness:    ready
alignmentPct: 100%
openBlockers: 0
openConcerns: 0
nextTurn:     null
findings:     [FND-AUTH-001: resolved:true]
requirements: 3 captured (see below)
```

---

## Terminal packet — requirements

| ID | Type | Text | Priority | Status |
|---|---|---|---|---|
| REQ-001 | functional | Users can submit expense reports. | must | confirmed |
| REQ-002 | functional | Users can track approval status of submitted reports. | must | confirmed |
| REQ-003 | constraint | Authentication is deferred to a later sprint. | should | confirmed |

---

## Alignment progression

```
T0  initial                  20%  ████░░░░░░░░░░░░░░░░  4 concerns
T1  choice (system type)     35%  ███████░░░░░░░░░░░░░  3 concerns
T2  choice (user type)       50%  ██████████░░░░░░░░░░  3 concerns
T3  free (core action)       65%  █████████████░░░░░░░  2 concerns
T4  skip (auth)              65%  █████████████░░░░░░░  1 blocker ← stall
T5  confirm defer           100%  ████████████████████  resolved
```

---

## Gap/blocker/resolve cycle

The T4→T5 pair is the key pattern under test:

1. User skips a required question (`trigger: "skip"`)
2. Evaluator raises `FND-AUTH-001` (`kind: gap`, `sev: blocker`, `resolved: false`)
3. Alignment stalls — `alignmentPct` does not increase
4. Evaluator issues a confirmation question before allowing the session to proceed
5. User explicitly confirms deferral
6. Evaluator resolves the finding (`resolved: true`), clears blocker, advances to `ready`

---

## Files

| File | Purpose |
|---|---|
| `packages/stx/src/spec-studio-multi-turn-probe-evaluator.js` | Evaluator — routes by `currentPacket.nextTurn.id` + `trigger` |
| `packages/stx/scripts/probe-spec-studio-multi-turn.js` | Probe runner — starts in-process server, runs all 6 turns, asserts |
| `packages/stx/tests/fixtures/spec-studio-multi-turn/t0-initial.json` | T0 request body |
| `packages/stx/tests/fixtures/spec-studio-multi-turn/t1-choice-new-system.json` | T1 request body |
| `packages/stx/tests/fixtures/spec-studio-multi-turn/t2-choice-end-user.json` | T2 request body |
| `packages/stx/tests/fixtures/spec-studio-multi-turn/t3-free-core-action.json` | T3 request body |
| `packages/stx/tests/fixtures/spec-studio-multi-turn/t4-skip-auth.json` | T4 request body |
| `packages/stx/tests/fixtures/spec-studio-multi-turn/t5-choice-defer-confirm.json` | T5 request body |

---

## Evaluator routing logic

The evaluator is stateless — it derives the current position from `currentPacket.nextTurn.id`:

```
initial                                      → T-MT-Q1
T-MT-Q1 + user_turn/choice                  → T-MT-Q2  (records mode: new|existing)
T-MT-Q2 + user_turn/choice                  → T-MT-Q3  (free text question)
T-MT-Q3 + user_turn/free                    → T-MT-Q4  (auth choice)
T-MT-Q4 + skip                              → T-MT-Q5  (raises blocker FND-AUTH-001)
T-MT-Q5 + user_turn/choice OPT-DEFER-CONFIRM → ready    (resolves FND-AUTH-001)
T-MT-Q5 + user_turn/choice OPT-DEFER-REJECT  → T-MT-Q4  (loops back)
```

---

## Handoff notes

- The probe evaluator is deterministic and does not call an LLM. It proves contract compliance and turn mechanics only.
- To plug in a live LLM-backed evaluator, inject a different `impl` into `createSemantixEvaluator(impl)` — the contract layer and probe script are unchanged.
- Phalanx wiring follows the same pattern as the two-turn probe: set `PHALANX_SEMANTIX_HTTP_URL` to the `/spec-studio/evaluate` endpoint.
