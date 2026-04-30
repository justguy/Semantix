# Spec Studio Grounded Context Ingestion - Semantix Side

Status: implemented at packages/stx/src/spec-studio-context-ingestion.js
Owner: Semantix integration with Phalanx Spec Studio
Source contract: docs/phalanx-spec-studio-integration-contract.md

## Pipeline

1. Semantix asks Phalanx for context using `planContextRequests` /
   per-purpose helpers from `spec-studio-context-requests.js`.
2. Phalanx brokers the underlying tool calls (Hoplon, repo, upload,
   trace) and returns SemantixContextResponse objects.
3. `ingestContextResponses({ packet, responses, requests, skippedRequests })`
   merges those responses into the candidate packet.

## Mapping

| Response.status | ContextSource.status | groundedFacts |
| --- | --- | --- |
| `ok`            | `used`               | promoted with stable IDs |
| `empty`         | `used`               | none added (Phalanx queried, found nothing) |
| `error`         | `unavailable`        | none added |
| skippedRequests | `skipped`            | none added |

`ContextSource.kind` reflects the actual data source (e.g. `hoplon`,
`repo`, `upload`, `trace`) by reading the originating request's
`requestedFrom`. The Phalanx broker stays in the loop conceptually
even when the kind names a downstream tool.

## Evidence Refs Are Mandatory

Facts without an `evidenceRef` are rejected outright. The
`SemantixContextResponse` validator catches missing/empty refs at the
boundary, so callers receive a `ValidationError` carrying the
`grounded_fact_missing_evidence_ref` code rather than a silently
degraded packet.

## Interpretation Separation

`recordInterpretationsFromFacts` is the only sanctioned way to lift
fact-derived statements into the packet. It writes into
`assumptions`, `risks`, `findings`, `recommendations`, or
`requirements`, never `groundedFacts`. Every entry must carry a
`sourceFactRef` pointing at an existing `groundedFact.id`; the
helper throws `ValidationError` on missing or unknown refs.

This keeps the spec contract honest: groundedFacts hold evidence,
interpretations hold judgment, and the chain back to evidence stays
auditable for Staff after lock.

## Authority Boundary

- Hoplon is context acquisition only. Hoplon facts can ground
  current-system state but cannot become spec authority.
- User approval and the locked artifact remain the authority for
  desired behavior.
- `source` stays `"semantix"` after ingestion; ingest never flips a
  packet to `phalanx-degraded`.
