# Semantix Language Fundamentals

## Purpose

Semantix is not just a new syntax for prompt engineering. It is a different programming
paradigm.

In traditional languages, the developer tells the machine exactly how to perform each step.
In Semantix, the developer still writes strict logic where strict logic matters, but for text,
meaning, and interpretation they specify what outcome is needed and what boundaries must hold.

You can think of Semantix as a language for fenced semantic computation:

- the developer defines the box
- the developer defines the rules
- the runtime lets the model operate inside those boundaries

## The Paradigm Shift: From "How" To "What"

In a language like Python, JavaScript, or C++, you usually express exact procedures:

- create a variable
- loop through the input
- inspect characters one by one
- build the output manually

That works well for deterministic tasks. It works poorly for open-ended language tasks such as:

- rewriting tone
- inferring intent
- summarizing a document
- drafting a response

Semantix assumes the neural runtime already knows how to generate language. The programmer does
not need to teach the model how to write. Instead, the programmer specifies:

- what the model is allowed to see
- what constraints it must obey
- what kind of output is needed

The job of the language is not to remove unpredictability from the model. The job of the
language is to contain that unpredictability inside deterministic boundaries.

## The Three Core Pillars

The developer-facing heart of Semantix can be taught through three primitives:

1. `context`
2. `constraint`
3. `~>`

Everything else is standard typing, logic, math, and side-effect control.

## Pillar 1: The Box (`context`)

`context` is the model's scoped working memory.

If information is inside the context block, the semantic runtime may use it. If information is
outside the block, the semantic runtime should be treated as blind to it.

This matters because large models do not become more reliable when given arbitrary piles of
state. They become more expensive, less focused, and harder to debug.

### Mental Model

`context` is not just a convenience. It is a discipline:

- load only the information needed for the current task
- keep the semantic scope narrow
- drop irrelevant data when the task ends

### Example

```rust
string product_info = "The new XJ-900 vacuum has 20% more suction and a quieter motor.";

with context { product_info } {
    // Semantic operations inside this block can see `product_info`.
}
```

## Pillar 2: The Rules (`constraint`)

`constraint` defines reusable output rules for semantic generation.

Instead of embedding formatting, tone, and length instructions in long prompt strings every
time, Semantix should let developers define those constraints once and apply them consistently.

### Mental Model

A constraint is a contract, not a suggestion.

Examples of constraint dimensions include:

- tone
- style
- length
- required sections
- forbidden phrases
- schema or format shape

### Example

```rust
constraint TwitterRules {
    max_length: 280 characters,
    tone: "enthusiastic and brief",
    formatting: "use exactly one emoji at the end"
}
```

This keeps generation readable and keeps control logic out of raw prompt text.

## Pillar 3: The Spark (`~>`)

`~>` is the generative assignment operator.

It marks the exact point where Semantix stops doing ordinary deterministic evaluation and hands
execution to the semantic runtime.

### Mental Model

`=` means:

- compute this exactly
- assign the exact result

`~>` means:

- generate a value that satisfies the instruction
- use the current context and constraints
- pass the result back through deterministic validation gates

### Example

```rust
string tweet ~> "Write a promotional tweet for this product." :: TwitterRules;
```

This line does not tell the runtime how to write the tweet. It tells the runtime what to
produce and what boundaries the result must satisfy.

## Hello World Example

This is a minimal Semantix-style program:

```rust
constraint TwitterRules {
    max_length: 280 characters,
    tone: "enthusiastic and brief",
    formatting: "use exactly one emoji at the end"
}

task CreateTweet() {
    string product_info = "The new XJ-900 vacuum has 20% more suction and a quieter motor.";

    with context { product_info } {
        string tweet ~> "Write a promotional tweet for this product." :: TwitterRules;
        print(tweet);
    }
}
```

This example shows the full beginner workflow:

1. Define reusable rules.
2. Load only the relevant information into semantic scope.
3. Ask for an outcome instead of hand-writing the generation procedure.

## The Deterministic Fence Around The Semantic Core

These three pillars are the language's visible surface. They only work because the runtime
wraps them in deterministic enforcement.

That means:

- `context` controls what the model can see
- `constraint` defines what the output must obey
- `~>` triggers generation
- the deterministic runtime validates the result before trusted program state is updated

Semantix is not claiming that generation itself is deterministic. It is claiming that the
boundary around generation is deterministic.

That is what makes the language programmable instead of merely suggestive.

## How To Think About Writing Semantix

Traditional programming often feels like operating machinery directly. Semantix is closer to
supervising a capable but unpredictable collaborator.

The programmer's job is to:

- provide the right information
- define the right rules
- request the right outcome
- keep authority over state, math, and side effects in deterministic code

The semantic runtime is free to explore within the yard. The deterministic runtime builds the
yard and locks the gates.

## Relationship To The Rest Of The Language

These three primitives do not replace normal programming features. Semantix still needs:

- deterministic types
- arithmetic
- exact control flow
- extraction into typed data
- API and file access through deterministic code
- verification and replay tooling

The difference is that these traditional features now coexist with first-class semantic
operations instead of sitting outside the language as ad hoc prompt glue.

## Open Questions

The beginner model is simple, but several details still need a formal spec:

- How exactly are constraints compiled and enforced?
- What syntax should exist for multiple constraints on one generation?
- How much implicit context should Semantix allow before requiring explicit `context` blocks?
- Should generated values expose provenance metadata by default or only in tooling?
- What is the minimum surface area needed for a first prototype of the language?

## Near-Term Next Steps

1. Turn this beginner mental model into a short language overview for the repo root.
2. Define formal syntax and runtime semantics for `context`, `constraint`, and `~>`.
3. Connect this doc to the deterministic runtime doc and debugging/tooling doc.
4. Add a few canonical examples beyond the tweet example, such as summarization, extraction,
   and semantic routing.
