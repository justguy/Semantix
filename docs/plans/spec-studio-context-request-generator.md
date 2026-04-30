# Spec Studio Context Request Generator - Semantix Side

Status: implemented at packages/stx/src/spec-studio-context-requests.js
Owner: Semantix integration with Phalanx Spec Studio
Source contract: docs/phalanx-spec-studio-integration-contract.md (lines 264-325)

## Authority Boundary

Semantix never queries Hoplon directly. When existing-system facts
materially affect readiness or acceptance clarity, Semantix emits a
SemantixContextRequest and lets Phalanx broker the actual fetch. The
broker may use Hoplon, the repo index, uploaded artifacts, traces, or
other tools - that decision belongs to Phalanx.

This module enforces that boundary on the Semantix side: the package
declares no Hoplon dependency and the source tree imports nothing
matching `hoplon`. Two structural tests guard those invariants.

## Public API

- `createContextRequest({ id, sessionId, iteration, purpose, query, requestedFrom?, constraints?, reason })`
  builds and validates a SemantixContextRequest. Default sources per
  purpose include `phalanx` so the broker stays in the loop.
- Per-purpose helpers wrap `createContextRequest` with sensible
  defaults:
  - `requestIdentifyTargetSurface`
  - `requestSummarizeCurrentBehavior`
  - `requestFindExistingFlow`
  - `requestFindReusableComponent`
  - `requestFindConstraints`
  - `requestCollectHoplonEvidence`
  - `requestInspectReferenceArtifact`
- `createContextRequestSequencer({ sessionId, iteration, prefix, start })`
  mints stable padded ids (`CTX-001`, `CTX-002`, ...) so multiple
  requests within a single Semantix turn don't collide and so the
  stable-id-continuity guard's reissue check stays satisfied.
- `planContextRequests({ packet, sessionId, iteration, sequencer })`
  inspects a candidate packet and emits the minimum set of context
  requests needed to materially affect readiness:
  - mode=unknown -> identify_target_surface
  - mode=update without targetSurfaces -> identify_target_surface
  - mode=update without doNotChange/reuseRequirements/compatibility ->
    summarize_current_behavior + find_reusable_component + find_constraints
  - referenceArtifacts present -> inspect_reference_artifact per artifact
  - everything aligned -> empty array (no superfluous requests)

## Evidence Requirements

Purposes that change the spec without grounded evidence are
particularly risky. The default `mustReturnEvidenceRefs: true` is
applied for `summarize_current_behavior`, `find_reusable_component`,
and `collect_hoplon_evidence`. Callers can opt out by passing an
explicit `false`.

## Non-Goals

- Inventing facts when context is unavailable. Phalanx returns
  `status: "empty"` or `status: "error"` and Semantix records
  contextSources accordingly without minting groundedFacts.
- Issuing redundant context requests. Stable-id continuity rejects
  reissued ids; planContextRequests stays gap-driven.
- Replacing Phalanx as the lock authority.
