# Spec Studio Readiness Classifier and Update-Safety Rules - Semantix Side

Status: implemented at packages/stx/src/spec-studio-readiness.js
Owner: Semantix integration with Phalanx Spec Studio
Source contract: docs/phalanx-spec-studio-integration-contract.md

## Authority

Semantix readiness is advisory. Phalanx remains the lock authority and
recomputes blockers, coverage, and readiness server-side before
minting a SpecArtifact. This module exists so Semantix-side adapters
can self-classify before emitting a packet, so degraded paths fail
closed, and so test fixtures can be checked against the contract.

## Readiness Verdicts

`classifyReadiness(packet)` walks the candidate packet and returns a
verdict with `{ readiness, blockingReasons, findings, openQuestions,
reasons }`. The classifier short-circuits on the strongest gate first:

1. existingSystemContext missing -> `needs_user` with blocker.
2. duplicateDetected/replacementDetected without explicit approval ->
   `blocked` (approval absent) or `needs_user` (approval pending) with
   an open question. Explicit approval continues evaluation.
3. existingSystemContext.mode = `unknown` -> `needs_user` with
   target-surface question and blocker finding.
4. existingSystemContext.mode = `update` and missing targetSurfaces ->
   `needs_user`.
5. existingSystemContext.mode = `update` and missing all of
   doNotChange / reuseRequirements / compatibilityRequirements ->
   `needs_user`.
6. Final clarity checks (apply to greenfield and update once mode gates
   pass): alignedRequirement is non-empty, scope.inScope is set,
   scope.outOfScope captures obvious exclusions, at least one
   must-level requirement carries an acceptance criterion. Any blocker
   finding from these checks demotes readiness to `needs_user`; any
   concern finding demotes to `needs_user` as well so the user sees
   the issue before lock.

`applyReadinessVerdict(packet)` merges the verdict back into a
candidate packet, preserving user-raised findings (those without an
F-INPUT/F-CTX/F-MODE/F-UPD/F-REP/F-ALIGN/F-SCOPE/F-REQ/F-ACC id
prefix) while refreshing classifier-issued findings.

## Update Safety

Update requests cannot be treated as greenfield when current-system
context is missing. The classifier rejects:

- mode unknown (forces `needs_user`)
- mode update without targetSurfaces (forces `needs_user`)
- mode update without explicit non-change / reuse / compatibility
  boundaries (forces `needs_user`)

This closes the blank-slate-update failure mode that would otherwise
let Staff design against an empty surface list.

## Negative Requirements

`promoteNegativeRequirements({ requirements, scope, existingSystemContext })`
lifts free-text negatives and do-not-change boundaries into typed
`type: "negative"` requirement facts so Staff cannot miss them after
lock. Existing negative facts are preserved and not duplicated. New
negatives carry `priority: "must"`, `status: "confirmed"`, and an
auto-generated acceptance criterion of the form
`No changes that violate "<text>"`.

## Replacement Approval Signals

The classifier accepts three optional Semantix-side signals on the
candidate packet:

- `duplicateDetected: boolean`
- `replacementDetected: boolean`
- `replacementApproval: "explicit" | "pending" | "absent"` (default
  `pending`)

These are intentionally separate from the contract packet shape so
Phalanx-supplied packets remain valid; Semantix sets them at evaluator
time before classifying. `replacementApproval` defaults to `pending`
so missing data fails safe.

## Non-Goals

- Computing canonical coverage (Phalanx-owned).
- Minting decision IDs (Phalanx-owned).
- Treating Hoplon facts as user authority (only as grounded facts).
- Marking degraded packets ready (degradation path lives in
  spec-studio-degraded.js).
