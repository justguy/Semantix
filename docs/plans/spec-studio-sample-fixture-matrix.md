# Spec Studio Sample Fixture Matrix - Semantix Side

Status: implemented at packages/stx/tests/fixtures/spec-studio-samples.js
       and packages/stx/tests/spec-studio-fixture-matrix.test.js
Owner: Semantix integration with Phalanx Spec Studio
Source contract: docs/phalanx-spec-studio-integration-contract.md

## In-Scope Fixtures

The fixture file ships compact transcriptions of the upstream sample
packets and adds two negative fixtures plus three evaluator-response
fixtures. The matrix test exercises each one against the contract
validator, the readiness classifier, the lockability predicate, the
degraded predicate, and the deep Staff-authority guard.

| Fixture                                  | Source                                                          | Verdict matrix                                                                                  |
| ---                                      | ---                                                             | ---                                                                                             |
| `greenfieldReadyPacket`                  | docs/phalanx-spec-studio-integration-contract.md:716-784        | classifier=ready, contractValid, lockable, not degraded, no staff bleed                         |
| `updateReadyPacket`                      | docs/phalanx-spec-studio-integration-contract.md:791-872        | classifier=ready, contractValid, lockable, not degraded, no staff bleed                         |
| `ambiguousNeedsUserPacket`               | docs/phalanx-spec-studio-integration-contract.md:877-952        | classifier=needs_user, contractValid, not lockable, not degraded, no staff bleed                |
| `replacementBlockedPacket`               | docs/phalanx-spec-studio-integration-contract.md:957-1011       | classifier=needs_user (Semantix-side; Phalanx escalates to blocked given the duplicate signal), contractValid, not lockable |
| `hoplonGroundedPacket`                   | docs/phalanx-spec-studio-integration-contract.md:1015-1094      | classifier=ready, contractValid, lockable, no staff bleed                                       |
| `degradedPacket`                         | docs/phalanx-spec-studio-integration-contract.md:644-705        | classifier=needs_user, contractValid, not lockable, isDegradedPacket=true                       |
| `malformedContextResponseSample`         | negative fixture (status=error without error detail)            | rejected by validateSemantixContextResponse with `missing_error_detail`                          |
| `factWithoutEvidenceContextResponseSample` | negative fixture (fact with no evidenceRef)                   | rejected by validateSemantixContextResponse with `grounded_fact_missing_evidence_ref`            |
| `staffOwnedBleedPacket`                  | negative fixture (Staff-owned keys nested in requirement, finding, nextTurn body) | rejected by deep guard with at least three offenders (implementationPlan, verifyCommand, featurePuzzle) |

The matrix also exercises three `SemantixEvaluateResponse` fixtures
(`initialReady`, `ambiguousFollowUp`, `hoplonGroundedFollowUp`) so the
evaluator seam tests can run without an LLM-backed implementation.

## Out of Scope

- Live Phalanx server flows. The fixtures cover the Semantix side of
  the contract; Phalanx-owned fallback envelopes (`source:
  "phalanx-degraded"`) and lock-ceremony coverage live in the Phalanx
  repo.
- Staff handoff prose. Fixtures stop at the locked alignment packet;
  Staff design docs, feature puzzles, verify commands, implementation
  plans, and file-change instructions are not represented because
  Semantix is not the Staff authority.
- Network or filesystem dependencies. The matrix runs entirely in
  process; no env vars, no live services, no Hoplon broker.

## Compactness

The fixtures hold only the upstream packet bodies plus the small set
of negative fixtures needed for guard coverage. Doc prose is not
copied. New negative shapes should land here rather than expanding
existing fixtures so that the matrix remains a stable review harness
for future Claude/Codex slices.

## Authority

Fixture success is not a substitute for Phalanx lock authority.
Phalanx still recomputes coverage, blockers, and readiness server-side
before minting a SpecArtifact. The matrix proves Semantix-side
behavior; lock ceremony semantics belong to the upstream repo.
