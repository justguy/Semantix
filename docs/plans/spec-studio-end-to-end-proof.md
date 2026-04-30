# Spec Studio Semantix-Side End-to-End Proof

Status: implemented at packages/stx/tests/spec-studio-end-to-end-proof.test.js
Owner: Semantix integration with Phalanx Spec Studio
Source contract: docs/phalanx-spec-studio-integration-contract.md

## What This Proves

The proof file wires every Semantix-side module through one focused
conversation flow per scenario and asserts the contract invariants on
every resulting packet:

| Flow                                 | Wires                                                                                                                                       |
| ---                                  | ---                                                                                                                                         |
| Flow 1 - greenfield ready            | handshake adapter -> evaluator -> contract validator -> readiness classifier -> lockability                                                 |
| Flow 2 - update ready                | handshake adapter -> evaluator -> contract validator -> readiness classifier -> lockability (verifies targetSurfaces + reuse boundary)      |
| Flow 3 - ambiguous needs_user        | handshake adapter -> evaluator -> contract validator -> readiness classifier -> planContextRequests (identify_target_surface)               |
| Flow 4 - replacement blocked         | candidate packet w/ replacementDetected + REPLACEMENT_APPROVAL.ABSENT -> evaluator -> readiness classifier -> blocked                       |
| Flow 5 - degraded                    | handshake adapter wrapping a throwing evaluator -> withDegradationFallback -> degraded packet -> isDegradedPacket / isPacketLockable=false  |
| Flow 6 - Hoplon-grounded ingestion   | createContextRequestSequencer -> requestIdentifyTargetSurface -> ingestContextResponses -> recordInterpretationsFromFacts                   |
| Flow 7 - reconsider / supersede      | applyUserChoiceTurn -> applyReconsiderTurn -> checkIdContinuity (reopen with reopenReason allowed)                                          |
| Flow 8 - skipped gap                 | applySkipTurn against an unresolved blocker (skip never silently dismisses, raises concern only when no blocker exists)                     |

Each test runs both packet-shape invariants (`assertCommonInvariants`)
and a flow-specific assertion. `assertCommonInvariants` checks:

- the packet passes `validateSemantixAlignmentPacket`
- the packet passes `validateNoStaffAuthorityBleed` at every depth

## Cross-Flow Regression

`cross-flow regression: every fixture stays contract-valid, free of
Staff bleed, and consistent with classifier` exercises every upstream
sample fixture through the contract validator, the deep Staff-authority
guard, and the readiness classifier in one pass.

## Out of Scope

The proof is intentionally Semantix-only. The following lives in
Phalanx and is asserted only at the boundary:

- Spec Studio UI shell, persistence, and append-only audit storage
- Mutable Spec Studio session routes
- Lock ceremony and immutable `SpecArtifact` storage
- Coverage template ownership and canonical coverage computation
- Canonical decision audit IDs
- Drift detection against the locked artifact
- Run creation from the locked artifact

The handshake describe surface confirms these authority boundaries
explicitly:

```
capabilities.lockAuthority      === "phalanx"
capabilities.coverageAuthority  === "phalanx"
capabilities.decisionIdAuthority === "phalanx"
```

## Test Commands

```
node --test packages/stx/tests/spec-studio-end-to-end-proof.test.js
npm test
```

## Latest Results

`npm test` (full repository, no live services):

```
@semantix/stx        : 333 tests, 333 pass, 0 fail
@semantix/control-plane : 27 tests, 27 pass, 0 fail
```

## Proof Status

The Semantix side of the Spec Studio integration contract is now
fully proven by the matrix above. The Phalanx side (lock ceremony,
immutable artifact storage, append-only session routes, Staff handoff,
drift detection) remains the responsibility of the Phalanx repo and
its parallel task track.
