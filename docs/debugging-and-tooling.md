# Semantix Debugging and Tooling

## Purpose

Semantix programs mix deterministic execution with probabilistic generation. That changes
the debugging model, the test model, and the developer experience.

This document outlines a first-pass vision for how Semantix tooling should work when the
language runtime is effectively coordinating a traditional execution engine with a neural
engine.

It focuses on four ideas:

- reproducible semantic execution
- time-travel debugging over semantic steps
- fuzzy but grounded testing
- adversarial semantic fuzzing

## Design Goals

Semantix tooling should optimize for:

1. Reproducibility
   A developer must be able to replay a failing semantic step without re-running the whole
   program.
2. Inspectability
   Generated outputs, prompts, retrieved context, verifier decisions, and retry reasons must
   be visible.
3. Grounding
   When a value is produced from evidence, the tooling should make that evidence legible.
4. Bounded cost
   Debugging and testing workflows should reuse cached generations and trace artifacts rather
   than forcing full re-execution.
5. Clear failure modes
   A failed program should tell the developer whether the problem was logic, retrieval,
   generation, verification, budget exhaustion, or tool failure.

## Core Principle: Record/Replay Over Naive Determinism

`--deterministic` is useful, but temperature=0 alone is not enough for true reproducibility.
Semantix should treat deterministic execution as a record/replay feature.

When a developer runs:

```bash
semantix run --trace
semantix test --deterministic
```

the runtime should capture a trace artifact containing:

- model identifier and version
- seed and sampling parameters
- compiled prompt template
- concrete prompt inputs
- active context slices
- retrieved documents and evidence spans
- tool call inputs and outputs
- verifier and constraint results
- refine loop retries and failure reasons
- token, latency, and cost metrics

This trace should be sufficient to replay a semantic step without depending on live model
variability or upstream tool drift.

### Proposed Behavior

- `--deterministic` locks seed and sampling settings for the session.
- `--trace` emits a structured execution artifact, for example `run.smxtrace`.
- `semantix replay run.smxtrace` replays the recorded execution.
- `semantix replay run.smxtrace --from step_12` resumes from a specific semantic step using
  cached upstream state.

## Semantic Execution Tree

Traditional debuggers expose stack frames and variable state. Semantix needs a semantic
execution tree.

Each semantic operation becomes a node in the trace:

- `context.enter`
- `context.exit`
- `retrieve`
- `tool_call`
- `generate`
- `verify`
- `refine`
- `fallback`

Each node should capture:

- inputs
- outputs
- referenced evidence
- elapsed time
- retry count
- budget usage
- parent and child edges

This tree becomes the foundation for debugging, replay, profiling, and test diagnostics.

## Time-Travel Debugging

Because semantic generation is slower and more expensive than ordinary code execution,
Semantix should support checkpointed debugging.

### Developer Workflow

1. Run a program under the debugger.
2. Inspect the semantic execution tree when execution pauses or fails.
3. Select a node, such as a `generate` or `verify` step.
4. Edit the prompt, constraint, or runtime setting.
5. Resume from that node using cached upstream context.

### IDE Requirements

A Semantix IDE extension should provide:

- a visual execution tree
- step-level replay and resume
- prompt and constraint diffing
- cached input and output inspection
- retry history for refine loops
- provenance inspection for grounded claims
- token, latency, and cost overlays
- semantic confidence heatmaps over nodes and generated values

The IDE should also be treated as a co-compiler, not just a debugger. Over time it should help
humans:

- expand high-level intent into stricter constraint machinery
- visualize context scopes and tool blast radius spatially
- render planned side effects as human-readable state diffs before execution
- render execution plans as challengeable node graphs instead of only text traces
- expose where the system is grounded, inferred, or weakly justified before execution
- critique outputs and refine semantic rules without hand-authoring every low-level validator

### Confidence Signals

The semantic confidence heatmap should be computed from runtime signals the model cannot simply
self-report away.

Useful inputs include:

