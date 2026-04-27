# Semantix Deterministic Core and Runtime Boundary

## Purpose

Semantix cannot be an effective language if every operation is routed through a language
model. The deterministic side of the runtime is the anchor that makes the language practical,
safe, and predictable.

This document outlines a first-pass design for the deterministic core of Semantix and how it
interacts with the semantic execution model.

The central idea is simple:

- deterministic execution is the default
- semantic execution is explicit
- side effects happen only through the deterministic runtime
- fuzzy outputs must cross back into the program through typed, validated boundaries

## Core Thesis

If the semantic engine is the part of Semantix responsible for interpretation, reasoning, and
generation, the deterministic engine is the part responsible for:

- arithmetic
- exact comparison
- control flow
- data structures
- API and database access
- file and network I/O
- security boundaries
- repeatable execution

Without this split, Semantix would inherit the worst failure mode of raw LLM systems:
offloading math, parsing, routing, and side effects to a probabilistic model that is not
designed for them.

## Design Principles

Semantix should follow these runtime rules:

1. Deterministic by default
   Standard expressions run on the logic unit unless the programmer explicitly opts into a
   semantic operator.
2. Semantic by operator, not by ambient mode
   The language should make it obvious when a line of code incurs model latency, token cost,
   or probabilistic behavior.
3. Typed re-entry from semantic execution
   A model-generated result should not silently enter the program as trusted structured data.
   It must be validated, parsed, or wrapped in a typed semantic result.
4. Deterministic control of side effects
   Network access, disk writes, database mutations, and external process calls belong to the
   deterministic runtime.
5. Observable boundaries
   The compiler and debugger should expose where execution crosses from deterministic to
   semantic and back.

## Deterministic Shell Around A Probabilistic Core

Semantix does not make the neural unit truly deterministic. Instead, it makes the boundary
around semantic execution deterministic.

That boundary is where the language earns its reliability.

The semantic runtime is allowed to produce candidate meanings, candidate text, or candidate
structured output. The deterministic runtime then decides whether those candidates are allowed
to enter the program.

In practice, that means semantic steps must cross back through hard gates such as:

- type validation
- schema validation
- threshold checks
- verifier checks
- capability checks
- retry budgets

This is the real contract of Semantix. The model remains probabilistic inside the box, but the
box itself is rigid.

## The Semantic Loophole Problem

This is the key failure mode of prompt-centric AI systems:

a prompt rule is not a hard constraint. It is only another weighted influence in the model's
token prediction process.

If you tell the model:

- "Never bypass the authorization check"
- "Never write to `/root/`"
- "Always return valid JSON"

the model does not experience those statements as immutable program law. It experiences them as
highly weighted suggestions competing against the rest of the active context.

That means a sufficiently urgent, adversarial, or emotionally loaded input can still push the
model toward violating the rule.

For example, a prompt that says "never bypass auth" may still lose against a user message that
frames the request as an emergency, a security drill, or a production-saving exception.

This is why Semantix cannot be built on prompt discipline alone.

## Stop Pleading, Start Parsing

The practical response to the semantic loophole problem is simple:

do not ask the model to uphold critical invariants in its own head if the deterministic runtime
can enforce them mechanically.

Weak pattern:

- "Please ensure the file path is safe and does not include `/root/`."

Strong pattern:

- parse the generated path
- check it against policy
- reject it deterministically if it violates the rule

In other words, Semantix should replace long prompt pleas with short deterministic checks
wherever possible.

This is the difference between:

- suggestion
- admission control

The model may suggest anything. The runtime decides what is allowed to enter execution.

## Dual Execution Model

Semantix runtime is best understood as a dual-engine system:

- Logic Unit
  Executes deterministic code: arithmetic, comparisons, collections, control flow, typed
  parsing, and external I/O.
- Neural Unit
  Executes semantic code: generation, semantic matching, summarization, extraction, and
  refinement.

The compiler should lower Semantix source into an intermediate form where these boundaries are
explicit. That gives the runtime a reliable way to:

- schedule expensive semantic steps
- cache and replay them
- enforce effect boundaries
- track provenance
- keep normal computation fast and cheap

## Deterministic Critique Gate

Some semantic constraints cannot be reduced to simple field presence or path checks. They still need to be made structural before they can affect execution. Semantix handles that by requiring semantic nodes to lower critique inputs into the admitted JSON artifact, then running deterministic critique over that structure.

The current CT-MCP gate follows this shape:

