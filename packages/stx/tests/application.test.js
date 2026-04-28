import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createStxApplication } from "../src/application.js";
import { classifyCodexRequest } from "../src/codex-semantix-layer.js";

const DEFAULT_TARGET_SYMBOL = "semantix.host.apply_admitted_semantic";

function createCtReviewInput(summary = "The proposed change is grounded and approval-gated.") {
  return {
    reasoning_chain: {
      nodes: [
        {
          id: "e1",
          label: "The proposal includes explicit supporting context and waits for approval.",
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

async function createHarness(t, runner, connectorOptions = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), "semantix-stx-app-"));
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
      ...connectorOptions,
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
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return response;
}

async function compileDefaultRun(service, runId, workspaceRoot) {
  await service.createOrUpdateIntent({
    runId,
    actor: "test",
    primaryDirective: "Add email verification to signup.",
    strictBoundaries: [
      "Do not modify billing or payments code paths.",
      "Only touch files inside the current workspace.",
    ],
    successState: "Preview the proposed code change and block invented references before execution.",
  });

  return service.compilePlan({
    runId,
    actor: "test",
    cwd: workspaceRoot,
  });
}

test("default STX application leaves Codex home unset unless configured", async (t) => {
  const originalSemantixCodexHome = process.env.SEMANTIX_CODEX_HOME;
  delete process.env.SEMANTIX_CODEX_HOME;
  t.after(() => {
    if (originalSemantixCodexHome === undefined) {
      delete process.env.SEMANTIX_CODEX_HOME;
    } else {
      process.env.SEMANTIX_CODEX_HOME = originalSemantixCodexHome;
    }
  });

  let observedEnv;
  const { application, workspaceRoot } = await createHarness(
    t,
    async ({ env }) => {
      observedEnv = env;
      return {
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
      };
    },
    { env: {} },
  );

  await compileDefaultRun(application.service, "run-stx-default-codex-home", workspaceRoot);
  await application.service.executeApprovedNodes({
    runId: "run-stx-default-codex-home",
    actor: "operator",
  });

  assert.ok(observedEnv);
  assert.equal(Object.hasOwn(observedEnv, "CODEX_HOME"), false);
});

test("default STX application catches a plausible bad code change before approval", async (t) => {
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

  await compileDefaultRun(application.service, "run-stx-default-blocked", workspaceRoot);
  const pausedArtifact = await application.service.executeApprovedNodes({
    runId: "run-stx-default-blocked",
    actor: "operator",
  });

  const deterministicNode = pausedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const approvalGate = pausedArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === deterministicNode.id);
  const inspector = await application.service.getNodeInspectorPayload({
    runId: "run-stx-default-blocked",
    nodeId: deterministicNode.id,
  });
  const primaryEffect = inspector.outputPreview.stateEffects.find(
    (effect) => effect.target === join(workspaceRoot, "routes", "auth.ts"),
  );

  assert.equal(pausedArtifact.plan.status, "paused");
  assert.equal(inspector.issues[0].code, "missing_symbol");
  assert.match(inspector.issues[0].summary, /signToken/);
  assert.equal(inspector.outputPreview.diffPreview, "+ const claims = signToken.verify(token);\n");
  assert.ok(primaryEffect);
  assert.equal(primaryEffect.target, join(workspaceRoot, "routes", "auth.ts"));
  assert.notEqual(primaryEffect.target, DEFAULT_TARGET_SYMBOL);

  await assert.rejects(
    application.service.submitApprovalAction({
      runId: "run-stx-default-blocked",
      actor: "reviewer",
      action: "approve",
      planVersion: pausedArtifact.planVersion,
      graphVersion: pausedArtifact.graphVersion,
      artifactHash: pausedArtifact.artifactHash,
      gateId: approvalGate.id,
      nodeId: deterministicNode.id,
      nodeRevision: deterministicNode.revision,
    }),
    (error) =>
      error?.code === "VALIDATION_ERROR" &&
      error?.details?.issues?.[0]?.code === "missing_symbol",
  );

  const unchangedContent = await readFile(join(workspaceRoot, "routes", "auth.ts"), "utf8");
  assert.doesNotMatch(unchangedContent, /signToken/);
});

test("default STX application completes the happy-path code change flow after approval", async (t) => {
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

  await compileDefaultRun(application.service, "run-stx-default-happy", workspaceRoot);
  const pausedArtifact = await application.service.executeApprovedNodes({
    runId: "run-stx-default-happy",
    actor: "operator",
  });
  const deterministicNode = pausedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const approvalGate = pausedArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === deterministicNode.id);

  const inspector = await application.service.getNodeInspectorPayload({
    runId: "run-stx-default-happy",
    nodeId: deterministicNode.id,
  });
  const primaryEffect = inspector.outputPreview.stateEffects.find(
    (effect) => effect.target === join(workspaceRoot, "routes", "auth.ts"),
  );
  assert.equal(inspector.issues.length, 0);
  assert.equal(inspector.outputPreview.diffPreview, "+ const claims = verifyToken(token);\n");
  assert.ok(primaryEffect);
  assert.equal(primaryEffect.target, join(workspaceRoot, "routes", "auth.ts"));
  assert.notEqual(primaryEffect.target, DEFAULT_TARGET_SYMBOL);

  await application.service.submitApprovalAction({
    runId: "run-stx-default-happy",
    actor: "reviewer",
    action: "approve",
    planVersion: pausedArtifact.planVersion,
    graphVersion: pausedArtifact.graphVersion,
    artifactHash: pausedArtifact.artifactHash,
    gateId: approvalGate.id,
    nodeId: deterministicNode.id,
    nodeRevision: deterministicNode.revision,
  });

  const completedArtifact = await application.service.resumeFromCheckpoint({
    runId: "run-stx-default-happy",
    actor: "operator",
    checkpointId: pausedArtifact.plan.checkpoints.at(-1).id,
    planVersion: pausedArtifact.planVersion,
    artifactHash: pausedArtifact.artifactHash,
    nodeId: deterministicNode.id,
    nodeRevision: deterministicNode.revision,
  });

  const completedNode = completedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const targetContent = await readFile(join(workspaceRoot, "routes", "auth.ts"), "utf8");
  assert.equal(completedArtifact.plan.status, "completed");
  assert.match(completedNode.outputSummary, /Recorded approved code change/);
  assert.match(targetContent, /const claims = verifyToken\(token\);/);
});

