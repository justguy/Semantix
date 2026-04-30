# Spec Studio User-Turn Loop - Semantix Side

Status: implemented at packages/stx/src/spec-studio-user-turn-loop.js
Owner: Semantix integration with Phalanx Spec Studio
Source contract: docs/phalanx-spec-studio-integration-contract.md

## Action Surface

- `applyUserChoiceTurn(input)` records a choice answer, resolves the
  linked open question and any unresolved findings ref'd to it.
- `applyUserFreeTurn(input)` records free text and clears readiness so
  the next evaluator pass can interpret the prose.
- `applyReconsiderTurn(input)` marks the prior decision superseded
  (never deleted), appends the new decision with
  `reconsidersDecisionId`, and reopens any findings the prior decision
  had resolved with an audit `reopenReason` plus `reopenedAt`.
- `applySkipTurn(input)` records a `dismiss` decision, removes the
  open question, and raises a `concern`-severity gap finding so the
  skip stays auditable. Existing blocker findings are never silently
  dismissed.
- `applyDecideAllTurn(input)` records `decided-by-semantix` entries
  for every supplied resolution; each entry carries a
  `flagged: [{ reviewer, reason }]` array so the decision is visible
  to a human reviewer before lock.

After every action `readiness` is set back to `needs_user`. The
readiness classifier owns the final assignment on the next evaluator
pass.

## Decision IDs

Phalanx mints canonical audit decision IDs. Semantix uses a
`sem_dec_*` prefix when the caller does not supply an explicit
`decisionId`, and the convention signals to Phalanx that the id is
provisional and must be replaced by a canonical one.
`decided-by-semantix` decisions specifically carry a flagged entry so
they cannot be confused with user-attested audit IDs.

## Continuity

Reconsider intentionally reopens findings; the stable-id continuity
guard now recognizes a non-empty `reopenReason` on a finding as the
required audit reason and does not flag the regression. Reopening a
finding without setting `reopenReason` still trips the guard, so the
audit trail stays mandatory.

## Persistence

This module never writes to disk and never calls Phalanx. Phalanx
remains the persistence authority and stores the append-only audit
trail of decisions, turns, and findings. The Semantix helpers only
mutate plain in-memory packets.
