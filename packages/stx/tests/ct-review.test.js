import assert from "node:assert/strict";
import test from "node:test";

import { runCriticalReview } from "../src/ct-review.js";

function baseInput() {
  return {
    reasoning_chain: {
      nodes: [
        {
          id: "e1",
          label: "The proposal has supporting evidence.",
          type: "evidence",
        },
        {
          id: "c1",
          label: "The proposal can proceed to approval.",
          type: "conclusion",
        },
      ],
      edges: [
        {
          from: "e1",
          to: "c1",
          relation: "supports",
        },
      ],
    },
    plan_steps: [],
    assumptions: [],
    numeric_claims: [],
    concurrency: {
      steps: [],
      shared_resources: [],
      protections: [],
    },
    confidence_score: 0.9,
    has_destructive_side_effects: false,
  };
}

test("critical review passes grounded reasoning input", () => {
  const report = runCriticalReview({
    admittedOutput: {
      ct_review_input: baseInput(),
    },
  });

  assert.equal(report.isBlocked, false);
  assert.equal(report.issues.length, 0);
});

test("critical review blocks contradictory reasoning input", () => {
  const input = baseInput();
  input.reasoning_chain.nodes.push({
    id: "c2",
    label: "The proposal contradicts the conclusion.",
    type: "claim",
  });
  input.reasoning_chain.edges.push({
    from: "c2",
    to: "c1",
    relation: "contradicts",
  });

  const report = runCriticalReview({
    admittedOutput: {
      ct_review_input: input,
    },
  });

  assert.equal(report.isBlocked, true);
  assert.equal(report.issues[0].code, "ct_reasoning_contradiction");
  assert.equal(report.recommendations[0].action, "regenerate_with_ct_review");
});

test("critical review does not infer contradictions without lowered contradict edges", () => {
  const input = baseInput();
  input.reasoning_chain.nodes = [
    {
      id: "c1",
      label: "The output should not be funny.",
      type: "claim",
    },
    {
      id: "c2",
      label: "The output should make the user laugh.",
      type: "conclusion",
    },
    {
      id: "e1",
      label: "The semantic output has no lowered contradiction edge.",
      type: "evidence",
    },
  ];
  input.reasoning_chain.edges = [
    {
      from: "e1",
      to: "c2",
      relation: "supports",
    },
  ];

  const report = runCriticalReview({
    admittedOutput: {
      ct_review_input: input,
    },
  });

  assert.equal(report.isBlocked, false);
  assert.equal(report.issues.length, 0);
});

test("critical review blocks review-artifact-only plans that miss project execution obligations", () => {
  const input = baseInput();
  input.plan_steps = [
    {
      id: "s1",
      description: "Record run metadata in a review artifact.",
      dependencies: [],
      resources: ["review-artifact"],
    },
    {
      id: "s2",
      description: "Wait for explicit approval before execution.",
      dependencies: ["s1"],
      resources: ["approval-gate"],
    },
  ];

  const report = runCriticalReview({
    intent: {
      primaryDirective:
        "continue executuon of tasks, use subagents and adjust the effort level to the task complexity. treat the trcker json as part of the project and commit it.",
    },
    admittedOutput: {
      summary: "Prepare a fresh review artifact and wait for approval.",
      changes: [
        {
          operation: "create_file",
          workspace_path: "/repo/.semantix/reviews/run.semantic-review.json",
          content: "{}",
        },
      ],
      ct_review_input: input,
    },
  });

  assert.equal(report.isBlocked, true);
  assert.equal(report.issues.some((issue) => issue.code === "ct_scope_coverage_gap"), true);
  assert.equal(report.issues.some((issue) => issue.code === "ct_scope_obligation_missing"), true);
});

test("critical review blocks low-confidence side effects", () => {
  const input = baseInput();
  input.confidence_score = 0.4;
  input.has_destructive_side_effects = true;

  const report = runCriticalReview({
    admittedOutput: {
      workspace_path: "routes/auth.ts",
      ct_review_input: input,
    },
  });

  assert.equal(report.isBlocked, true);
  assert.equal(report.issues[0].code, "ct_low_confidence_side_effect");
});
