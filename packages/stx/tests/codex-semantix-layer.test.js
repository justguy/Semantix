import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createStxApplication } from "../src/application.js";
import {
  classifyCodexRequest,
  createLlmClassificationProvider,
} from "../src/codex-semantix-layer.js";

function createCtReviewInput(summary = "The semantic proposal is grounded and approval-gated.") {
  return {
    reasoning_chain: {
      nodes: [
        {
          id: "e1",
          label: "The proposal includes supporting context and waits for approval.",
          type: "evidence",
        },
        {
          id: "c1",
          label: summary,
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
    plan_steps: [
      {
        id: "semantic",
        description: "Compile the semantic proposal.",
        dependencies: [],
        resources: [],
      },
      {
        id: "approval",
        description: "Require fresh approval before execution.",
        dependencies: ["semantic"],
        resources: [],
      },
    ],
    assumptions: [
      {
        description: "The referenced workspace context is present when execution is approved.",
        confidence: 0.8,
        falsification_condition: "A referenced file or symbol is missing during deterministic review.",
      },
    ],
    numeric_claims: [],
    concurrency: {
      steps: [],
      shared_resources: [],
      protections: [],
    },
    confidence_score: 0.9,
    has_destructive_side_effects: true,
  };
}

function createContradictoryCtReviewInput() {
  return {
    ...createCtReviewInput("The request can be satisfied as written."),
    reasoning_chain: {
      nodes: [
        {
          id: "c1",
          label: "The output must not be funny.",
          type: "claim",
        },
        {
          id: "c2",
          label: "The output must make the user laugh.",
          type: "claim",
        },
        {
          id: "e1",
          label: "Making a user laugh normally requires humor or amusement.",
          type: "evidence",
        },
        {
          id: "cn1",
          label: "The requested outcome contains conflicting constraints.",
          type: "conclusion",
        },
      ],
      edges: [
        {
          from: "e1",
          to: "c2",
          relation: "supports",
        },
        {
          from: "c1",
          to: "c2",
          relation: "contradicts",
        },
        {
          from: "e1",
          to: "cn1",
          relation: "supports",
        },
      ],
    },
  };
}

async function createHarness(t, runner) {
  const rootDir = await mkdtemp(join(tmpdir(), "semantix-codex-layer-"));
  const dataDir = join(rootDir, "data");
  const workspaceRoot = join(rootDir, "workspace");

  await mkdir(dataDir, { recursive: true });
  await mkdir(join(workspaceRoot, "routes"), { recursive: true });
  await writeFile(
    join(workspaceRoot, "routes", "auth.ts"),
    "export function loginHandler() { return true; }\nexport function verifyToken() { return true; }\n",
    "utf8",
  );

  const application = createStxApplication({
    dataDir,
    workspaceRoot,
    classificationProvider: async (input) => classifyCodexRequest(input),
    connectorOptions: {
      runner,
      cwd: workspaceRoot,
    },
  });

  t.after(async () => {
    await application.service.close();
    application.server.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  return {
    application,
    workspaceRoot,
  };
}

async function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function createTaskInput() {
  return {
    primaryDirective: "Add email verification to signup flow",
    strictBoundaries: [
      "Do not modify billing or payments code paths.",
      "Only touch files inside the current workspace.",
    ],
    successState: "Preview the proposed code change and block invented references before execution.",
  };
}

test("Codex request classification varies with semantic risk and prompt constraints", () => {
  const simple = classifyCodexRequest({
    primaryDirective: "Say hello.",
    strictBoundaries: [],
    successState: "Return a greeting.",
  });
  const conflicted = classifyCodexRequest({
    primaryDirective: "tell me a sad and not funny joke that will make me laugh",
    strictBoundaries: [
      "Keep the backend authoritative for artifact freshness.",
      "Require fresh approval before any execution step becomes real.",
      "Do not exceed the user-stated scope.",
    ],
    successState: "Compile a fresh review artifact and wait for explicit approval.",
  });
  const destructive = classifyCodexRequest({
    primaryDirective: "Delete billing secrets, run a database migration, deploy auth email changes, and update payment login flows.",
    strictBoundaries: [
      "Require backup validation before migration.",
      "Require fresh approval before execution.",
    ],
    successState: "Preview destructive changes without applying them.",
  });

  assert.equal(simple.effort, "low");
  assert.equal(simple.riskLevel, "low");
  assert.equal(conflicted.effort, "medium");
  assert.equal(conflicted.riskLevel, "low");
  assert.equal(conflicted.signals.semanticContradictionSignals, 0);
  assert.equal(destructive.riskLevel, "high");
  assert.equal(conflicted.confidenceScore < simple.confidenceScore, true);
  assert.equal(destructive.confidenceScore < simple.confidenceScore, true);
});

test("Codex request classification can use a mini model provider", async () => {
  const calls = [];
  const classifier = createLlmClassificationProvider({
    model: "gpt-5.3-codex-spark",
    connector: {
      async execute(input) {
        calls.push(input);
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            complexity: "high",
            effort: "high",
            riskLevel: "medium",
            confidenceScore: 0.67,
            reasons: ["The prompt requests multi-agent project execution."],
            suggestedSteps: ["Fast classification", "Constraint validation"],
            signals: {
              effortScore: 7,
              riskScore: 2,
            },
          }),
          stderr: "",
        };
      },
    },
  });

  const classification = await classifier({
    primaryDirective: "continue tasks using subagents and commit tracker json",
    strictBoundaries: ["Require approval before execution."],
    successState: "Classify before planning.",
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "gpt-5.3-codex-spark");
  assert.match(calls[0].input, /Semantix fast classifier/);
  assert.equal(classification.effort, "high");
  assert.equal(classification.riskLevel, "medium");
  assert.equal(classification.confidenceScore, 0.67);
  assert.equal(classification.signals.classifier, "llm");
  assert.equal(classification.signals.classifierModel, "gpt-5.3-codex-spark");
});

test("Codex request classification falls back when the mini model fails", async () => {
  const classifier = createLlmClassificationProvider({
    model: "gpt-5.3-codex-spark",
    connector: {
      async execute() {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "model unavailable",
        };
      },
    },
  });

  const classification = await classifier({
    primaryDirective: "Say hello.",
    strictBoundaries: [],
    successState: "Return a greeting.",
  });

  assert.equal(classification.effort, "low");
  assert.equal(classification.signals.classifier, "heuristic_fallback");
  assert.equal(classification.signals.classifierModel, "gpt-5.3-codex-spark");
  assert.match(classification.reasons[0], /Mini-model classification failed/);
});

test("Codex Semantix layer projects a blocked proposal into the demo-flow issue state", async (t) => {
  const { application, workspaceRoot } = await createHarness(
    t,
    async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        workspace_path: join(workspaceRoot, "routes", "auth.ts"),
        summary: "Add email verification route with token verification.",
        diff_preview: "+ const claims = signToken.verify(token);\n",
        references: [
          {
            kind: "function",
            name: "signToken",
            required: true,
          },
        ],
        parameters: [],
        supporting_context: [
          {
            kind: "file",
            value: "routes/auth.ts",
          },
        ],
        ct_review_input: createCtReviewInput("signToken must be verified before approval."),
      }),
      stderr: "",
    }),
  );

  const flow = await application.codexLayer.start({
    runId: "run-layer-blocked",
    actor: "test",
    ...createTaskInput(),
  });

  assert.equal(flow.phase, "needs_intervention");
  assert.equal(flow.classification.effort, "medium");
  assert.equal(flow.classification.riskLevel, "medium");
  assert.equal(flow.approval.ready, false);
  assert.equal(flow.issues[0].code, "missing_symbol");
  assert.equal(flow.issues[0].affectedSymbols[0], "signToken");
  assert.equal(flow.issues[0].fixOptions[0].action, "generate_missing_symbol");
  assert.match(flow.analysis.summary, /blocking issue/);
  assert.equal(flow.recommendations[0].action, "generate_missing_symbol");
  assert.equal(flow.steps.find((step) => step.id === 4)?.status, "blocked");
  assert.equal(flow.steps.find((step) => step.id === 7)?.status, "required");
});