test("default STX application applies an approved multi-file CodeChangeSet", async (t) => {
  const { application, workspaceRoot } = await createHarness(
    t,
    async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        summary: "Add email verification route and wire it from auth.",
        changes: [
          {
            operation: "modify_file",
            workspace_path: "routes/auth.ts",
            diff_preview: "+ export { verifyEmailRoute } from \"./verify-email\";\n",
          },
          {
            operation: "create_file",
            workspace_path: "routes/verify-email.ts",
            content: "export function verifyEmailRoute() { return true; }\n",
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
        ct_review_input: createCtReviewInput("The multi-file changeset is approval-gated."),
      }),
      stderr: "",
    }),
  );

  await compileDefaultRun(application.service, "run-stx-default-changeset", workspaceRoot);
  const pausedArtifact = await application.service.executeApprovedNodes({
    runId: "run-stx-default-changeset",
    actor: "operator",
  });
  const deterministicNode = pausedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const approvalGate = pausedArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === deterministicNode.id);
  const preview = pausedArtifact.plan.stateEffects.find((effect) =>
    effect.kind === "file_set" && effect.targets?.includes("routes/auth.ts"),
  );

  assert.equal(pausedArtifact.plan.status, "paused");
  assert.ok(preview);
  assert.equal(preview.kind, "file_set");
  assert.equal(preview.operation, "changeset");
  assert.deepEqual(preview.targets, ["routes/auth.ts", "routes/verify-email.ts"]);
  assert.equal(preview.effects.length, 2);

  await application.service.submitApprovalAction({
    runId: "run-stx-default-changeset",
    actor: "reviewer",
    action: "approve",
    planVersion: pausedArtifact.planVersion,
    graphVersion: pausedArtifact.graphVersion,
    artifactHash: pausedArtifact.artifactHash,
    gateId: approvalGate.id,
    nodeId: deterministicNode.id,
    nodeRevision: deterministicNode.revision,
  });

  const completedArtifact = await application.service.resumeFromCheckpoint({
    runId: "run-stx-default-changeset",
    actor: "operator",
    checkpointId: pausedArtifact.plan.checkpoints.at(-1).id,
    planVersion: pausedArtifact.planVersion,
    artifactHash: pausedArtifact.artifactHash,
    nodeId: deterministicNode.id,
    nodeRevision: deterministicNode.revision,
  });

  assert.equal(completedArtifact.plan.status, "completed");
  assert.match(
    await readFile(join(workspaceRoot, "routes", "auth.ts"), "utf8"),
    /verifyEmailRoute/,
  );
  assert.equal(
    await readFile(join(workspaceRoot, "routes", "verify-email.ts"), "utf8"),
    "export function verifyEmailRoute() { return true; }\n",
  );
});

