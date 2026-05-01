# Spec Studio LLM-Backed Evaluator — Readiness Proof

Date: 2026-05-01
Tasks: ss-llm-001 through ss-llm-008

## What Was Built

### Evaluator mode visibility (ss-llm-001)
- `EVALUATOR_MODE = { PROBE: "probe", LLM: "llm" }` exported from `spec-studio-evaluator.js`
- `GET /spec-studio/mode` route returns `{ evaluatorMode, ready }` so operators and Phalanx can confirm active mode
- `createSpecStudioJsonProbeEvaluator()` returned function has `evaluatorMode = "probe"` property
- `createSemantixHandshakeAdapter()` forwards `evaluatorMode` from the wrapped evaluator

### LLM evaluator contract (ss-llm-002)
`packages/stx/src/spec-studio-llm-evaluator.js` exports:
- `buildEvaluatorSystemPrompt()` — full system prompt instructing the LLM to produce SemantixAlignmentPacket JSON
- `synthesizeEvaluatorInput(request)` — transforms a SemantixEvaluateRequest into a structured user-turn message
- `parseEvaluatorOutput(sessionId, iteration, rawText, request)` — parses and validates LLM output, throws on invalid shape

### LLM evaluator implementation (ss-llm-003)
- `createLlmSpecStudioEvaluator({ connector, model, timeoutMs })` calls `connector.execute()` with the full prompt
- Uses the same connector pattern as `createLlmClassificationProvider` in `codex-semantix-layer.js`
- `SPEC_STUDIO_EVALUATOR=llm` env var switches the server from probe to LLM evaluator at startup
- `createStxApplication()` passes `connector` to `createControlPlaneServer()` for LLM use

### Degraded output handling (ss-llm-004)
- `extractJsonFromLlmOutput()` handles plain JSON, markdown-fenced JSON, and prose-wrapped JSON
- `parseEvaluatorOutput()` validates with `validateSemantixAlignmentPacket` and throws descriptively on failure
- `createLlmSpecStudioEvaluator` wraps the raw evaluator with `withDegradationFallback` so any error becomes an honest non-lockable degraded packet

### Regression tests (ss-llm-005)
`packages/stx/tests/spec-studio-llm-evaluator.test.js` — 19 tests covering:
- System prompt and input synthesis contracts
- JSON extraction from plain, fenced, and prose-wrapped LLM output
- Output parsing for valid packets (stamps contractVersion/source/sessionId/iteration)
- Degraded behavior for: malformed JSON, invalid packet shape, connector throw, nonzero exit code
- Markdown-fenced output extraction end-to-end
- evaluatorMode property is "llm" not "probe"

### Manual probe upgrade (ss-llm-006)
- `probe-spec-studio-json.js` now accepts `--mode probe|llm` flag
- When `--mode llm`, hits `GET /spec-studio/mode` first and prints server evaluator mode
- Warns (but does not abort) when server mode doesn't match expected mode
- `--help` flag added
- `docs/spec-studio-manual-json-probe.md` updated with LLM mode instructions and Phalanx gate warning

### Phalanx integration gate (ss-llm-007)
- `docs/plans/spec-studio-live-phalanx-discussion-loop.md` updated to gate `PHALANX_SEMANTIX_HTTP_URL` wiring on ss-llm-008 completion
- Operators must verify `GET /spec-studio/mode` returns `evaluatorMode: "llm"` before connecting Phalanx

## Test Results

```
npm test --workspace packages/stx

tests 388
pass  388
fail  0
```

(Also fixed pre-existing test regression: `USER_TURN_BODY_KIND_VALUES` test
was missing `"batch"` from the expected array — the source already had it.)

## How To Activate LLM Mode

```bash
SPEC_STUDIO_EVALUATOR=llm node packages/stx/src/cli.js serve

# Verify mode
curl http://127.0.0.1:4401/spec-studio/mode
# {"evaluatorMode":"llm","ready":true}

# Run LLM-mode probe
npm run probe:spec-studio-json --workspace packages/stx -- \
  --url http://127.0.0.1:4401/spec-studio/evaluate \
  --mode llm
```

The model used defaults to `claude-sonnet-4-6`. Override with
`SEMANTIX_SPEC_STUDIO_MODEL`. Timeout defaults to 60 seconds;
override with `SEMANTIX_SPEC_STUDIO_TIMEOUT_MS`.

## Gate Status

ss-llm-008 is **not complete** until a live LLM-mode manual probe is recorded
against a running instance. `PHALANX_SEMANTIX_HTTP_URL` wiring must remain
blocked until that proof exists.
