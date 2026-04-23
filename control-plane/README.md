# Semantix Control Plane

Phase-1 implementation of the Semantix Control Plane in a dedicated module. This backend is the
source of truth for review artifacts, approvals, freshness, checkpoints, audit records, and
normalized run events shared by browser and terminal-native `stx` clients.

## Scope

- one runtime adapter: `CodexCliRuntimeAdapter`
- one active backend family per run
- multiple concurrent Codex runtime sessions per run, all governed by the same backend truth
- no transcript-derived authority
- versioned Semantix objects as the shared backend contract

## Intended Layout

- `src/contracts.js`: Semantix object factories and shared helpers
- `src/connectors/codex-cli-connector.js`: Codex CLI process connector, config overrides, and runtime home isolation
- `src/connectors/codex-app-server-connector.js`: persistent Codex `app-server` JSON-RPC connector for multi-turn sessions
- `src/control-plane-service.js`: review, freshness, approval, execution, and event orchestration
- `src/runtime-registry.js`: replaceable adapter boundaries and registry
- `src/storage/file-run-store.js`: file-backed persistence for run state and audit/event records
- `src/runtime-adapters/codex-cli-runtime-adapter.js`: phase-1 runtime boundary for Codex CLI
- `src/http/server.js`: HTTP + SSE server for browser and `stx`
- `src/index.js`: local wiring entrypoint
- `tests/control-plane.test.js`: freshness, stale rejection, event streaming, and execution tests

## Contract Priorities

The implementation follows these source-of-truth docs:

1. `docs/semantix-overview.md`
2. `docs/Semantix Control Plane UI.md`
3. `docs/semantix-control-plane-spec.md`
4. `semantix-codex-poc-v2.md`

The public data model should preserve the Semantix vocabulary from those docs:

- `IntentContract`
- `ReviewArtifact`
- `ExecutionPlan`
- `ExecutionNode`
- `NodeInspectorPayload`
- `StateEffect`
- `ApprovalGate`
- `ResumeCheckpoint`
- `RiskSignal`
- `RunEvent`

## Assumptions

- Phase 1 uses built-in Node APIs to avoid introducing unnecessary dependencies.
- Persistence is file-backed inside `control-plane/data/` at runtime and is ignored by git.
- The Codex connector and adapter are injectable so tests can verify flow without requiring a real
  Codex binary.
- Freshness checks are enforced server-side on mutating actions using `planVersion`,
  `artifactHash`, and the relevant node revision or change identity.

## Codex Connectors

The runtime adapter now uses two replaceable Codex connector surfaces:

- `CodexCliConnector` for one-shot `codex exec` compatibility
- `CodexAppServerConnector` for persistent multi-turn sessions over `codex app-server`

Current local evidence from the installed CLI on this machine:

- `codex exec --version` returns `codex-cli-exec 0.122.0`
- `codex exec -c approval_policy="never" -c sandbox_mode="workspace-write" --version` is accepted
- `CODEX_HOME=/tmp/... codex exec --version` is honored and warns if the directory does not exist
- `codex exec "ping"` without a writable Codex home fails on session creation under `~/.codex/sessions`
- `codex app-server` accepts JSON-RPC `initialize`, `thread/start`, `thread/read`, `thread/turns/list`, `turn/start`, and `turn/interrupt`
- `codex -c approval_policy="never" -c sandbox_mode="workspace-write" app-server` returns thread settings showing `approvalPolicy: "never"` and `sandbox.type: "workspaceWrite"`

`CodexCliConnector` behavior:

- uses `codex exec` in non-interactive mode
- passes runtime settings through `-c key=value` overrides instead of hardcoding unstable flags
- creates and uses a dedicated `CODEX_HOME` by default under `control-plane/data/codex-home`
- writes the prompt payload to stdin and closes stdin explicitly
- captures stdout/stderr plus opportunistic JSON/NDJSON messages for adapter normalization

`CodexAppServerConnector` behavior:

- spawns one long-lived `codex app-server` process and initializes it once
- multiplexes concurrent runtime sessions by Codex `threadId`
- submits multi-turn input via `turn/start`
- streams normalized notifications back into the control plane event bus
- supports interrupting active turns via `turn/interrupt`

## Multi-Turn Sessions

Interactive Codex sessions are now managed under the control plane instead of bypassing it.

- the reviewed `run` and `ReviewArtifact` remain the authoritative Semantix objects
- runtime interaction is tracked as a durable session + turn layer under the run
- session creation and turn submission are freshness-checked against the current artifact
- stale turns are rejected server-side after interventions or other artifact changes
- browser UI and `stx` consume the same session routes and the same normalized SSE stream

Current HTTP routes for runtime sessions:

- `POST /runs/:runId/sessions`
- `GET /runs/:runId/sessions`
- `GET /runs/:runId/sessions/:sessionId`
- `POST /runs/:runId/sessions/:sessionId/turns`
- `GET /runs/:runId/sessions/:sessionId/turns`
- `POST /runs/:runId/sessions/:sessionId/interrupt`
- `GET /runs/:runId/events?after=<sequence>&sessionId=<sessionId>`

Known gaps for the current multi-turn implementation are tracked in
[`KNOWN_GAPS.md`](./KNOWN_GAPS.md).

Operational note:

- a dedicated `CODEX_HOME` isolates session state, but it also means Codex auth must be available to
  the control-plane process, usually via environment-backed auth such as `OPENAI_API_KEY`, or by
  explicitly pointing `SEMANTIX_CODEX_HOME` at a prepared Codex home

## Verification

Run the local test suite with:

```bash
cd control-plane
TPF_LLM_TOOL=codex tpf npm test
```

The server/SSE coverage binds loopback sockets, so sandboxed environments may still require
explicit loopback permission for the HTTP tests.

## Browser UI

The browser control surface can now be staged and served from the same control-plane process.
The build is intentionally dependency-free: it copies `../Design` and `../shared` into
`control-plane/dist/ui`, then the HTTP server exposes those files on the same origin as the
review APIs and SSE stream.

Build the UI bundle:

```bash
cd control-plane
TPF_LLM_TOOL=codex tpf npm run build:ui
```

Preview it locally:

```bash
cd control-plane
TPF_LLM_TOOL=codex tpf npm run preview:ui
```

Routes after startup:

- `/` -> main Semantix control surface
- `/chat` -> design chat projection
- `/canvas` -> design canvas sandbox
- `/how-it-works` -> companion architecture page from language to governed execution
- `/runs/:runId/*` -> control-plane JSON/SSE APIs

The current UI still loads React, ReactDOM, and Babel from CDN at runtime, so the browser needs
network access for those vendor assets even though the Semantix source files are served locally.