test("Codex Semantix layer projects runtime failures into blocking demo-flow issues", async (t) => {
  const { application } = await createHarness(
    t,
    async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "2026-04-25T16:22:16Z ERROR codex_core::session: failed to record rollout items: thread 019dc572-a339-7230-ae44-1460877a8410 not found\n",
    }),
  );

  const flow = await application.codexLayer.start({
    runId: "run-layer-runtime-failure",
    actor: "test",
    ...createTaskInput(),
  });

  assert.equal(flow.phase, "failed");
  assert.equal(flow.approval.ready, false);
  assert.equal(flow.approval.blocked, true);
  assert.equal(flow.issues[0].code, "runtime_connector_failure");
  assert.equal(flow.issues[0].blocking, true);
  assert.equal(flow.issues[0].fixOptions[0].action, "retry_semantic_admission");
  assert.match(flow.analysis.summary, /Runtime failed before admission/);
  assert.equal(flow.recommendations[0].action, "retry_semantic_admission");
  assert.match(flow.issues[0].summary, /thread 019dc572-a339-7230-ae44-1460877a8410 not found/);
  assert.equal(flow.steps.find((step) => step.id === 4)?.status, "blocked");
  assert.equal(flow.steps.find((step) => step.id === 7)?.status, "required");
  assert.equal(flow.steps.find((step) => step.id === 8)?.status, "blocked");
  assert.equal(flow.advanced.selectedNodeId, "node.semantic.generate");
  assert.equal(flow.advanced.inspectors["node.semantic.generate"].node.hardValidationSchema, undefined);
});