1. The neural unit emits a proposal plus `ct_review_input`.
2. The runtime parses and validates the full output against `hard_validation_schema`.
3. CT-MCP reviews the admitted `ct_review_input` for contradictions, broken plan dependencies, unsupported confidence, arithmetic mismatch, and concurrency hazards.
4. Findings are merged into issues, evidence, risk flags, and recommendations.
5. Approval is blocked, escalated, or allowed based on deterministic review state.

This is deliberately not a loose second LLM call. The model performs semantic lowering, but the schema decides whether the lowered structure exists and CT-MCP decides whether that structure is coherent enough to proceed.

## Bifurcated Type System

Semantix should support both deterministic types and semantic constructs.

### Deterministic Types

These are values the logic unit can store and manipulate directly:

- `int`
- `float`
- `bool`
- `string`
- `json`
- `array<T>`
- `map<K, V>`
- `struct`

### Semantic Constructs

These describe fuzzy meaning or runtime constraints rather than plain machine values:

- `concept`
- `constraint`
- `context`
- semantic match results
- provenance-bearing generated values

### Operator Split

The operator model should make the runtime boundary obvious:

```rust
int max_retries = 3;
float temperature = 0.7;
bool is_premium_user = true;

string summary ~> "Summarize this.";
```

- `=` means deterministic evaluation on the logic unit
- `~>` means semantic generation on the neural unit

In other words, Semantix should not hide the cost model. A reader should know from syntax when
execution becomes probabilistic.

## Generated Values Still Need Types

A generated string is still a `string`, but Semantix should preserve metadata about how that
value was produced.

For example, a generated value may carry:

- the prompt or template used
- the active context slice
- verifier results
- grounding references
- retry count

The value exposed to the program can remain a normal `string`, but the runtime and debugger
should retain the semantic provenance alongside it.

## The Native `extract<T>` Operator

One of the most important jobs in an LLM-native language is converting unstructured text into
strict program data. Semantix should make that a first-class language feature.

### Example

```rust
string receipt_text = load("receipt.txt");

int total_cost = extract<int>("What is the final total?") from receipt_text;

struct Item {
    name: string,
    price: float
}

array<Item> items = extract<array<Item>>("List all purchased items") from receipt_text;
```

### Intended Semantics

`extract<T>` should compile into a structured runtime pipeline:

1. Build a constrained prompt from the extraction request and source material.
2. Generate output under a schema derived from `T`.
3. Parse the result deterministically.
4. Validate that the parsed value conforms to `T`.
5. Return the typed value or throw a runtime error.

This is the bridge from fuzzy understanding to deterministic state.

### Loop of Coercion

The important implementation detail is that `extract<T>` should assume the model may miss the
target format on the first pass.

For example, the runtime may ask for an integer and receive:

- `"42"`
- `"The total is 42"`
- `{ "value": 42 }`

Semantix should treat this as a coercion loop rather than as a silent success.

The logic unit can:

1. attempt a deterministic parse against the requested type
2. reject the result if it does not conform exactly
3. send a machine-readable correction back to the semantic runtime
4. retry within a fixed budget
5. accept only a value that parses cleanly into `T`

The determinism comes from the admission rule, not from assuming the model will behave on the
first try.

### Why It Matters

Today, most AI systems require hand-built prompt wrappers, JSON schemas, parsers, and retry
logic to perform extraction safely. In Semantix, the compiler and runtime should own that
workflow directly.

This is also why Semantix scales better than prompt whack-a-mole.

When a new edge case appears, the developer should not need to append another paragraph to a
polluted system prompt. They should be able to add or strengthen one deterministic boundary and
know that the runtime will enforce it consistently.

### Failure Model

If extraction fails, the failure should look like a normal runtime error rather than a vague
LLM failure:

- `ExtractionError`
- `SchemaMismatch`
- `UnsupportedCast`
- `AmbiguousExtraction`
- `CoercionExhausted`

This keeps failures legible to both the language runtime and the developer.

The same failure discipline applies to critique lowering. Missing `ct_review_input` is a schema failure. A contradictory reasoning graph is not a parse failure; it is an admitted proposal with a deterministic critique issue that blocks approval until the contradiction is resolved or explicitly escalated.

## Deterministic Arithmetic

The runtime must never treat arithmetic as a fuzzy task when it can be performed exactly.

### Principle

The neural unit may help identify operands or relevant fields, but arithmetic itself belongs
to the logic unit.

### Preferred Pattern

