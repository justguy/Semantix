# Spec Studio Live Phalanx Discussion Loop

Status: ready for implementation
Owner: Semantix side of live Phalanx integration
Source contract: docs/phalanx-spec-studio-integration-contract.md
Probe coverage: packages/stx/tests/spec-studio-phalanx-request-probe.test.js
Pre-integration task list: docs/plans/spec-studio-manual-json-preintegration-tasks.md

## Task

Expose a live Semantix evaluation surface that Phalanx can call through
its `live:semantix` transport so an iterative Spec Studio discussion can
run through Phalanx without falling back to `phalanx-degraded`.

Do not start by wiring Phalanx. First complete the manual JSON
pre-integration tasks so the loop can be proven by POSTing JSON directly
to Semantix.

This task is intentionally smaller than the full Phalanx integration. It
only makes Semantix callable with the request envelopes Phalanx already
emits and proves that one multi-turn discussion can advance through the
Semantix handshake adapter.

## Why This Exists

The Semantix contract, packet validator, readiness classifier,
handshake adapter, degraded behavior, context request planner, user-turn
helpers, and Phalanx-shape request probe are implemented and passing.

The remaining blocker is transport/runtime wiring: Phalanx's
`live:semantix` path POSTs a `SemantixEvaluateRequest` to
`PHALANX_SEMANTIX_HTTP_URL`. Semantix does not yet expose the matching
HTTP endpoint.

## Missing On Semantix End

0. Complete the manual JSON pre-integration task list.

   See:

   ```
   docs/plans/spec-studio-manual-json-preintegration-tasks.md
   ```

1. Add a live evaluate HTTP endpoint.

   Recommended shape:

   ```
   POST /spec-studio/evaluate
   ```

   Request body: `SemantixEvaluateRequest`

   Response body: `SemantixEvaluateResponse`

2. Back the endpoint with `createSemantixHandshakeAdapter`.

   The first implementation may use a deterministic fixture/mock
   evaluator so the transport, request normalization, degraded fallback,
   and multi-turn mechanics can be verified before adding an LLM-backed
   evaluator.

3. Provide a CLI/server mode that starts only this evaluation endpoint
   or adds the route to `stx serve`.

   Phalanx should be able to set:

   ```
   PHALANX_SEMANTIX_HTTP_URL=http://127.0.0.1:<port>/spec-studio/evaluate
   ```

4. Return honest degraded responses from the Semantix side when the
   evaluator fails, returns malformed output, or is intentionally
   unavailable.

   The response must stay `source: "semantix"` and must not be lockable.
   If Semantix is fully unreachable, Phalanx still owns the
   `source: "phalanx-degraded"` envelope.

5. Add an HTTP-level Semantix test that mirrors Phalanx's
   `live:semantix` transport.

   This should exercise:

   - initial request without optional prior-state arrays
   - user choice turn with `currentPacket`
   - skip / delegate / reconsider turn bodies
   - nested Phalanx context episode shape
   - malformed evaluator output degrades instead of throwing

6. Add one documented manual smoke command for Phalanx.

   Example:

   ```
   PHALANX_SEMANTIX_HTTP_URL=http://127.0.0.1:<port>/spec-studio/evaluate
   ```

   Then start a Phalanx Spec Studio session with
   `evaluatorSource: "live:semantix"` and confirm the session evidence
   mode is live, not degraded.

   **GATE**: `PHALANX_SEMANTIX_HTTP_URL` wiring requires `ss-llm-008`
   (LLM-backed readiness proof) to be complete first. The server defaults to
   the deterministic probe evaluator unless `SPEC_STUDIO_EVALUATOR=llm` is
   set and a real LLM connector is configured. Verify the server is in LLM
   mode before connecting Phalanx:

   ```bash
   curl http://127.0.0.1:<port>/spec-studio/mode
   # expected: {"evaluatorMode":"llm","ready":true}
   ```

   See `docs/spec-studio-llm-proof.md` for the proof evidence required
   before this gate opens.

## Already Done On Semantix End

- The public package export includes all Spec Studio modules.
- The handshake adapter can run in-process with evaluator, fixture, or
  unavailable modes.
- Request validation now accepts Phalanx turn bodies:
  `text`, `free`, `choice`, `skip`, `delegate`, and `reconsider`.
- Request normalization now fills missing initial arrays and unwraps
  nested Phalanx context episodes.
- The packet validator accepts the full Phalanx requirement enum:
  `functional`, `nonfunctional`, `constraint`, `negative`,
  `acceptance`, and `integration`, plus `status: "contested"`.
- `spec-studio-phalanx-request-probe.test.js` proves mocked Phalanx
  envelopes can run through Semantix without starting Phalanx.

## Acceptance Criteria

- `POST /spec-studio/evaluate` accepts the mocked Phalanx envelopes from
  `spec-studio-phalanx-request-probe.test.js`.
- The endpoint returns a valid `SemantixEvaluateResponse`.
- An invalid or throwing evaluator returns a non-lockable Semantix
  degraded packet instead of HTTP 500 for normal evaluator failures.
- A two-turn discussion can run over HTTP:
  initial request -> Semantix question packet -> user choice request ->
  ready or next-question packet.
- `npm test` passes.
- A Phalanx local smoke with `evaluatorSource: "live:semantix"` reaches
  evidence mode `live` when the Semantix endpoint is running.

## Still Phalanx-Owned

- Spec Studio UX shell and session persistence.
- Canonical lock preflight and immutable lock artifact storage.
- Canonical decision audit IDs.
- Hoplon/repo/tool brokering for context requests.
- Staff handoff after lock.
- Drift detection against the locked artifact.

## Verification Commands

```
node --test packages/stx/tests/spec-studio-phalanx-request-probe.test.js
npm test
```
