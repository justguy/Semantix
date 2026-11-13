# Semantix Control Plane compatibility package

The implementation now lives in the workspace packages. This directory retains
compatibility exports, a server entry point, and integration tests.

| Implementation | Location |
| --- | --- |
| Contracts, registry, orchestration | [`packages/core`](../packages/core) |
| Codex connectors, admission, code-change host | [`packages/runtime-codex`](../packages/runtime-codex) |
| Application wiring, CLI, UI, HTTP/SSE and local store | [`packages/stx`](../packages/stx) |

The control plane persists run artifacts, approval decisions, checkpoints,
runtime sessions, audit records, and events. It checks freshness before
mutating reviewed state and coordinates semantic generation and approved host
execution. Spec Studio alignment and the separate locked-handoff prototype
are exposed by the same server.

## Run and verify

From the repository root:

```bash
npm ci
npm run dev
```

Open [http://127.0.0.1:4401/](http://127.0.0.1:4401/). The root command builds
the UI before serving it. `/chat`, `/canvas`, and `/how-it-works` are legacy
redirects to `/index.html`, not separate applications.

```bash
npm test --workspace @semantix/control-plane
```

HTTP/SSE tests need loopback socket access. Tests inject runtime connectors;
live use needs a configured Codex CLI.

The default data directory is `data/` under the process working directory,
overridable with `SEMANTIX_STX_DATA_DIR` or `SEMANTIX_CONTROL_PLANE_DATA_DIR`.
The default execution workspace is the Semantix repository; select another
with `SEMANTIX_WORKSPACE_ROOT`. `SEMANTIX_CODEX_HOME` is optional and does not
default to a private home inside this package.

See the [root README](../README.md) for the current workflows and configuration,
and the [implementation spec](../docs/semantix-control-plane-spec.md) for API,
storage, execution, and integration boundaries.
