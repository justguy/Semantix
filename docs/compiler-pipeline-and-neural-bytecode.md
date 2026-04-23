# Semantix Compiler Pipeline and Neural Bytecode

## Purpose

Semantix cannot use a traditional compiler model where source code is translated straight into
ordinary machine instructions and the hard part ends there.

A Semantix compiler has a more ambitious job. It must not only compile deterministic logic, but
also pre-build the execution boundaries for probabilistic computation.

In effect, the compiler becomes part of the management system. It performs much of the planning,
constraint compilation, tool binding, and boundary enforcement that today is often implemented
outside the language in orchestrators, wrappers, and retry loops.

## Core Thesis

A traditional compiler translates procedures into instructions.

A Semantix compiler must translate procedures and policies into a hybrid executable that can be
run by a Semantic Virtual Machine.

That means the compiler is responsible for preparing two different worlds:

- deterministic control flow for the logic unit
- bounded semantic operations for the neural unit

The goal is not to make the neural unit deterministic. The goal is to make the execution
environment around it deterministic, typed, and enforceable before the program ever runs.

This is why Semantix exists at all.

You cannot out-prompt a probabilistic model forever. You can only out-structure it.

The compiler is the place where weighted prompt advice gets turned into executable boundaries.

## From Source File To Managed Execution

Given a `.smx` source file, the compiler should move through a staged pipeline that transforms
language-level semantic constructs into executable boundaries.

At a high level, that pipeline looks like:

1. lexical and syntactic analysis
2. deterministic vs semantic split
3. constraint and policy compilation
4. native tool binding
5. semantic routing optimization
6. `.nbc` emission

## Phase 1: Lexical Splitter

The first important compiler move is not just parsing. It is separation.

Semantix source mixes:

- ordinary variables
- control flow
- math
- structured data
- semantic operators
- context scopes
- constraints
- concept definitions

The compiler should parse this source into an initial AST, then aggressively classify nodes by
execution domain.

### Two Execution Trees

The compiler should split the program into two main execution views:

- Deterministic tree
  Variables, arithmetic, conditionals, loops, function calls, I/O, and state transitions that
  belong to the logic unit.
- Semantic tree
  `context`, `constraint`, `concept`, `~>`, `~==`, `extract<T>`, and refinement operations that
  belong to the neural execution layer.

This does not have to mean literally two unrelated AST objects forever. Internally, the
compiler may lower to one typed IR with domain-specific nodes. What matters is that the
boundary is explicit and enforced early.

### Firewall Enforcement

This is where the compiler should reject illegal cross-boundary behavior.

For example, the compiler should not allow semantic generation to directly mutate protected
deterministic state.

Illustrative invalid shape:

```rust
user.password ~> "Generate a new password";
```

The compiler should fail with a boundary violation because a semantic operator is attempting to
write directly into security-sensitive deterministic state.

This is the first place where Semantix behaves less like a permissive scripting language and
more like a guarded execution planner.

## Phase 2: Constraint Engine

Once semantic constructs are isolated, the compiler should translate every `constraint` block
into executable guardrails.

For example:

```rust
constraint FileOperation {
    format: JSON,
    forbidden_paths: ["/system", "/root"]
}
```

The compiler should not preserve this as decorative prompt text. It should lower it into
deterministic validation artifacts such as:

- output schemas
- structural validators
- path policies
- exact allow/deny checks
- approval-required checks
- retry instructions for recovery

### Compiled Constraints

Depending on the target, a constraint may become:

- a JSON schema
- a parser contract
- a regex or structured matcher
- an allowlist or denylist
- a policy decision table
- a typed verifier function
- a constrained decoding policy

The key idea is that constraints are compiled into machinery, not merely remembered as advice.

### Why This Matters

This is where Semantix starts eliminating the apology loop at the runtime level.

If the generated output violates a compiled constraint, the runtime does not need to expose the
failure as conversational text. It can reject the candidate internally, attach a deterministic
error code, and retry or fail according to the compiled policy.

This is the shift from pleading to parsing.

Instead of telling the model "please follow this rule carefully," the compiler prepares the
runtime to reject outputs that do not satisfy the rule mechanically.

For sensitive capabilities, the compiler should also be able to emit policy-mode transitions so
the runtime knows when to:

- keep retrying inside the semantic frame
- trip a circuit breaker on `PolicyViolation`
- suspend execution and enter deterministic approval flow on `ApprovalRequired`

## Phase 3: Native Tool Binding

If a semantic step needs access to system capabilities, the compiler should prepare that access
ahead of time.

Today, this often happens in external orchestrators that manually describe tools to the model.
Semantix should move much of that work into the compiler.

### Compiler Responsibilities

For each semantic region, the compiler should determine:

