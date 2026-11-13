## TPF Token Proxy Filter

TPF reduces token consumption by filtering noisy command output. It wraps commands transparently - your args are passed through exactly. Output is trimmed by recipes (TOML filters) to remove noise while keeping what matters.

### How to prefix commands

Prefix ALL shell commands with `TPF_LLM_TOOL=codex tpf`:
- `TPF_LLM_TOOL=codex tpf git status`
- `TPF_LLM_TOOL=codex tpf cargo test`
- `TPF_LLM_TOOL=codex tpf psql "$DATABASE_URL" -c "SELECT count(*) FROM users"`
- `TPF_LLM_TOOL=codex tpf rg "pattern" src/`

Your arguments are passed directly to the command - no extra shell layer, no quoting changes. Write the command exactly as you would without tpf, just add the prefix.

### Commands to NEVER prefix

cd, echo, cat, head, tail, mkdir, rm, mv, cp, chmod, pwd, export, source, set, unset, alias, read, printf, test, true, false, which, touch.

### Piped commands

For piped commands, set `TPF_PIPE` with the pipe part. The first command keeps exact argv (no quoting issues). The pipe runs separately.
- `TPF_PIPE='head -20' TPF_LLM_TOOL=codex tpf git log --oneline`
- `TPF_PIPE='grep FAILED' TPF_LLM_TOOL=codex tpf cargo test`
- `TPF_PIPE='grep -E "PASS|FAIL" | tail -5' TPF_LLM_TOOL=codex tpf psql "$DB" -f query.sql`

### Chained commands (&&, ;)

Prefix each command separately. Skip ignored commands (cd, source, echo, etc.):
- `source .env && TPF_PIPE='grep foo' TPF_LLM_TOOL=codex tpf psql "$DB" -c "SELECT *"`
- `cd /tmp && TPF_LLM_TOOL=codex tpf git status`
- `TPF_LLM_TOOL=codex tpf cargo fmt && TPF_LLM_TOOL=codex tpf cargo test`

### What NOT to wrap

Do NOT prefix: redirections (>, <), logical OR (||), background (&), or subshells ($(), backticks).

### Understanding filtered output

TPF may trim output (remove noise lines, cap line count). When output is truncated, you'll see a note like `[882 total lines, showing first 200]`. If you need the full unfiltered output, use `tpf exec` as a fallback which runs the command through sh -c:
- `TPF_LLM_TOOL=codex tpf exec 'command here'`

Failed commands always save full raw output to disk - the path is shown in the error hint.

## Subagent and Token Usage

Default to using subagents for non-trivial work, especially broad
codebase exploration, test-failure triage, reviews, multi-file
changes, or tasks requiring parallel investigation. Keep the main
thread focused on decisions, concise summaries, and final
implementation steps.

Subagents should receive narrow task briefs and return compact
findings: relevant files, key facts, risks, and recommended next
actions. Avoid pasting large raw outputs into the main thread.

For trivial, local, or single-command tasks, skip subagents when the
overhead would exceed the benefit. Always be mindful of token usage.

## Behavioral Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" -> "Write tests for invalid inputs, then make them pass"
- "Fix the bug" -> "Write a test that reproduces it, then make it pass"
- "Refactor X" -> "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] -> verify: [check]
2. [Step] -> verify: [check]
3. [Step] -> verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