test("Codex Semantix layer approves and resumes a safe proposal with one call", async (t) => {
  const { application, workspaceRoot } = await createHarness(
    t,
    async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        workspace_path: join(workspaceRoot, "routes", "auth.ts"),
        summary: "Add email verification route with verifyToken().",
        diff_preview: "+ const claims = verifyToken(token);\n",
        references: [
          {
            kind: "function",
            name: "verifyToken",
            required: true,
          },
        ],
        parameters: [],
        supporting_context: [
          {
            kind: "file",
            value: "routes/auth.ts",
          },
          {
            kind: "symbol",
            value: "verifyToken",
          },
        ],
        ct_review_input: createCtReviewInput("verifyToken is grounded before approval."),
      }),
      stderr: "",
    }),
  );

  const flow = await application.codexLayer.start({
    runId: "run-layer-happy",
    actor: "test",
    ...createTaskInput(),
  });

  assert.equal(flow.phase, "awaiting_approval");
  assert.equal(flow.approval.ready, true);
  assert.equal(flow.issues.length, 0);
  assert.match(flow.result.stateEffects[0].summary, /verifyToken/);

  const completedFlow = await application.codexLayer.approveAndRun({
    runId: "run-layer-happy",
    actor: "reviewer",
  });
  const targetContent = await readFile(join(workspaceRoot, "routes", "auth.ts"), "utf8");

  assert.equal(completedFlow.phase, "completed");
  assert.equal(completedFlow.result.completed, true);
  assert.match(targetContent, /const claims = verifyToken\(token\);/);
  assert.equal(completedFlow.steps.find((step) => step.id === 12)?.status, "complete");
});

test("Codex Semantix layer projects CT-MCP contradictions into blocking issues", async (t) => {
  const { application, workspaceRoot } = await createHarness(
    t,
    async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        workspace_path: join(workspaceRoot, "routes", "auth.ts"),
        summary: "Add email verification route with verifyToken().",
        diff_preview: "+ const claims = verifyToken(token);\n",
        references: [
          {
            kind: "function",
            name: "verifyToken",
            required: true,
          },
        ],
        parameters: [],
        supporting_context: [
          {
            kind: "file",
            value: "routes/auth.ts",
          },
          {
            kind: "symbol",
            value: "verifyToken",
          },
        ],
        ct_review_input: createContradictoryCtReviewInput(),
      }),
      stderr: "",
    }),
  );

  const flow = await application.codexLayer.start({
    runId: "run-layer-ct-contradiction",
    actor: "test",
    primaryDirective: "tell me a sad and not funny joke that will make me laugh",
    strictBoundaries: [
      "Keep the backend authoritative for artifact freshness.",
      "Require fresh approval before any execution step becomes real.",
    ],
    successState: "Block contradictory semantic constraints before approval.",
  });

  assert.equal(flow.phase, "needs_intervention");
  assert.equal(flow.approval.ready, false);
  assert.equal(flow.issues[0].code, "ct_reasoning_contradiction");
  assert.equal(flow.issues[0].blocking, true);
  assert.match(flow.issues[0].summary, /contradictory semantic constraints/);
  assert.equal(flow.recommendations[0].action, "regenerate_with_ct_review");
});