- which tools are visible
- which functions are callable
- which parameter types are allowed
- which side effects are forbidden
- which capabilities require deterministic approval

The compiler can then emit a localized tool contract for that semantic region.

### Result

Instead of the neural unit receiving an open-ended environment, it receives a narrow,
context-specific capability surface prepared by the compiler.

This is essentially native tool binding:

- typed signatures
- bounded scope
- explicit permissions
- deterministic call validation

In other words, the compiler is pre-building the sandbox.

## Phase 4: Semantic Routing Optimization

Not every semantic operation should require a full language-model round trip at runtime.

Where possible, the compiler should precompute artifacts that make semantic routing cheaper and
more deterministic.

### Example: Precomputed Embeddings

For a predicate like:

```rust
if user_input ~== "billing issue" {
    route_to_billing();
}
```

the compiler may precompute the embedding for the target phrase or concept and bake that into
the compiled artifact.

At runtime, the system then only needs to:

1. embed the incoming value
2. compute cosine similarity
3. compare the score against a deterministic threshold

This lowers many semantic routing tasks into a fast numeric operation plus a hard decision gate.

### Important Caveat

This should be treated as an optimization path, not as the only possible implementation.

Some predicates will require richer runtime scoring or model-assisted interpretation. But the
compiler should exploit precomputation wherever the semantic target is static and stable enough
to compile ahead of time.

## Phase 5: Neural Bytecode Emission

After deterministic logic, constraints, tool contracts, and semantic routing artifacts have
been prepared, the compiler should emit a single executable format for the Semantic Virtual
Machine.

This can be thought of as Neural Bytecode, or `.nbc`.

### What `.nbc` Contains

A compiled `.nbc` artifact may include:

- deterministic instructions for the logic unit
- typed IR for semantic operations
- compiled constraint artifacts
- localized tool definitions and capability metadata
- policy decision tables and circuit-breaker metadata
- precomputed embeddings or concept descriptors
- state-machine metadata for allowed transitions
- retry and recovery policies
- audit and provenance hooks for security-sensitive events
- source maps for debugging and replay

The point is not that the file contains raw model behavior. The point is that it contains the
execution choreography for a runtime that coordinates deterministic and probabilistic work.

## The Compiler As Built-In Orchestrator

This is the major conceptual shift.

In conventional agent stacks, a large amount of engineering effort goes into building:

- prompt wrappers
- tool docs
- retry loops
- validators
- critique passes
- state guards
- context reset logic

Semantix aims to absorb much of that labor into the compile pipeline and runtime contract.

That does not mean the compiler becomes magically intelligent. It means the compiler becomes the
place where execution boundaries are formalized.

Instead of writing an external management layer every time, the developer writes Semantix code
and the compiler emits a managed execution environment.

This also cures the classic prompt whack-a-mole problem.

In prompt-centric systems, every newly discovered loophole tends to produce another sentence in
the master prompt.

In a compiler-driven system, every newly discovered loophole should strengthen a compiled
boundary:

- a stricter schema
- a stronger validator
- a new deny rule
- a new approval gate

That lowers cognitive load over time instead of increasing it.

## Why This Changes The Developer Experience

Once this architecture exists, developers no longer need to spend most of their effort on
teaching or pleading with the model to behave.

They can instead focus on:

- state transitions
- allowed capabilities
- validation contracts
- semantic subproblems
- workflow structure

The compiler handles much of the repetitive containment work that today lives in custom
orchestration code.

## Relationship To Other Semantix Docs

This document sits between the existing runtime and orchestration notes:

- the fundamentals doc explains the surface language model
- the deterministic runtime doc explains the logic-unit and neural-unit boundary
- the orchestration doc explains why external manager layers exist today
- the failure-recovery doc explains what happens when semantic steps go wrong
- this compiler doc explains how much of that discipline could be prepared ahead of runtime

## Open Questions

Several parts of the compiler design still need formal specification:

- What should the primary IR look like after deterministic and semantic splitting?
- Which constraint forms are fully compilable and which remain partly runtime-managed?
- How should constrained decoding be represented in the compiled artifact?
- Which semantic predicates qualify for embedding precomputation?
- How should tool visibility be scoped per semantic block?
- What exactly belongs in `.nbc` versus being loaded dynamically at runtime?

## Near-Term Next Steps

1. Define the typed IR nodes for deterministic ops, semantic ops, constraints, and tool
   bindings.
2. Specify compiler error classes for boundary violations and illegal semantic state mutation.
3. Define the compiled constraint artifact model, including schemas, validators, and recovery
   policy metadata.
4. Define the `.nbc` container format and which runtime sections it must carry.
5. Connect this compiler pipeline to the trace, replay, and debugging model.