```rust
struct Financials {
    revenue: int,
    operating_costs: int
}

Financials f = extract<Financials>("Extract revenue and operating costs") from financial_report;
int profit = f.revenue - f.operating_costs;
```

This keeps the semantic step focused on extraction and the deterministic step focused on math.

### Possible Language Sugar

Semantix may support more compact forms such as:

```rust
int profit = extract<int>("Revenue minus operating costs") from financial_report;
```

If the language allows this, the compiler or runtime should lower it toward deterministic math
where possible rather than asking the model to literally perform the calculation token by
token.

That could mean:

- extracting named operands first
- compiling a tiny deterministic expression plan
- rejecting the request if the implied math is ambiguous

The important rule is that Semantix should prefer exact computation over probabilistic
guesswork.

## Deterministic API and I/O

The semantic engine should not be allowed to perform direct side effects.

Instead, all external interaction should happen through deterministic code and typed APIs.

### Example

```rust
json user_data = http.get("https://api.stripe.com/v1/users/{user_id}");

with context { user_data } {
    if user_data.status == "past_due" {
        string reminder ~> "Write a polite payment reminder.";
        email.send(user_data.email, reminder);
    }
}
```

In this flow:

- the deterministic runtime fetches the JSON
- the semantic runtime reads that data in a scoped context
- the semantic runtime produces text
- the deterministic runtime decides whether to send the email

This creates a clean security boundary: the model can suggest content, but it cannot mutate
the outside world on its own.

## Control Flow: Exact vs Semantic Routing

Semantix should support both strict and semantic decision-making, but the distinction must stay
visible.

### Exact Comparison

```rust
if sender_ip == "192.168.1.1" {
    return "Internal request ignored.";
}
```

`==` is byte-for-byte deterministic comparison.

### Semantic Comparison

```rust
if msg ~== "The user is reporting a critical server outage" {
    trigger_pager_duty();
}
```

`~==` is a semantic predicate evaluated by the semantic runtime.

### Recommended Internal Model

For runtime clarity, `~==` should likely produce a typed semantic match result, even if the
language allows it in an `if` condition.

For example:

```rust
SemanticMatch outage = msg ~== "The user is reporting a critical server outage";

if outage.passed {
    trigger_pager_duty();
}
```

That gives the runtime room to preserve:

- match score
- threshold used
- evidence spans
- explanation or rationale

For high-impact workflows, it may be better to require explicit thresholds rather than hiding
them behind a plain boolean.

### Deterministic Lowering For Semantic Predicates

This is the key subtlety: the input to `~==` is semantic, but the decision boundary should be
deterministic.

For many low-latency concept checks, the runtime may lower:

```rust
msg ~== "The user is angry"
```

into:

1. embed the input message
2. embed the target concept or retrieve its precomputed embedding
3. compute cosine similarity
4. compare the score against a deterministic threshold

That means the final `passed` result is not a fuzzy boolean. It is the output of a strict
numeric comparison.

This should not force Semantix to use embeddings for every semantic predicate. Some predicates
may need richer classifiers or model-assisted scoring. But even then, the runtime should
prefer a deterministic final gate:

- produce a score
- compare against a threshold
- expose the score and threshold in the trace

Semantix is strongest when semantic reasoning produces signals and the deterministic runtime
turns those signals into explicit decisions.

CT-MCP is one concrete implementation of this principle. It does not authorize execution. It names deterministic critique signals such as circular reasoning, orphaned conclusions, invalid plan dependencies, arithmetic mismatches, and concurrency hazards. The Semantix runtime then converts those signals into approval state.

## State vs Output

Semantix should enforce a hard distinction between generated output and authoritative program
state.

The semantic runtime may produce:

- text
- classifications
- extraction candidates
- summaries
- ranked options

The semantic runtime should not directly mutate:

- database records
- authentication state
- files
- networked systems
- process environment

### Illegal Shape

```rust
~> "Evaluate the user's intent and update their database record."
```

This collapses analysis and side effect into one semantic action, which makes capability
control and replay much harder.

### Legal Shape

```rust
string intent ~> "What is the user's intent?";

if intent ~== "upgrade account" {
    db.update_plan("premium");
}
```

Here the semantic runtime interprets the text, but the deterministic runtime remains the only
authority that can change state.

## Security Boundary

The deterministic side of Semantix is not just an optimization. It is also the main safety
boundary of the language.

The semantic runtime should not be able to:

- open sockets directly
- execute shell commands directly
- write files directly
- mutate a database directly
- send messages directly