test("Codex Semantix layer blocks review-artifact-only admission when project work obligations are missing", async (t) => {
  const { application, workspaceRoot } = await createHarness(
    t,
    async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        summary: "Prepare a fresh review artifact and wait for approval.",
        changes: [
          {
            operation: "create_file",
            workspace_path: join(workspaceRoot, ".semantix", "reviews", "run-layer-scope.semantic-review.json"),
            summary: "Record approval-only review state.",
            content: "{}",
          },
        ],
        references: [
          {
            kind: "file",
            name: "semantic review artifact",
            path: join(workspaceRoot, ".semantix", "reviews", "run-layer-scope.semantic-review.json"),
            source: "invented",
            required: true,
            supporting_context: ["Success state requires compiling a fresh review artifact before execution."],
          },
        ],
        parameters: [
          {
            name: "review_artifact_path",
            source: "invented",
            evidence: "Chosen under the allowed workspace root.",
          },
        ],
        supporting_context: [
          {
            kind: "note",
            value: "The success state requires compiling a fresh review artifact and waiting for explicit approval.",
          },
        ],
        ct_review_input: {
          ...createCtReviewInput("Create a review artifact proposal and do not perform execution until approval is granted."),
          plan_steps: [
            {
              id: "s1",
              description: "Record run metadata and the user-requested task continuation intent in a review artifact.",
              dependencies: [],
              resources: ["review-artifact"],
            },
            {
              id: "s2",
              description: "Wait for explicit approval before any execution step becomes real.",
              dependencies: ["s1"],
              resources: ["approval-gate"],
            },
          ],
          has_destructive_side_effects: false,
        },
      }),
      stderr: "",
    }),
  );

  const flow = await application.codexLayer.start({
    runId: "run-layer-scope",
    actor: "test",
    primaryDirective:
      "continue executuon of tasks, use subagents and adjust the effort level to the task complexity. use subagents where possible. make sure to tread the trcker json as an integral prt of the prohect and commit it as you commit other work.",
    strictBoundaries: [
      "Keep the backend authoritative for artifact freshness.",
      "Require fresh approval before any execution step becomes real.",
      "Do not exceed the user-stated scope.",
    ],
    successState: "Compile a fresh review artifact and wait for explicit approval before execution.",
  });

  assert.equal(flow.phase, "needs_intervention");
  assert.equal(flow.approval.ready, false);
  assert.equal(flow.issues.some((issue) => issue.code === "ct_scope_coverage_gap"), true);
  assert.equal(flow.issues.some((issue) => issue.code === "ct_scope_obligation_missing"), true);
  assert.equal(flow.steps.find((step) => step.id === 4)?.status, "blocked");
  assert.equal(flow.steps.find((step) => step.id === 7)?.status, "required");
  assert.equal(flow.steps.find((step) => step.id === 8)?.status, "blocked");
  assert.equal(flow.execution.progress.find((entry) => entry.id === "validate")?.done, false);
  assert.equal(flow.advanced.inspectors["node.semantic.generate"].compiler?.hardValidationSchema, undefined);
  assert.equal(flow.advanced.inspectors["node.semantic.generate"].compiler?.admittedOutput, undefined);
  assert.equal(flow.advanced.inspectors["node.semantic.generate"].outputPreview?.preview, undefined);
});

