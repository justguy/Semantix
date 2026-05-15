# Semantix Phase 1 Readiness Record

Status: complete
Updated: 2026-05-15

This record tracks the Phase 1 closeout evidence. Phase 1 is closed with Codex app-server
resume/steer integrated through Semantix-owned freshness gates and with the remaining app-server
limitations documented below.

## Codex Version Evidence

Observed on 2026-05-12 from the Semantix repo root:

- `codex --version`: `codex-cli 0.130.0`
- `codex exec --version`: `codex-cli-exec 0.130.0`
- `codex exec -c approval_policy="never" -c sandbox_mode="workspace-write" --version`:
  `codex-cli-exec 0.130.0`
- `CODEX_HOME=/private/tmp/semantix-codex-version-home codex exec --version`:
  `codex-cli-exec 0.130.0`

## App-Server Protocol Smoke

Live JSON-RPC probes were run against `codex app-server` with an isolated temporary `CODEX_HOME`,
`approvalPolicy: "never"`, `sandboxMode: "workspace-write"`, and client name
`semantix-phase1-smoke`.

Results against `codex-cli 0.130.0`:

| Method | Result |
| --- | --- |
| `initialize` | Accepted. Returned user agent `semantix-phase1-smoke/0.130.0`, `platformFamily: "unix"`, and `platformOs: "macos"`. |
| `thread/start` | Accepted. Returned a thread/session id, `model: "gpt-5.5"`, `modelProvider: "openai"`, `approvalPolicy: "never"`, and `sandbox.type: "workspaceWrite"`. |
| `turn/start` | Accepted. Returned a runtime turn id with `status: "inProgress"`. |
| `turn/interrupt` | Accepted when sent with `threadId`, `turnId`, and `expectedTurnId`; returned `{}` in the focused interrupt probe. A same-tick interrupt can return `no active turn to interrupt`. |
| `thread/read` | Accepted for metadata when `includeTurns: false`. Before the first materialized user message, `includeTurns: true` returns an unavailable/not-materialized error. |
| `thread/turns/list` | Requires the initialize capability `experimentalApi: true`. With that capability, a newly created empty thread still reports turns unavailable before the first materialized user message. |
| `thread/resume` | Integrated for existing paused Semantix runtime sessions after artifact, node, approval, and session-state checks pass. It is not used as a replacement for Semantix checkpoint resume. |
| `turn/steer` | Integrated for active Semantix turns. The control plane verifies the current artifact identity plus Semantix and runtime turn identities, then sends `expectedTurnId` to Codex. |

## Connector Evidence

The connector now:

- advertises `experimentalApi: true` during JSON-RPC initialize
- sends both `turnId` and `expectedTurnId` for `turn/interrupt`
- exposes `thread/resume` and `turn/steer` wrappers without making Codex transcript state
  authoritative
- has focused test coverage for initialize capabilities, `thread/read`, `thread/turns/list`, and
  `turn/interrupt`, `thread/resume`, and `turn/steer` request shapes

The control plane now:

- freshness-checks session creation, turn submission, active-turn steering, and paused-thread resume
  against the current `ReviewArtifact`
- rejects stale steering and stale resume requests after artifact changes
- keeps interrupted sessions Semantix-paused until a fresh resume request succeeds, even if a runtime
  idle notification arrives later
- keeps checkpoint resume under Semantix checkpoint and approval identity rather than Codex
  `thread/resume`

Verification:

- `node --test control-plane/tests/codex-app-server-connector.test.js`
- `node --test control-plane/tests/control-plane.test.js`
- `node --test --test-force-exit control-plane/tests/server.test.js`
- `npm test --workspace @semantix/control-plane`

## Preview Fidelity Evidence

Updated for `stx-p1-003` on 2026-05-12:

- `previewRef` records now expose `source`, `sourceLabel`, `fidelity`, and `contentIsSynthetic`.
- Explicit runtime diff bodies are labeled `runtime_diff` and use `text/x-diff` unless a more
  specific media type is provided.
- Synthesized `StateEffect` summaries are labeled `metadata_only`; synthesized content includes
  `! previewSource state_effect_metadata` and `! previewFidelity metadata_only`.
- The browser diff view and phase preview label metadata-only previews separately from runtime
  previews.
- `stx diff` prints `previewSource` and `previewFidelity` before preview content and warns when a
  preview is metadata-only.

Verification:

- `npm test` in `control-plane` passed 27 tests.
- `npm run test --workspace @semantix/stx` passed.
- `npm run build:ui --workspace @semantix/stx` passed.

## Browser Host Evidence

Updated for `stx-p1-004` on 2026-05-12:

- Sandboxed `stx serve --host 127.0.0.1 --port 4555` failed with `listen EPERM`, matching the
  earlier socket-restricted environment note.
- The same live host command succeeded outside the sandbox on `http://127.0.0.1:4555`.
- `GET /health` returned `200` with `{ "status": "ok" }`.
- `GET /` returned `200` with `text/html; charset=utf-8`.
- `GET /chat` returned `302` with `Location: /index.html`.
- `PUT /runs/live-browser-host/intent` and `POST /runs/live-browser-host/compile` succeeded.
- `GET /runs/live-browser-host/previews?previewRef=...` returned the expected previewRef with
  `source: "state_effect_metadata"`, `fidelity: "metadata_only"`, and `contentIsSynthetic: true`.
- `GET /runs/live-browser-host/events?after=0` returned `200`,
  `text/event-stream; charset=utf-8`, and an initial `ping` event.

Verification:

- `npm run build:ui --workspace @semantix/stx`
- live `stx serve` probe captured in `/private/tmp/semantix-browser-host-proof.json`

## Final Verification

Updated for `stx-p1-002` and `stx-p1-005` on 2026-05-15:

- `node --test control-plane/tests/codex-app-server-connector.test.js` passed 2 tests.
- `node --test control-plane/tests/control-plane.test.js` passed 15 tests.
- `node --test --test-force-exit control-plane/tests/server.test.js` passed 8 tests outside the
  socket-restricted sandbox.
- `node --test packages/runtime-codex/tests/strict-compiler.test.js packages/runtime-codex/tests/admitted-code-change-host.test.js` passed 23 tests.
- `npm test --workspace @semantix/control-plane` passed 28 tests outside the socket-restricted
  sandbox.
- Full workspace `npm test` passed outside the socket-restricted sandbox
  (`@semantix/stx`: 407 tests; `@semantix/control-plane`: 28 tests).

No Phase 1 closeout blocker remains. Deferred limitations are the experimental Codex app-server
surface, the empty-thread `thread/resume` limitation from the smoke proof, and the pre-materialized
thread read/turn-list limitations already tracked in `KNOWN_GAPS.md`.
