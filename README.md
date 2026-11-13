# Semantix

Semantix is a local Codex-backed workbench for clarifying intent, reviewing
generated proposals, and approving code changes. It combines a browser UI,
the `stx` CLI, a persistent control plane, and deterministic checks around
model output.

You can turn a vague request into requirements, inspect proposed file changes
and their issues, request a correction, and approve execution. Requests for
prose can produce a semantic response without file execution. A separate
planning-handoff API compiles host-locked requirements into a canonical
artifact for downstream planning.

## Run locally

Use Node.js 24 and npm (the environment used for verification). Live
clarification and generation require a configured, authenticated Codex CLI
available as `codex`, or selected with `SEMANTIX_CODEX_COMMAND`.

```bash
npm ci
npm run dev
```

Open [http://127.0.0.1:4401/](http://127.0.0.1:4401/). The dev command builds
the React UI and starts the Node server. UI dependencies are bundled locally;
live model calls still require the configured Codex provider.

To work on another repository, select it explicitly:

```bash
SEMANTIX_WORKSPACE_ROOT=/absolute/path/to/project npm run dev
```

The default execution workspace is the Semantix repository. Approving a code
proposal can create, modify, delete, or rename files in the selected workspace.

Server options can be passed after `--`:

```bash
npm run dev -- --host 127.0.0.1 --port 4555
```

## What the browser does

1. **Clarify the request.** Spec Studio asks individual or grouped questions,
   incorporates answers, and tracks requirements, acceptance criteria,
   findings, scope, and readiness. Degraded evaluation cannot mark a packet ready.
2. **Generate a proposal.** The browser passes the ready packet's selected
   requirements and acceptance text into the Codex run. Classification routes
   the request to a code-change proposal or a semantic response.
3. **Review.** Inspect the execution graph, node details, proposed file diffs,
   validation issues, and available corrections. Code proposals pass schema
   admission and deterministic code-change review before host execution.
4. **Correct or approve.** A correction updates the run and regenerates the
   proposal. Approval is bound to the current artifact; stale approval or resume
   requests are rejected. Approved code changes are applied by the registered
   host function.

Run state, approvals, checkpoints, audit records, and events are stored locally.
The server exposes HTTP APIs and an SSE event stream for clients.

## Use the CLI

The CLI shares the control-plane implementation and local store. `run` starts
the Codex flow directly; it does not perform the browser's Spec Studio intake.

```bash
node ./stx run "Add validation to the settings form" --boundary "Preserve existing settings"
node ./stx flow latest
node ./stx graph latest
node ./stx inspect latest
node ./stx diff latest
node ./stx fix latest
```

After reviewing a proposal, approve and execute it with:

```bash
node ./stx approve latest
```

Use `node ./stx --help` for the full command list. The CLI opens the local
application directly; it does not require a running HTTP server.

## Deterministic planning handoff

Host integrations can use `buildPlanningHandoff()` or
`POST /spec-studio/planning-handoff` to compile:

```text
LockedIntentArtifact + SemantixAlignmentPacket + audit state
  → LockedSpecPlanningHandoff
```

The builder performs no model calls. It emits canonical JSON, input hashes,
a handoff fingerprint, requirements, acceptance criteria, boundaries,
provenance, and verification obligations. A separate pure function classifies
freshness from observations supplied by the host. Greenfield and update-mode
fixtures exercise this path.

**The browser does not yet use this locked-handoff API.** Its ready packet is
advisory prompt context, not a host-locked planning artifact. The host still
needs to implement the lock ceremony, immutable handoff persistence, and
downstream planner integration. Full nested-schema, grounding/reference,
and governance role-binding validation remain unfinished.

## Configuration

| Variable | Purpose / default |
| --- | --- |
| `SEMANTIX_WORKSPACE_ROOT` | Workspace for generated code changes; defaults to this repository. |
| `SEMANTIX_STX_DATA_DIR` | Local store; defaults to `data/` under the process working directory. `SEMANTIX_CONTROL_PLANE_DATA_DIR` is a fallback alias. |
| `SEMANTIX_CODEX_COMMAND` | Codex executable; defaults to `codex`. |
| `SEMANTIX_CODEX_HOME` | Optional prepared Codex home; otherwise uses normal Codex configuration. |
| `SEMANTIX_CODEX_CONFIG_PROFILE` | Optional Codex configuration profile. |
| `SEMANTIX_CODEX_MODEL` | General Codex model override. |
| `SEMANTIX_SPEC_STUDIO_MODEL` | Spec Studio model override; otherwise uses the general override or Codex default. |
| `SEMANTIX_SPEC_STUDIO_TIMEOUT_MS` | Spec Studio timeout; defaults to `300000`. |
| `SEMANTIX_CLASSIFIER_MODEL` | Request classifier model; defaults to `gpt-5.3-codex-spark`. |
| `SEMANTIX_CLASSIFIER_TIMEOUT_MS` | Classifier timeout; defaults to `20000`. |

The public server does not substitute a mocked evaluator when live Spec Studio
is unavailable. Probe evaluators are for explicit test/probe use.

## Repository layout

| Path | Responsibility |
| --- | --- |
| `packages/core` | Shared contracts, runtime registry, control-plane orchestration. |
| `packages/runtime-codex` | Codex connectors, typed constraint compiler, output admission, code review and application. |
| `packages/stx` | CLI, browser UI, HTTP/SSE server, persistence, Spec Studio and handoff builder. |
| `control-plane` | Compatibility entry points and integration tests. |
| `docs` | Current implementation spec, integration contracts, and broader design proposals. |

## Verify

```bash
npm test
npm run build:ui
```

The suite uses injected connectors and fixtures; passing it does not establish
live model quality. HTTP tests need permission to bind loopback sockets.

## Read more

- [Current implementation spec](docs/semantix-control-plane-spec.md)
- [Overview and broader design direction](docs/semantix-overview.md)
- [Spec Studio integration contract](docs/phalanx-spec-studio-integration-contract.md)
- [Planning-handoff contract and remaining work](docs/plans/spec-studio-deterministic-planning-handoff.md)
- [Language design and typed constraint contracts](docs/language-fundamentals.md)

The `context`, `constraint`, and `~>` syntax in the language documents describes
the language design. The executable compiler currently consumes structured
blueprints and typed ConstraintIR objects; `stx` is a CLI, not a parser for that
surface language.
