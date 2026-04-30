# Spec Studio Authority Boundary - Semantix Side

Status: enforced via packages/stx/src/spec-studio-no-staff-authority.js
Owner: Semantix integration with Phalanx Spec Studio
Source contract: docs/phalanx-spec-studio-integration-contract.md

## Boundary

Semantix aligns the user's intent. It clarifies the directive, normalizes
requirements, classifies readiness, and emits an alignment packet plus
optional context requests. It does not own:

- design docs or design documents
- feature puzzles
- verify commands
- implementation plans
- file-change instructions or file-change authority
- Staff plans, architecture docs, decomposition plans, execution plans

Those artifacts are produced by Phalanx Staff after lock, from the
immutable locked artifact, and only after explicit user approval.

## Enforcement

`spec-studio-no-staff-authority.js` provides a deep-walking guard that
flags any path inside an alignment packet (or evaluate response) where a
Staff-owned key appears. Guard rules:

- Top-level Staff fields are blocked through the existing
  `STAFF_OWNED_FIELDS` list, now sourced from the same module so the
  packet validator and the deep guard share one source of truth.
- Nested Staff keys anywhere in the packet (requirements,
  requirement extras, findings, context sources, grounded facts,
  nextTurn.body, options, offers, payloads, etc.) are blocked through
  case-insensitive key-fragment matching.
- Mixed-case and snake_case variants are matched
  (`verify_command`, `File_Change_Instructions`, `feature_puzzles`,
  etc.).
- Free-text Semantix prose (`text`, `summary`, `rationale`,
  `readinessReason`, `acceptance`, etc.) may legitimately mention these
  concepts and is allowed; only structured keys carrying authority
  trigger a violation.

The packet validator (`validateSemantixAlignmentPacket`) delegates the
Staff-owned check to `findStaffAuthorityBleed`, so any caller that
validates the packet automatically gets nested-bleed protection.

## Caller integration

Production paths that emit a packet should use one of:

- `validateSemantixAlignmentPacket(packet)` - returns `{ ok, errors }`,
  errors carry `code: "staff_owned_field_present"` for Staff-owned
  bleed.
- `assertNoStaffAuthorityBleed(packet)` - throws `ValidationError` with
  `details.violations` listing every bleed path.
- `findStaffAuthorityBleed(value)` - returns the violation list without
  throwing, useful for telemetry or partial-recovery paths.

The Spec Studio evaluator response validator implicitly invokes the
packet validator on every response packet, so any Staff-owned bleed
from a stub or LLM-backed implementation is rejected before the
response leaves the seam.

## Degraded packet boundary

If Semantix is fully unreachable, Phalanx must produce the visible
degraded envelope (`source: "phalanx-degraded"`). Semantix-degraded
packets remain `source: "semantix"` with `readiness: "needs_user"` and
must not carry Staff-owned content; the deep guard covers that case
too.
