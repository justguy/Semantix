# Semantix

Semantix stops treating prompts as specs and stops using humans as glue
between chat, evidence, and planning. It begins with human intent, but it
does not hand raw chat downstream. It produces a deterministic,
evidence-backed handoff contract, then hands off to the systems that own
the rest of the SDLC.

## Run Locally

Use the root dev script to build the browser UI bundle and start the local
Semantix server:

```bash
npm run dev
```

The server listens on `127.0.0.1:4401` by default. Open:

```text
http://127.0.0.1:4401/
```

Pass server options after `--` when you need a different host or port:

```bash
npm run dev -- --host 127.0.0.1 --port 4555
```

The dev script runs `npm run build:ui` before starting `node ./stx serve`.
There is no separate server compile step; the server runs directly from the
Node ESM sources. The current `@semantix/stx` UI bundle includes its React
runtime locally, so this path works offline when dependencies are already
installed.

## Design Principles

1. A prompt is not a spec.
   Semantix may begin with a prompt, but downstream planning must receive
   only a locked, typed, evidence-backed handoff.

2. The handoff is the delegation contract.
   Bad downstream AI output is often caused by unclear delegation, so the
   handoff must preserve requirements, acceptance criteria, boundaries,
   provenance, capability scopes, and verification obligations.

3. Human intent must be locked before machine planning.
   The host and user own lock authority. Semantix readiness is advisory.
   A ready packet is not a locked spec.

4. Semantix solves the handoff problem, not the whole SDLC.
   Semantix does not produce architecture, task graphs, implementation
   plans, verification-command choices, execution dispatch, or final
   approval.

5. Agents act only after deterministic contracts.
   Probabilistic clarification may occur before lock. Deterministic
   guarantees begin at a locked packet plus compiler profile.

## Spec Studio Planning Handoff

Spec Studio can use an LLM before lock to clarify fuzzy intent, ask
questions, normalize answers, and produce a candidate alignment packet.
After lock, the planning handoff must be a pure compiler step:

```text
LockedIntentArtifact + SemantixAlignmentPacket + audit state
  -> LockedSpecPlanningHandoff
```

The handoff builder must not ask questions, call an LLM, invent
architecture, infer product intent, or produce implementation tasks. It
must fail closed when the locked inputs are not safe to delegate.

## Phase 2 Handoff Verticals

Phase 2 is organized as end-to-end verticals rather than implementation
layers. Each milestone must produce a demonstrable handoff behavior that
crosses contract shape, deterministic mapping, validation, fixtures,
tests, and documentation.

| Vertical | Demonstrable Value | Reasoning |
| --- | --- | --- |
| Greenfield lock-to-handoff | A vague greenfield request can become a locked packet and compile into a canonical handoff with stable IDs, input hashes, handoff ID, fingerprint, and planner-visible requirements. | This proves the core promise: prompts do not flow into planning; locked typed facts do. |
| Update safety | An update-mode packet carries target surfaces, do-not-change or compatibility boundaries, negative requirements, and verification obligations. Unsafe update packets fail closed. | Update work is where prompt-as-spec failure is most expensive; the handoff must make boundaries explicit before planning. |
| Fail-closed authority | Non-ready, degraded, unresolved-blocker, unauthorized, unclassified, missing-evidence, unused-evidence, and sensitive-persistence cases reject with stable errors. | The builder is a circuit breaker. It has no product authority, but it must prevent unsafe delegation. |
| Freshness resume | A locked handoff plus host observations deterministically classifies clean, soft-stale, and hard-stale resume states. | Planning cannot safely resume from stale evidence unless the stale state is explicit and auditable. |
| Planner-ready proof | A fixture shows a handoff carrying requirements, acceptance, boundaries, provenance, capability scopes, semantic obligations, verification obligations, and planner seeds without mutable chat state. | This demonstrates that downstream systems get a delegation contract, not a transcript and a hope. |
| Readiness closeout | Focused and package-level tests pass, fixture fingerprints are pinned, import guards prove no LLM or IO dependency enters the builder, and host-owned follow-up work is explicit. | The milestone is complete only when the deterministic boundary can be replayed and maintained. |

The goal is not to build a schema layer, then a validator layer, then a
mapper layer, then a proof layer. The goal is to land narrow slices that
prove usable delegation at every step.

## Current Source Documents

- [Spec Studio deterministic planning handoff](docs/plans/spec-studio-deterministic-planning-handoff.md)
- [Semantix overview](docs/semantix-overview.md)
- [Semantix whitepaper](docs/semantix-whitepaper.md)
- [Deterministic core and runtime boundary](docs/deterministic-core-and-runtime-boundary.md)
