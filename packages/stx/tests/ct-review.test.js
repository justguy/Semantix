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
