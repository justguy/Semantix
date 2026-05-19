# Spec Studio Documentation Grill Loop

Status: proposed
Owner: Semantix integration with Phalanx Spec Studio
Related contract: docs/phalanx-spec-studio-integration-contract.md
Reference pattern: https://github.com/mattpocock/skills/tree/main/skills/engineering/grill-with-docs

## Purpose

The referenced skill is useful because it keeps a planning conversation
honest against existing project language and decisions. It asks one
sharp question at a time, checks the codebase when the answer can be
found there, resolves terminology conflicts, and records durable project
knowledge as it emerges.

Semantix should preserve that behavior, but make it structured enough
for Phalanx. The output should not be an ad hoc chat transcript or a
direct write to project docs during discussion. It should be a typed
Spec Studio alignment flow that can be locked, audited, and handed to
Phalanx Staff.

## Mapping

| Grill behavior | Semantix / Phalanx shape |
| --- | --- |
| Challenge a plan against existing docs and code | Semantix emits findings, open questions, and context requests; Phalanx brokers repo, Hoplon, upload, and trace context. |
| Ask one question at a time | Semantix uses `nextTurn` for the highest-leverage unresolved blocker before lock. |
| Recommend an answer with each question | Semantix includes options, a recommended path, and rationale in the turn body or associated finding. |
| Resolve fuzzy language | Semantix records canonical wording in requirements, flow facts, assumptions, and user decisions. |
| Flag terminology conflicts | Semantix raises blocker or concern findings when user language conflicts with grounded facts or prior locked decisions. |
| Update project context docs | Phalanx persists approved language after lock from the `SpecArtifact`, not from mutable chat state. |
| Offer ADRs only for meaningful decisions | Semantix proposes decision candidates only when the choice is hard to reverse, non-obvious, and trade-off driven; Phalanx owns canonical decision IDs and persistence. |

## Semantix Behavior

During Spec Studio evaluation, Semantix should treat terminology as
part of alignment, not as prose polish. When the user says a loaded term
such as "account", "project", "agent", "surface", "lock", or
"runtime", Semantix should determine whether the term is already
defined by the current packet, grounded facts, prior decisions, or
Phalanx-provided project context.

If the term is ambiguous, Semantix should ask for clarification before
lock. If the codebase or existing docs can answer the question,
Semantix should request context through `SemantixContextRequest` instead
of asking the user to restate information the system can retrieve.

Resolved terminology should flow into existing packet fields first:

- `requirements` for desired behavior and boundaries
- `flow` for pages, states, transitions, and data dependencies
- `inScope` and `outOfScope` for scope language
- `assumptions` for unresolved but explicit interpretation
- `userDecisions` for user-confirmed choices
- `findings` for conflicts, gaps, and contradictions
- `groundedFacts` for evidence-backed current-system facts only

If those fields become insufficient, Semantix can add a future
`languageResolutions` extension, but the first implementation should
avoid a new schema until there is real pressure from Phalanx.

## Persistence Boundary

The lightweight skill updates `CONTEXT.md` and ADR files inline. That
works for a local skill session, but it is too loose for Semantix.

Semantix should not mutate repository documentation during an unlocked
Spec Studio discussion. It should instead produce structured candidate
language and decision records. After the user locks the spec, Phalanx
can persist approved knowledge into whatever project system is
canonical:

- a Phalanx decision log
- project glossary or context documents
- ADR files
- Staff handoff artifacts
- review/audit records

This keeps the authority chain clear: mutable discussion informs the
packet, the user locks the artifact, and only locked artifacts become
durable project truth.

## Decision Candidate Rule

Semantix should only propose a durable decision record when all of the
following are true:

- The decision is expensive or risky to reverse later.
- The choice would surprise a future engineer without context.
- There were credible alternatives and the selected option reflects a
  real trade-off.

Otherwise, the information belongs in normal requirement, scope,
assumption, or finding fields.

## Acceptance Criteria

- A Spec Studio turn can flag an ambiguous domain term and ask one
  targeted clarification question.
- If the answer can be discovered from repo or Hoplon context, Semantix
  emits a context request instead of asking the user first.
- Resolved terminology is reflected in typed packet fields before lock.
- Proposed durable decisions remain separate from Phalanx-owned
  canonical decision IDs.
- No repository documentation is written by Semantix before the spec is
  locked.
