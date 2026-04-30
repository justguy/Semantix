# Spec Studio Manual JSON Pre-Integration Tasks

Status: ready for implementation
Owner: Semantix
Purpose: prove the iterative Spec Studio discussion loop by POSTing JSON
directly to Semantix before wiring Phalanx live transport.

## Goal

Before integrating with Phalanx, Semantix must expose a local testable
surface where we can send plain JSON requests and observe valid
`SemantixEvaluateResponse` JSON responses.

The test loop must work with manual payloads, curl, or any HTTP client:

1. send initial directive JSON
2. receive packet + optional `nextTurn`
3. send user answer JSON with `currentPacket`
4. receive updated packet
5. repeat until `readiness` is `ready`, `needs_user`, or `blocked`

This is the pre-integration gate. Phalanx should not be required to run
while this is being debugged.

## Task 1: JSON Evaluate Endpoint

Add an HTTP endpoint in Semantix:

```http
POST /spec-studio/evaluate
```

Request body:

```ts
SemantixEvaluateRequest
```

Response body:

```ts
SemantixEvaluateResponse
```

Implementation requirements:

- Route must use `createSemantixHandshakeAdapter`.
- Route must accept Phalanx-shaped JSON already covered by
  `packages/stx/tests/spec-studio-phalanx-request-probe.test.js`.
- Route must return JSON validation errors for invalid request shape.
- Route must not require Phalanx, Hoplon, repo access, or a long-running
  external service.

Acceptance:

- Manual `curl` POST with an initial request returns HTTP 200 and a valid
  response packet.
- Invalid JSON or invalid request shape returns HTTP 400 with useful
  validation details.

## Task 2: Deterministic Discussion Evaluator

Add a deterministic/mock evaluator mode for the endpoint.

This evaluator is not pretending to be production Semantix. It exists to
prove transport, request normalization, response validation, degraded
fallback, and multi-turn mechanics.

Required behavior:

- `trigger: "initial"` returns an ambiguous `needs_user` packet with a
  `nextTurn` question.
- `trigger: "user_turn"` with a choice answer can return a `ready`
  packet.
- `trigger: "context_response"` accepts nested Phalanx context episode
  shape and returns a valid packet.
- `skip`, `delegate`, and `reconsider` bodies do not crash the endpoint.
- Throwing or malformed evaluator mode returns a Semantix degraded packet,
  not a process crash.

Acceptance:

- A two-turn JSON-only discussion can run locally:
  initial -> question -> choice -> ready.

## Task 3: Manual JSON Fixtures

Add JSON fixtures under a dedicated folder, for example:

```text
packages/stx/tests/fixtures/spec-studio-manual-json/
```

Required fixtures:

- `initial.json`
- `choice-turn.json`
- `free-turn.json`
- `skip-turn.json`
- `delegate-turn.json`
- `reconsider-turn.json`
- `context-response-nested.json`
- `malformed-request.json`

Fixtures should be copy-pasteable request bodies for
`POST /spec-studio/evaluate`.

Acceptance:

- Each fixture is exercised by an automated test.
- The valid fixtures return HTTP 200 with valid response JSON.
- The malformed fixture returns HTTP 400.

## Task 4: Manual Probe Script

Add a small script that sends fixture JSON to a running Semantix server.

Recommended command:

```bash
npm run probe:spec-studio-json --workspace @semantix/stx -- --url http://127.0.0.1:4401/spec-studio/evaluate
```

Script behavior:

- POST `initial.json`
- capture the returned packet
- inject it into the second request as `currentPacket`
- POST `choice-turn.json`
- print compact readiness, packet source, iteration, and nextTurn status

Acceptance:

- The script exits 0 when the JSON-only discussion reaches a valid packet.
- The script exits nonzero and prints the response body when validation
  fails.

## Task 5: HTTP Regression Tests

Add Semantix tests that start the local HTTP server in-process and POST
the manual fixtures.

Coverage:

- initial request without optional state arrays
- user choice with `currentPacket`
- nested context-response episode
- skip / delegate / reconsider request bodies
- malformed request returns 400
- evaluator failure returns non-lockable Semantix degraded response

Acceptance:

```bash
node --test packages/stx/tests/spec-studio-manual-json-http.test.js
npm test
```

## Task 6: Manual Test Guide

Add a short operator-facing guide:

```text
docs/spec-studio-manual-json-probe.md
```

It should include:

- how to start Semantix locally
- endpoint URL
- example `curl` for `initial.json`
- example `curl` for a follow-up turn
- how to identify success:
  - `source: "semantix"`
  - valid `readiness`
  - valid `coverage`
  - optional `nextTurn`
  - no HTTP 500 for normal evaluator failures

## Done Means

We can manually test the iterative discussion loop by sending JSON only
to Semantix. Phalanx is not running. No Phalanx environment variables are
required. Once this passes, Phalanx integration should be reduced to
setting `PHALANX_SEMANTIX_HTTP_URL` and confirming the same JSON shape
travels through Phalanx's `live:semantix` transport.