test("default STX HTTP flow bootstraps review and applies the approved code change", async (t) => {
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

  application.server.listen(0, "127.0.0.1");
  await once(application.server, "listening");

  const { port } = application.server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const bootstrapResponse = await postJson(`${baseUrl}/runs`, {
    runId: "run-stx-http-happy",
    actor: "browser",
    primaryDirective: "Add email verification to signup.",
    strictBoundaries: [
      "Do not modify billing or payments code paths.",
      "Only touch files inside the current workspace.",
    ],
    successState: "Preview the proposed code change and block invented references before execution.",
  });
  assert.equal(bootstrapResponse.status, 200);
  const pausedArtifact = await bootstrapResponse.json();
  const deterministicNode = pausedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const approvalGate = pausedArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === deterministicNode.id);

  assert.equal(pausedArtifact.plan.status, "paused");
  const authEffect = pausedArtifact.plan.stateEffects.find(
    (effect) => effect.target === join(workspaceRoot, "routes", "auth.ts"),
  );
  assert.ok(authEffect);
  assert.notEqual(authEffect.target, DEFAULT_TARGET_SYMBOL);

  const approvalResponse = await postJson(`${baseUrl}/runs/run-stx-http-happy/approvals`, {
    actor: "reviewer",
    action: "approve",
    planVersion: pausedArtifact.planVersion,
    graphVersion: pausedArtifact.graphVersion,
    artifactHash: pausedArtifact.artifactHash,
    gateId: approvalGate.id,
    nodeId: deterministicNode.id,
    nodeRevision: deterministicNode.revision,
  });
  assert.equal(approvalResponse.status, 200);

  const resumeResponse = await postJson(`${baseUrl}/runs/run-stx-http-happy/resume`, {
    actor: "operator",
    checkpointId: pausedArtifact.plan.checkpoints.at(-1).id,
    planVersion: pausedArtifact.planVersion,
    graphVersion: pausedArtifact.graphVersion,
    artifactHash: pausedArtifact.artifactHash,
    gateId: approvalGate.id,
    nodeId: deterministicNode.id,
    nodeRevision: deterministicNode.revision,
  });
  assert.equal(resumeResponse.status, 200);
  const completedArtifact = await resumeResponse.json();
  const targetContent = await readFile(join(workspaceRoot, "routes", "auth.ts"), "utf8");

  assert.equal(completedArtifact.plan.status, "completed");
  assert.match(targetContent, /const claims = verifyToken\(token\);/);
});
