import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexCliConnector } from "../src/connectors/codex-cli-connector.js";

test("builds a non-interactive codex exec invocation with config overrides and isolated CODEX_HOME", async (t) => {
  const codexHome = await mkdtemp(join(tmpdir(), "semantix-codex-home-"));
  const calls = [];
  const connector = new CodexCliConnector({
    command: "codex",
    codexHome,
    model: "gpt-5.2-codex",
    runner: async (payload) => {
      calls.push(payload);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          summary: "ok",
        }),
        stderr: "",
      };
    },
  });

  t.after(async () => {
    await rm(codexHome, { recursive: true, force: true });
  });

  const result = await connector.execute({
    input: JSON.stringify({
      prompt: "Implement the requested task.",
    }),
    cwd: "/workspace/project",
    rawOverrides: {
      model_reasoning_effort: "high",
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "codex");
  assert.deepEqual(calls[0].args.slice(0, 3), ["exec", "--skip-git-repo-check", "-c"]);
  assert.ok(calls[0].args.includes('cwd="/workspace/project"'));
  assert.ok(calls[0].args.includes('approval_policy="never"'));
  assert.ok(calls[0].args.includes('sandbox_mode="workspace-write"'));
  assert.ok(calls[0].args.includes('model="gpt-5.2-codex"'));
  assert.ok(calls[0].args.includes('model_reasoning_effort="high"'));
  assert.equal(calls[0].input, JSON.stringify({ prompt: "Implement the requested task." }));
  assert.equal(calls[0].env.CODEX_HOME, codexHome);
  assert.equal(result.finalJsonObject.summary, "ok");

  const sessionsStat = await stat(join(codexHome, "sessions"));
  assert.ok(sessionsStat.isDirectory());
});

test("captures line-delimited JSON messages before the final stdout payload", async (t) => {
  const codexHome = await mkdtemp(join(tmpdir(), "semantix-codex-home-stream-"));
  const seenJson = [];
  const connector = new CodexCliConnector({
    codexHome,
    runner: async ({ onJsonMessage, onStdoutLine }) => {
      const first = { type: "node.updated", payload: { executionStatus: "running" } };
      onStdoutLine?.(JSON.stringify(first));
      onJsonMessage?.(first);

      return {
        exitCode: 0,
        stdout: JSON.stringify({
          outputSummary: "done",
          checkpoint: {
            reason: "runtime_completed",
          },
        }),
        stderr: "",
      };
    },
  });

  t.after(async () => {
    await rm(codexHome, { recursive: true, force: true });
  });

  const result = await connector.execute({
    input: "hello",
    onJsonMessage: (message) => {
      seenJson.push(message);
    },
  });

  assert.equal(seenJson.length, 1);
  assert.equal(seenJson[0].type, "node.updated");
  assert.equal(result.jsonMessages.length, 1);
  assert.equal(result.finalJsonObject.outputSummary, "done");
});

test("healthCheck uses codex exec --version with the configured CODEX_HOME", async (t) => {
  const codexHome = await mkdtemp(join(tmpdir(), "semantix-codex-home-health-"));
  const calls = [];
  const connector = new CodexCliConnector({
    command: "codex",
    codexHome,
    runner: async (payload) => {
      calls.push(payload);
      return {
        exitCode: 0,
        stdout: "codex-cli-exec 0.122.0\n",
        stderr: "",
      };
    },
  });

  t.after(async () => {
    await rm(codexHome, { recursive: true, force: true });
  });

  const health = await connector.healthCheck();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["exec", "--version"]);
  assert.equal(calls[0].env.CODEX_HOME, codexHome);
  assert.equal(health.healthy, true);
  assert.equal(health.version, "codex-cli-exec 0.122.0");
});
