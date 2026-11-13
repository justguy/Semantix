# Semantix: Current Implementation Spec

Status: implemented local prototype, with integration and validation gaps noted below.

This document describes the code that runs in this repository. It replaces the
earlier phase-1 control-plane proposal. The [language fundamentals](language-fundamentals.md),
[review-surface design](semantix-review-surface-spec.md), and
[planning-handoff contract](plans/spec-studio-deterministic-planning-handoff.md)
describe broader design goals; they are not promises that every feature is implemented.

## Product and scope

Semantix turns a natural-language request into structured material that a person
can inspect before authorizing a consequential action. The repository contains
three related paths:

| Path | Input and result | Current boundary |
| --- | --- | --- |
| Spec Studio alignment | A directive plus session state becomes a typed requirements packet, findings, questions, and an advisory readiness verdict. | The evaluator does not own the host's lock ceremony or downstream planning. |
| Reviewed runtime execution | A directive becomes a compiled execution artifact, admitted semantic output, reviewable effects, and optionally an approved local code change. | The control plane owns approval and execution state; the configured Codex runtime generates candidates. |
| Deterministic planning handoff | A host-supplied locked artifact, packet, and audit state become a canonical handoff with hashes and verification obligations. | This is a separate API/library prototype. It does not invoke a planner or execute the handoff. |

The browser combines alignment with the reviewed runtime flow. It does **not**
currently mint an immutable locked artifact or call the planning-handoff API.
Those are separate integration steps, not hidden stages of the browser workflow.

## Running system

`npm run dev` builds the bundled React UI and starts the `stx` server at
`http://127.0.0.1:4401/`. The UI, HTTP routes, runtime adapter, and local file store
run in one Node application. The [README](../README.md) contains setup commands.

The default application registers one `CodexCliRuntimeAdapter` backed by
`CodexCliConnector`. Runtime session methods use the Codex app-server connector.
Additional adapters and multi-runtime orchestration remain design directions.
The separate `control-plane` package is a compatibility entry point to the shared
implementation, not a second backend with separate behavior.

Application composition is in [application.js](../packages/stx/src/application.js).
The principal modules are:

| Module | Responsibility |
| --- | --- |
| `packages/core` | Contracts, runtime/host-function registries, plan and approval state, execution coordination, sessions, events, and audit data. |
| `packages/runtime-codex` | Codex CLI/app-server connectors, blueprint compilation, strict candidate admission, code-change review, and local application of admitted changes. |
| `packages/stx` | CLI, HTTP server, browser UI, Codex flow projection, Spec Studio evaluation, and planning handoff. |
| `FileRunStore` | Local JSON run/session snapshots and JSONL events, audit records, and session turns. |

## Browser and reviewed runtime flow

1. The user enters a directive in the browser.
2. Spec Studio evaluates the request and asks for clarification when needed. The
   UI accepts options, free text, and batch answers, and renders a turn log.
3. Once alignment is ready, the user continues to compile. The UI converts the
   accepted packet into prompt text, then derives the intent fields sent to
   `/codex/runs`.
   This conversion is not a locked planning handoff.
4. The Codex layer classifies the request and selects a semantic-response or
   code-change path. The control plane persists the intent, compiles an execution
   artifact, and normally starts semantic admission automatically.
5. Generated output must pass the node's structural and compiled constraint
   checks. Admitted code changes produce concrete file targets and deterministic
   diff/review information. Semantic-response requests produce structured output
   without requiring a repository mutation.
6. The UI presents the flow, issues, proposed fixes, inspector, and changes. A
   supported fix updates the affected node and re-evaluates its semantic output.
7. Code-change execution pauses for approval. Approval is tied to the current
   artifact and checkpoint. The registered host function applies the admitted
   change only after the control plane's approval and execution checks.
8. The application persists the result and exposes normalized events and updated
   review state to clients.

The default deterministic target is `semantix.host.apply_admitted_semantic`.
It previews code changes and delegates application to `applyAdmittedCodeChange`.
This is a local code-change implementation, not a general implementation of every
external action envisioned by the review-surface design.