test("Codex Semantix layer blocks exact-content byte mismatches before approval", async (t) => {
  const exactContent =
    "export function loginHandler() {\n  const claims = verifyToken(\"demo\");\n  return Boolean(claims);\n}\nexport function verifyToken() { return true; }\n";
  const alteredContent =
    "export function loginHandler() {\n const claims = verifyToken(\"demo\");\n return Boolean(claims);\n}\nexport function verifyToken() { return true; }\n";
  const { application } = await createHarness(
    t,
    async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        summary: "Replace auth route exactly.",
        changes: [
          {
            operation: "modify_file",
            workspace_path: "routes/auth.ts",
            content: alteredContent,
          },
        ],
        references: [
          {
            kind: "function",
            name: "verifyToken",
            required: true,
          },
        ],
        parameters: [],
        supporting_context: [
          {
            kind: "file",
            value: "routes/auth.ts",
          },
          {
            kind: "symbol",
            value: "verifyToken",
          },
        ],
        ct_review_input: createCtReviewInput("Exact file replacement is grounded before approval."),
      }),
      stderr: "",
    }),
  );

  const flow = await application.codexLayer.start({
    runId: "run-layer-exact-content-mismatch",
    actor: "test",
    primaryDirective: `Replace routes/auth.ts with this exact content: ${JSON.stringify(exactContent)}`,
    strictBoundaries: [
      "Only touch routes/auth.ts inside the current workspace.",
      "Require fresh approval before any execution step becomes real.",
    ],
    successState: "Block exact-content byte mismatches before approval.",
  });

  assert.equal(flow.phase, "needs_intervention");
  assert.equal(flow.approval.ready, false);
  assert.equal(flow.issues[0].code, "content_mismatch");
  assert.equal(flow.issues[0].blocking, true);
});

test("Codex Semantix layer applies a fix and re-runs semantic admission", async (t) => {
  let runnerCalls = 0;
  const { application, workspaceRoot } = await createHarness(
    t,
    async () => {
      runnerCalls += 1;
      const symbol = runnerCalls === 1 ? "signToken" : "verifyToken";
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          workspace_path: join(workspaceRoot, "routes", "auth.ts"),
          summary: `Add email verification route with ${symbol}().`,
          diff_preview: `+ const claims = ${symbol}(token);\n`,
          references: [
            {
              kind: "function",
              name: symbol,
              required: true,
            },
          ],
          parameters: [],
          supporting_context:
            symbol === "verifyToken"
              ? [
                  {
                    kind: "file",
                    value: "routes/auth.ts",
                  },
                  {
                    kind: "symbol",
                    value: "verifyToken",
                  },
                ]
              : [
                  {
                    kind: "file",
                    value: "routes/auth.ts",
                  },
                ],
          ct_review_input: createCtReviewInput(`${symbol} is reviewed before approval.`),
        }),
        stderr: "",
      };
    },
  );

  const blockedFlow = await application.codexLayer.start({
    runId: "run-layer-fix",
    actor: "test",
    ...createTaskInput(),
  });

  assert.equal(blockedFlow.phase, "needs_intervention");
  assert.equal(blockedFlow.issues[0].code, "missing_symbol");
  assert.equal(blockedFlow.issues[0].affectedSymbols[0], "signToken");

  const fixedFlow = await application.codexLayer.applyFix({
    runId: "run-layer-fix",
    actor: "reviewer",
    issueCode: "missing_symbol",
    symbol: "signToken",
    action: "generate_missing_symbol",
  });

  assert.equal(runnerCalls, 2);
  assert.equal(fixedFlow.phase, "awaiting_approval");
  assert.equal(fixedFlow.approval.ready, true);
  assert.equal(fixedFlow.issues.length, 0);
  assert.match(fixedFlow.result.stateEffects[0].summary, /verifyToken/);
  assert.equal(fixedFlow.steps.find((step) => step.id === 8)?.status, "complete");
});

test("Codex Semantix HTTP facade starts a projected flow", async (t) => {
  const { application } = await createHarness(
    t,
    async () => ({
      exitCode: 0,
      stdout: "{}",
      stderr: "",
    }),
  );

  application.server.listen(0, "127.0.0.1");
  await once(application.server, "listening");

  const { port } = application.server.address();
  const response = await postJson(`http://127.0.0.1:${port}/codex/runs`, {
    runId: "run-layer-http",
    autoExecuteSemanticAdmission: false,
    ...createTaskInput(),
  });
  const flow = await response.json();

  assert.equal(response.status, 200);
  assert.equal(flow.runId, "run-layer-http");
  assert.equal(flow.phase, "reviewing");
  assert.equal(flow.steps.find((step) => step.id === 3)?.status, "complete");
});
