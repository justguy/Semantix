# Semantix Control Plane: Known Gaps

This file tracks intentional phase-1 gaps in the current Codex-backed control-plane implementation.

## Multi-Turn Runtime Gaps

- Session resume is currently modeled as `turn/interrupt` followed by a fresh next turn. The
  control plane does not yet use Codex `thread/resume` or `turn/steer`.
- Revalidation against `codex-cli 0.130.0` confirmed that `turn/steer` accepts
  `expectedTurnId`, but integrated steering semantics are not settled yet. `thread/resume` did not
  resolve for a newly created, empty thread in the closeout smoke proof.
- Authority remains the Semantix `ReviewArtifact` and control-plane state. Codex transcript history
  is runtime context, not the authoritative source of review or execution truth.
- The Codex `app-server` surface is still experimental. The current implementation is effectively
  pinned to the locally validated Codex CLI version `0.130.0`.
- `thread/read` works for thread metadata before the first materialized user message when
  `includeTurns` is false. `includeTurns: true` and `thread/turns/list` are unavailable until the
  thread is materialized; `thread/turns/list` also requires the JSON-RPC `experimentalApi`
  capability at initialize time.

## Browser Host And Preview Notes

- `previewRef` resolution now exposes preview fidelity fields: `source`, `sourceLabel`, `fidelity`,
  and `contentIsSynthetic`. Runtime diff bodies are labeled `runtime_diff`; synthesized
  `StateEffect` summaries are labeled `metadata_only` and shown as metadata-only previews in the UI
  and CLI instead of implied unified diffs.
- Live `stx serve` browser-host verification succeeded outside the socket-restricted sandbox on
  2026-05-12. The proof covered `/`, `/health`, the `/chat` legacy redirect, a previewRef lookup,
  and the SSE event route. The sandboxed bind still returned `EPERM`, so live host verification
  should be run from a normal local shell or approved loopback context.

## Operational Implication

Any upgrade of the installed Codex CLI should revalidate the `app-server` thread and turn protocol
before treating the connector as production-stable.