Source: [browser flow](../packages/stx/ui/control-surface/app.jsx),
[Codex flow layer](../packages/stx/src/codex-semantix-layer.js), and
[control-plane service](../packages/core/src/control-plane-service.js).

## Runtime contracts and enforcement

The control plane persists an intent, execution plan, and review artifact rather
than reconstructing authority from a transcript. Plans contain nodes, edges,
approval gates, state effects, and runtime/compiler metadata. The service uses
`planVersion`, `artifactHash`, relevant node revisions, and checkpoint identity to
reject stale approval, intervention, steering, or resume requests.

The strict compiler accepts structured blueprints and candidate envelopes. It
does not provide a general parser for the proposed `context`, `constraint`, and
`~>` language syntax shown in design documents.

Implemented candidate checks include:

- Strict JSON/schema admission, including required and forbidden fields.
- Compiled path roots, allow/deny lists, and operation restrictions.
- Required and forbidden capabilities declared by the candidate.
- Constraint selection from plan references and inline node constraints, with
  unresolved references rejected and node-specific policies isolated.
- Bounded retries, classified admission failures, and recorded attempt evidence.
- Deterministic code-change review and blocking issues before host execution.

Capability checks here inspect candidate declarations; they are not a general
operating-system sandbox. Likewise, compiler verifier and approval metadata do
not imply that arbitrary prose constraints have become deterministic validators.
The configured connector's runtime sandbox and the host-function implementation
remain part of the execution boundary.

Source: [contracts](../packages/core/src/contracts.js),
[strict compiler](../packages/runtime-codex/src/strict-compiler.js), and
[runtime adapter](../packages/runtime-codex/src/codex-cli-runtime-adapter.js).

## Spec Studio alignment contract

`POST /spec-studio/evaluate` accepts the caller's session identifier, trigger,
user turn, prior packet, decisions, findings, and optional context responses.
Non-initial turns carry the prior packet. The evaluator normalizes the request,
applies deterministic user-turn changes, invokes the live model, and validates
the result's structure, identity continuity, and authority boundary.

The response includes a `SemantixAlignmentPacket`, readiness, next-turn material,
coverage information, and a `turnLogEntry`. Readiness is `needs_user`, `blocked`,
or `ready`. It is advisory: `ready` is not a lock or an execution approval.

The packet separates requirements, acceptance, scope, assumptions, risks,
findings, decisions, existing-system context, and grounded facts. Context
requests are returned to the host; the host brokers repository/evidence access
and sends context responses back. Spec Studio does not obtain that authority
merely by emitting a request.

The default server uses a live evaluator through the Codex connector. Fixture
probe evaluators are for tests and scripts; selecting public-server probe mode
returns an unavailable/degraded path rather than simulated successful alignment.
`GET /spec-studio/mode` reports the selected mode, not a live model health test.

The evaluation route does not persist a host Spec Studio session or mint the
host's canonical lock and decision records. Runtime session APIs are a different
facility. Hosts must retain the alignment history and supply it on later turns.

See the [integration contract](phalanx-spec-studio-integration-contract.md),
[handshake](../packages/stx/src/spec-studio-handshake.js), and
[evaluator](../packages/stx/src/spec-studio-llm-evaluator.js).

## Deterministic planning handoff

