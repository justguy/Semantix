# Spec Studio Degraded Behavior - Semantix Side

Status: enforced via packages/stx/src/spec-studio-degraded.js
Owner: Semantix integration with Phalanx Spec Studio
Source contract: docs/phalanx-spec-studio-integration-contract.md (lines 630-705)

## Authority Split

Two distinct degradation paths exist; they are intentionally owned by
different sides of the integration.

### Semantix-side: partially available

When Semantix can produce a packet but the alignment review is
incomplete (model timeout, malformed model output, missing prior state,
partial service failure), Semantix emits a packet that:

- keeps `source: "semantix"`
- sets `readiness: "needs_user"`
- carries at least one blocker finding explaining the degradation
- sets `coverage.alignmentPct` to `0` unless a prior packet is
  explicitly marked stale-safe by the caller
- introduces no new ungrounded requirement facts; with `staleSafe: true`
  the prior packet's requirements / scope / flow / coverage carry
  forward, otherwise those collections stay empty
- sets `nextTurn` to `null` (or to a clarifying turn explaining the
  degradation)

`createDegradedPacket()` mints these packets; `withDegradationFallback()`
wraps an evaluator implementation so any thrown error or malformed
response degrades to this shape automatically.

### Phalanx-side: fully unreachable

If Semantix is fully unreachable, Phalanx must build its own degraded
envelope with `source: "phalanx-degraded"`. This module never mints
that envelope on behalf of Phalanx; the Semantix adapter only emits
`source: "semantix"`.

## Lockability Predicate

`isPacketLockable(packet)` mirrors Phalanx's lock criteria so callers
can short-circuit UI affordances and tests can prove that degraded
packets stay non-lockable:

- `source` must be `semantix`
- `readiness` must be `ready`
- `coverage.alignmentPct` must be `100`
- `coverage.openBlockers` must be `0`
- no unresolved blocker findings

Phalanx remains the authoritative lock authority. Semantix readiness is
advisory; this predicate exists so Semantix-side adapters and tests can
match Phalanx's contract before a packet leaves the seam.

## Non-Goals

- Mutating Phalanx run behavior or starting any Phalanx-owned code
  paths.
- Inventing requirement facts during degradation. Without a prior
  packet plus `staleSafe`, the requirements list is empty.
- Bypassing the Staff-authority guard. Degraded packets still pass
  through the deep guard; degradation never permits Staff-owned
  content.
