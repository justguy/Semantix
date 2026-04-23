# Semantix Control Plane: Known Gaps

This file tracks intentional phase-1 gaps in the current Codex-backed control-plane implementation.

## Multi-Turn Runtime Gaps

- Session resume is currently modeled as `turn/interrupt` followed by a fresh next turn. The
  control plane does not yet use Codex `thread/resume` or `turn/steer`.
- Authority remains the Semantix `ReviewArtifact` and control-plane state. Codex transcript history
  is runtime context, not the authoritative source of review or execution truth.
- The Codex `app-server` surface is still experimental. The current implementation is effectively
  pinned to the locally validated Codex CLI version `0.122.0`.

## Browser Host And Preview Gaps

- `previewRef` now resolves through a separate control-plane lookup, but full unified diff bodies
  are still only end-to-end real when the runtime returns explicit preview or diff text. When the
  runtime does not supply that content, the resolver falls back to synthesized readable preview
  text derived from `StateEffect` metadata rather than true file-hunk output.
- The bundled browser host path is covered by HTTP tests, but fixed-port live `stx serve`
  verification was not completed in the current sandbox because local socket binding returned
  `EPERM`. This should still be rechecked in a non-sandboxed local environment.

## Operational Implication

Any upgrade of the installed Codex CLI should revalidate the `app-server` thread and turn protocol
before treating the connector as production-stable.