- token logprobs or related uncertainty measures
- constraint friction, such as how many internal refine attempts were needed
- provenance strength, such as exact source grounding vs synthesized output
- adversarial critique scores from a secondary verifier or judge pass

The goal is not to ask the model "are you confident?" The goal is to derive confidence from the
execution evidence itself.

## Testing Model

Semantix tests cannot rely on exact-string assertions alone. The language should support a
mixed testing model with both hard and semantic assertions.

### Assertion Classes

- `assert_eq`
  For deterministic values and exact outputs.
- `assert_schema`
  For structural guarantees such as JSON shape or type constraints.
- `assert_semantic`
  For intent, tone, coverage, and meaning.
- `assert_grounded`
  For claim-to-evidence linkage.
- `assert_budget`
  For retry counts, latency ceilings, or token budgets.

### Example

```rust
test "Angry Customer Routing" {
    string mock_input = "You guys charged me twice! I want my money back NOW!";
    string result = HandleEmail(mock_input);

    assert_semantic(result, "Acknowledges the double charge");
    assert_semantic(result, "Maintains a calm, apologetic tone");
    assert_grounded(result, "Offers a refund");
}
```

### Judge Model Strategy

Semantic assertions may use a smaller judge model, but the framework should not rely on a
judge alone. Tests should combine:

- hard checks for schemas and forbidden behavior
- grounding checks against source evidence
- semantic checks for tone and coverage

This reduces the risk of a judge model approving an ungrounded or subtly wrong answer.

## Adversarial Semantic Fuzzing

Traditional fuzzing throws malformed input at parsers and APIs. Semantix also needs to test
probabilistic failure modes.

### Goals

- trigger hallucinations
- provoke prompt injection failures
- test constraint bypasses
- surface brittle retrieval behavior
- reveal unsafe fallback paths

### Fuzz Dimensions

- adversarial personas
- ambiguous source documents
- conflicting evidence
- poisoned context
- malformed or partial tool outputs
- latency spikes and tool timeouts
- low-budget execution paths
- model downgrade scenarios

### Proposed Command

```bash
semantix fuzz tests/customer_support.smx
```

The fuzz runner should output:

- failing seeds or replay handles
- the exact node where the program broke
- the violated constraint or verifier
- the minimal prompt or context change that triggered the failure

## Provenance and Grounding

Semantix debugging will be much more usable if generated values carry provenance metadata.

A generated value should optionally include:

- source document ids
- evidence spans
- tool outputs referenced
- verifier decisions
- confidence or match scores

This metadata does not need to appear in normal program output, but it should be available to
the debugger, test runner, and trace viewer.

## Suggested CLI Surface

An initial Semantix CLI could include:

```bash
semantix run file.smx --trace
semantix run file.smx --trace --deterministic
semantix replay run.smxtrace
semantix replay run.smxtrace --from step_12
semantix test
semantix test --deterministic
semantix fuzz tests/
```

## Runtime Requirements

To support this tooling, the runtime will need:

- a durable trace format
- checkpoint and cache support for semantic nodes
- stable node ids across runs
- provenance-aware value representations
- deterministic adapter hooks for tools and retrieval
- budget accounting for tokens, latency, and retries

## Open Questions

The following pieces need sharper specification:

- What counts as `factual` for `assert_grounded` and `verify` when evidence is incomplete?
- How should traces handle sensitive prompts, documents, or tool outputs?
- When should replay use cached outputs vs re-run a step against a live model?
- How should judge-model disagreement be represented in test results?
- What is the minimum viable trace schema for a first prototype?
- Which failures are recoverable through `refine`, and which should hard-fail immediately?

## Near-Term Next Steps

1. Define the `smxtrace` file format and semantic node schema.
2. Define a minimal set of traceable runtime operations: `context`, `generate`, `verify`,
   `refine`, and `tool_call`.
3. Sketch the test DSL for exact, semantic, and grounding assertions.
4. Build a minimal CLI prototype for `run --trace` and `replay`.
5. Decide how provenance metadata is represented in runtime values.
