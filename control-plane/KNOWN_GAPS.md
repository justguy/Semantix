# Semantix Control Plane: Known Gaps

This file tracks intentional phase-1 gaps in the current Codex-backed control-plane implementation.

## Multi-Turn Runtime Notes

- Active-turn steering now routes through Semantix first: the control plane freshness-checks the
  current `ReviewArtifact`, verifies the active Semantix and runtime turn identities, and then sends
  Codex `turn/steer` with `expectedTurnId`.
- Paused runtime thread resume now routes through Semantix first: interrupted sessions remain
  Semantix-paused until a fresh `session.resume` request passes artifact, node, and approval checks,
  then the adapter sends Codex `thread/resume`.
- `thread/resume` is not a replacement for Semantix checkpoint resume. Workflow resume still uses
  the persisted `ReviewArtifact`, approval gate, and checkpoint identity as the source of truth.
- The earlier closeout smoke proof showed `thread/resume` does not resolve for a newly created empty
  thread. The implemented path only resumes existing runtime threads that belong to a Semantix
  session.
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
