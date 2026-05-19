# Spec Studio Phalanx Capability Handshake Adapter - Semantix Side

Status: implemented at packages/stx/src/spec-studio-handshake.js
Owner: Semantix integration with Phalanx Spec Studio
Source contract: docs/phalanx-spec-studio-integration-contract.md

## What This Adapter Provides

Phalanx (or any caller) imports the package export and gets a small
`{ describe, evaluate, isAvailable, capabilities }` adapter that
exercises Semantix packet generation in fixture or simulated mode
without a long-running Semantix service.

`describeSemantixCapabilities()` returns the static handshake summary:

- `contractVersion` (`semantix.phalanx.spec-studio.v1`)
- `sources` (`semantix`, `phalanx-degraded`)
- `triggers` (initial / user_turn / reconsider / context_response /
  decide_all / skip)
- `userTurnBodyKinds` (text / free / choice / skip / delegate /
  reconsider)
- `contextRequestPurposes` (all 7)
- `contextSourceKinds` (all 8)
- `findingKinds` and `findingSeverities`
- `readinessValues` and `existingSystemModes`
- `capabilities` summary including authority boundaries:
  - `lockAuthority: "phalanx"`
  - `coverageAuthority: "phalanx"`
  - `decisionIdAuthority: "phalanx"`
  - `hoplonAccess: "via phalanx broker only"`
  - `degradedReporting: "semantix-side; phalanx-degraded fallback is Phalanx-owned"`

## Modes

`createSemantixHandshakeAdapter(options)` accepts:

- `evaluator(request)` - a custom evaluator function (LLM-backed in
  production, deterministic in tests).
- `fixtureResponses` - either an object keyed by trigger or a function
  `(request) => response` for fixture-driven Phalanx tests.
- `unavailable: true` plus `unavailableReason` to simulate Semantix
  being out of service. The adapter returns a degraded packet rather
  than throwing.
- `strictContinuity: true` to escalate stable-id continuity violations
  to thrown ValidationErrors.
- `onContinuityViolation(violations)` to observe continuity violations
  without throwing.

The wrapped evaluator runs through `withDegradationFallback` so any
thrown error or malformed response degrades into a needs_user packet
with a blocker finding instead of bubbling up as an opaque failure.
Phalanx pipelines never see Semantix unavailability as a terminal
crash.

## Authority Boundary

- The adapter never queries Hoplon directly. Brokered context flows
  through Phalanx.
- The adapter never starts a server, never reads from the network, and
  never hardcodes a host repo path. Phalanx tests simply `import` the
  package export.
- Lockability is advisory: `isHandshakePacketLockable(packet)` mirrors
  Phalanx's lock criteria so callers can short-circuit UI affordances,
  but Phalanx still computes the canonical lock decision before
  minting a SpecArtifact.

## Tests Cover

- describe surface (contract version + supported triggers/purposes/sources)
- fixture-mode evaluation (object form and function form)
- evaluator-mode evaluation (custom impl)
- malformed evaluator response → degraded honestly
- evaluator that throws → degraded honestly (no opaque failure)
- unavailable adapter → degraded packet, isAvailable() reports false
- prior-state ID preservation: continuity violations surface via
  callback or strict-mode throw
- multi-turn smoke test driving initial → user_turn through the
  in-process adapter
- Phalanx request-shape probe covering live initial envelopes, choice
  turns, nested context-response episodes, and the full Phalanx
  requirement enum surface