The library's `buildPlanningHandoff` accepts `{ lockedArtifact, packet,
auditState, compilerProfileId? }`. It performs no model calls or host tool access.
The host must supply the lock, governance, evidence, sensitivity, and audit inputs.

The output contains requirements and acceptance criteria, update boundaries,
provenance and evidence, capability scopes, semantic and verification obligations,
planner checklist seeds, decision audit, input hashes, a stable handoff identifier,
and a fingerprint. `canonicalizePlanningHandoff`, `validatePlanningHandoff`, and
`fingerprintPlanningHandoff` expose the corresponding library operations.
`classifyFreshnessGateResult` classifies host-supplied observations; it does not
collect fresh evidence itself.

`POST /spec-studio/planning-handoff` returns `handoff`, `canonicalJson`, and a
`summary` with validation, repeat-build equality, hashes, and collection counts.
It builds the same input twice to report byte/fingerprint equality. It does not
persist the handoff, create a host lock, or invoke downstream planning.

Implemented rejection checks include non-ready/degraded packets, unresolved
blockers, missing required input, packet-hash and lock-identity mismatches,
unauthorized sensitive persistence, and missing freshness evidence coverage.
Greenfield and update fixtures exercise the boundary.

Validation remains partial against the full target contract. Complete nested
schemas, grounding/reference integrity, and governance role-binding enforcement
are unfinished. The API must not be represented as a complete production
authorization boundary. Host lock/persistence, planner loading, planning-output
checks, and execution-resume integration remain host follow-up work.

Source: [handoff module](../packages/stx/src/spec-studio-planning-handoff.js).
The [detailed handoff design](plans/spec-studio-deterministic-planning-handoff.md)
defines the intended contract beyond this implementation.

## HTTP surface

The authoritative routing and error mapping live in
[server.js](../packages/stx/src/http/server.js).

| Routes | Purpose |
| --- | --- |
| `GET /health` | Process health response. |
| `GET /runs`, `POST /runs` | List runs; bootstrap an intent/plan and optionally perform semantic admission. |
| `POST /codex/runs` | Start the classified Codex review flow. |
| `PUT /runs/:runId/intent`, `POST /runs/:runId/compile` | Update intent and compile an artifact. |
| `GET /runs/:runId/artifact`, `GET /runs/:runId/flow` | Fetch stored review state and its flow projection. |
| `POST /runs/:runId/flow/fixes`, `POST /runs/:runId/flow/approve` | Apply a supported fix or approve/resume the reviewed flow. |
| `GET /runs/:runId/previews?previewRef=...` | Resolve preview content from a state effect. |
| `GET /runs/:runId/nodes/:nodeId/inspector`, `POST /runs/:runId/nodes/:nodeId/interventions` | Inspect or intervene on a node. |
| `POST /runs/:runId/approvals`, `/execute`, `/pause`, `/resume` | Lower-level approval and execution controls. |
| `GET /runs/:runId/events` | Server-sent events, with `after` and optional `sessionId` filtering. |
| `GET` / `POST /runs/:runId/sessions` | List or create runtime sessions. |
| `GET /runs/:runId/sessions/:sessionId` | Inspect a runtime session. |
| `GET` / `POST /runs/:runId/sessions/:sessionId/turns` | Read or submit runtime turns. |
| `POST /runs/:runId/sessions/:sessionId/steer`, `/resume`, `/interrupt` | Control an existing runtime session. |
| `GET /spec-studio/mode`, `POST /spec-studio/evaluate` | Query evaluator mode or evaluate an alignment turn. |
| `POST /spec-studio/planning-handoff` | Compile host-supplied locked inputs into a handoff. |

The same server serves the bundled UI. `/` and legacy UI entry routes redirect
to `/index.html`. The daemon is intended for local use; multi-user authentication
and a hosted collaboration service are not implemented here.

## Persistence and audit

`FileRunStore` writes run and session snapshots as JSON and appends events,
audit records, and session turns as JSONL. The default root is `./data`, overridden
by `SEMANTIX_STX_DATA_DIR` or `SEMANTIX_CONTROL_PLANE_DATA_DIR`. The service
coordinates in-process mutations and exposes event replay to connected clients.
This is not a distributed store or a multi-process coordination guarantee.

The service also supports audit-bundle generation with redaction/size policy and
an explicit unsigned path. Audit storage does not imply that external signatures,
external evidence systems, or production retention policies are configured.

## Verification and remaining work

Run `npm test` and `npm run build:ui` from the repository root. Focused coverage is
in the [strict compiler tests](../packages/runtime-codex/tests/strict-compiler.test.js),
[control-plane tests](../control-plane/tests/control-plane.test.js),
[HTTP integration tests](../packages/stx/tests/spec-studio-manual-json-http.test.js),
and [handoff tests](../packages/stx/tests/spec-studio-planning-handoff.test.js).

These tests cover structural behavior, rejection cases, and fixture workflows.
They do not establish live model quality or prove that every design contract is
complete. Before claiming a production deployment, the remaining handoff
validation and host integration must be completed and exercised. The proposed
language frontend, additional runtime adapters, multi-user collaboration, and
distributed orchestration are also outside the current implementation.
