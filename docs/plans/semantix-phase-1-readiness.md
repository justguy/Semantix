# Semantix Phase 1 Readiness Record

Status: in progress
Updated: 2026-05-12

This record tracks the Phase 1 closeout evidence. Phase 1 is not closed yet; this update records the
Codex app-server protocol revalidation for `stx-p1-001`.

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
| `thread/resume` | Did not resolve for a newly created empty thread: `no rollout found for thread id ...`. |
| `turn/steer` | Accepted with `expectedTurnId` and returned the target `turnId`; integrated steering behavior is still unsettled. |

## Connector Evidence

The connector now:

- advertises `experimentalApi: true` during JSON-RPC initialize
- sends both `turnId` and `expectedTurnId` for `turn/interrupt`
- has focused test coverage for initialize capabilities, `thread/read`, `thread/turns/list`, and
  `turn/interrupt` request shapes

Verification:

- `node --test control-plane/tests/codex-app-server-connector.test.js`

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

## Remaining Closeout Items

- `stx-p1-002`: decide whether current `thread/resume` and `turn/steer` behavior should be
  integrated or reclassified as upstream limitations.
- `stx-p1-005`: publish the final Phase 1 readiness record after all closeout evidence agrees.
