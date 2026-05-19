# Spec Studio Manual JSON Probe Guide

How to prove the iterative Spec Studio discussion loop by POSTing JSON directly
to Semantix — **without running Phalanx**.

## Prerequisites

- Node.js ≥ 18
- `packages/stx` installed (`npm install` from the repo root)

## Start Semantix locally

```bash
node packages/stx/src/cli.js serve
# or from the workspace:
npm run preview:ui --workspace packages/stx
```

Default address: `http://127.0.0.1:4401`

The spec-studio endpoint is available immediately after the server starts. No
Phalanx environment variables are required.

## Endpoint

```
POST http://127.0.0.1:4401/spec-studio/evaluate
Content-Type: application/json
```

Accepts a `SemantixEvaluateRequest` and returns a `SemantixEvaluateResponse`.

## Turn 1 — initial request

```bash
curl -s -X POST http://127.0.0.1:4401/spec-studio/evaluate \
  -H "Content-Type: application/json" \
  -d @packages/stx/tests/fixtures/spec-studio-manual-json/initial.json \
  | jq '{readiness: .packet.readiness, source: .packet.source, nextTurn: .packet.nextTurn.id}'
```

Expected output shape:

```json
{
  "readiness": "needs_user",
  "source": "semantix",
  "nextTurn": "T-PROBE-Q1"
}
```

## Turn 2 — user choice

Paste the packet from Turn 1 into `currentPacket` (or use the provided fixture),
then POST a choice answer:

```bash
curl -s -X POST http://127.0.0.1:4401/spec-studio/evaluate \
  -H "Content-Type: application/json" \
  -d @packages/stx/tests/fixtures/spec-studio-manual-json/choice-turn.json \
  | jq '{readiness: .packet.readiness, alignmentPct: .packet.coverage.alignmentPct}'
```

Expected output shape:

```json
{
  "readiness": "ready",
  "alignmentPct": 100
}
```

## Automated probe script

The probe script runs the two-turn sequence automatically against a running server:

```bash
npm run probe:spec-studio-json --workspace packages/stx -- \
  --url http://127.0.0.1:4401/spec-studio/evaluate
```

Exit 0 means both turns returned valid packets and the sequence completed.

### LLM evaluator mode

To verify the server is running the real LLM-backed evaluator, pass `--mode llm`. The script will first
hit `GET /spec-studio/mode` and print the server's reported evaluator mode, then proceed with the two-turn probe:

```bash
SPEC_STUDIO_EVALUATOR=llm node packages/stx/src/cli.js serve &

npm run probe:spec-studio-json --workspace packages/stx -- \
  --url http://127.0.0.1:4401/spec-studio/evaluate \
  --mode llm
```

**Important**: `SPEC_STUDIO_EVALUATOR=llm` wiring (and therefore Phalanx integration via
`PHALANX_SEMANTIX_HTTP_URL`) requires `ss-llm-008` (LLM-backed readiness proof) to be complete.
Do not point Phalanx at Semantix until that task is done and the proof is recorded in
`docs/spec-studio-llm-proof.md`.

## Identifying success

A successful probe response has:

| Field | Expected |
|---|---|
| `source` | `"semantix"` |
| `readiness` | `"ready"`, `"needs_user"`, or `"blocked"` |
| `coverage.alignmentPct` | a number |
| `coverage.sections` | an array |
| HTTP status | `200` |

A `200` with `readiness: "needs_user"` is still a valid probe result — it means
the deterministic evaluator issued a follow-up question. Only an HTTP 4xx/5xx
from normal evaluator failures indicates a problem (degraded behaviour surfaces
as `200` with a `needs_user` packet carrying a blocker finding).

## Error responses

| HTTP | Meaning |
|---|---|
| `400 VALIDATION_ERROR` | Request body is not valid JSON or fails `SemantixEvaluateRequest` schema |
| `200` + `readiness: "needs_user"` + blocker finding | Evaluator degraded honestly (expected during probe) |
| `500` | Unexpected server error (never expected for normal evaluator failures) |

## Other fixture bodies

| Fixture | Trigger | Purpose |
|---|---|---|
| `initial.json` | `initial` | First turn, no prior state |
| `choice-turn.json` | `user_turn` + choice body | User picks from options |
| `free-turn.json` | `user_turn` + free body | User types a free-text answer |
| `skip-turn.json` | `skip` | User skips without answering |
| `delegate-turn.json` | `user_turn` + delegate body | User delegates the question |
| `reconsider-turn.json` | `reconsider` | User reconsiders a prior answer |
| `context-response-nested.json` | `context_response` | Nested Phalanx context episode |
| `malformed-request.json` | — | Expects HTTP 400 |

All fixtures are under `packages/stx/tests/fixtures/spec-studio-manual-json/`.

## Handoff to live Phalanx integration

Probe-mode success is not sufficient for live Phalanx integration. Before
setting `PHALANX_SEMANTIX_HTTP_URL`, run Semantix in LLM mode and record a
successful LLM-backed manual proof in `docs/spec-studio-llm-proof.md`.

Once the LLM-backed proof passes, live Phalanx integration is reduced to:

1. Set `PHALANX_SEMANTIX_HTTP_URL=http://<semantix-host>:<port>/spec-studio/evaluate`
   in the Phalanx environment.
2. Confirm that Phalanx's `live:semantix` transport sends the same JSON shapes
   exercised by these fixtures.

No additional Semantix code changes are expected for that wiring step after
the LLM-backed proof is recorded.