Instead, it can only produce values, match results, extraction candidates, or verified output
that the deterministic runtime may choose to act on.

This makes it easier to reason about:

- capability control
- permission prompts
- audit logging
- replay
- sandboxing

## Policy Blocks And Protected Capabilities

Some deterministic functions should carry explicit security policy instead of relying only on
general capability boundaries.

Semantix should support a first-class policy layer that wraps sensitive deterministic tools in
compiled allow, deny, and approval rules.

### Example

```rust
policy FileSystemPolicy {
    deny_match: ["/root/*", "/system/*"],
    require_auth: ["/workspace/prod/*"]
}

@Enforce(FileSystemPolicy)
task delete_file(path: string) -> bool {
    return os.remove(path);
}
```

This matters because some operations are not merely malformed. They are categorically unsafe or
privileged.

When a tool call crosses one of these policy boundaries, the runtime should not treat it as a
normal semantic formatting problem.

### Expected Runtime Behavior

- outputs that fail a formatting or schema contract remain semantic failures and may be retried
- outputs that target forbidden capability space become `PolicyViolation`
- outputs that target privileged but potentially valid capability space become
  `ApprovalRequired`

This lets Semantix distinguish:

- "the model formatted the answer badly"
- "the model proposed an action that is forbidden"
- "the model proposed an action that needs deterministic approval"

## Policy Mode Vs Generation Mode

Once a protected boundary is hit, the runtime should leave ordinary generation mode and enter
policy mode.

This is the core defense against social-engineering-style prompt injection.

If a user asks for a forbidden action and the runtime keeps the semantic frame alive, the model
may start negotiating, rationalizing, or trying workarounds. A production Semantix runtime
should not allow that.

Instead:

- `ConstraintViolation` stays inside the semantic refine loop
- `PolicyViolation` trips a deterministic circuit breaker and ends the semantic frame
- `ApprovalRequired` pauses semantic work and transfers control to a deterministic approval flow

### Deterministic Circuit Breaker

When the circuit breaker trips, the neural unit should be suspended for that execution thread.

The model should not be allowed to:

- explain why the forbidden action is reasonable
- ask persuasive follow-up questions
- propose alternate restricted paths
- search for a workaround to the blocked action

At that point, only deterministic code should be allowed to respond by:

- issuing a hard deny
- offering a constrained safe alternative
- triggering an explicit approval workflow

This is how Semantix prevents the model from negotiating its way past a protected boundary.

## Compiler Responsibilities

To make this model real, the compiler should:

- distinguish deterministic and semantic expressions in the IR
- derive extraction schemas from `extract<T>`
- reject illegal side effects inside semantic-only regions
- surface where runtime cost switches from local compute to model inference
- preserve source mapping across deterministic and semantic nodes

## Runtime Responsibilities

The runtime should:

- execute deterministic ops locally and immediately
- invoke the semantic engine only for semantic operators
- cache semantic results for replay and debugging
- attach provenance to semantic outputs
- enforce capability boundaries around I/O
- lower arithmetic and parsing to deterministic execution whenever possible

## Failure Modes

Semantix should give developers failures that reflect the true boundary that broke.

Candidate error classes:

- `ConstraintViolation`
- `PolicyViolation`
- `ApprovalRequired`
- `ExtractionError`
- `SchemaMismatch`
- `SemanticTypeError`
- `VerificationError`
- `BoundaryViolation`
- `BudgetExceeded`
- `AmbiguousSemanticPredicate`
- `CoercionExhausted`

The goal is to make it obvious whether a failure came from:

- normal logic
- model generation
- typing
- verification
- permissions
- runtime budgets

## Open Questions

The following pieces still need a tighter spec:

- Should semantic operators return plain primitives, wrapped values, or both?
- How much arithmetic inference should `extract<T>` be allowed to perform automatically?
- Should `~==` always expose a score, or can it collapse to `bool` by default?
- Which `~==` cases can be safely lowered to embeddings plus cosine thresholding?
- Which side effects, if any, should be allowed in restricted semantic sandboxes?
- How should provenance metadata be surfaced without making the language noisy?
- What is the minimum viable capability model for network, file, and database access?

## Near-Term Next Steps

1. Specify operator semantics for `=`, `~>`, `~==`, and `extract<T>`.
2. Define the IR boundary between logic-unit and neural-unit execution.
3. Define runtime value wrappers for semantic provenance and match metadata.
4. Decide whether arithmetic inference is syntax sugar or a core language feature.
5. Connect this runtime model to the trace and debugger model from the tooling doc.
