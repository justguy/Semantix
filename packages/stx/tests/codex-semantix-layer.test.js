import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createStxApplication } from "../src/application.js";

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
  assert.equal(flow.steps.find((step) => step.id === 4)?.status, "blocked");
  assert.equal(flow.steps.find((step) => step.id === 7)?.status, "required");
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
