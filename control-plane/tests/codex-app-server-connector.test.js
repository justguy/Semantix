import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { CodexAppServerConnector } from "../src/connectors/codex-app-server-connector.js";

function createFakeSpawnHarness() {
  const calls = [];
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit("close", 0, null);
  };

  child.stdin = {
    destroyed: false,
    write(chunk, callback) {
      const text = chunk.toString("utf8").trim();
      calls.push(text);
      const message = JSON.parse(text);

      if (message.method === "initialize") {
        child.stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              userAgent: "fake-codex",
              codexHome: "/tmp/fake-codex-home",
              platformFamily: "unix",
              platformOs: "macos",
            },
          })}\n`,
        );
      }

      if (message.method === "thread/start") {
        child.stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              thread: {
                id: "runtime-thread-1",
                preview: "",
                status: { type: "idle" },
                turns: [],
              },
              approvalPolicy: "never",
            },
          })}\n`,
        );
        child.stdout.write(
          `${JSON.stringify({
            method: "thread/started",
            params: {
              thread: {
                id: "runtime-thread-1",
                preview: "",
                status: { type: "idle" },
                turns: [],
              },
            },
          })}\n`,
        );
      }

      if (message.method === "turn/start") {
        child.stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              turn: {
                id: "runtime-turn-1",
                status: "inProgress",
                items: [],
              },
            },
          })}\n`,
        );
      }

      callback?.();
    },
  };

  return {
    calls,
    spawnProcess(command, args, options) {
      calls.push(JSON.stringify({ command, args, options }));
      return child;
    },
  };
}

test("starts the Codex app-server with config overrides and initializes JSON-RPC", async () => {
  const harness = createFakeSpawnHarness();
  const connector = new CodexAppServerConnector({
    spawnProcess: harness.spawnProcess,
    command: "codex",
    cwd: "/workspace/project",
    codexHome: "/tmp/fake-codex-home",
    approvalPolicy: "never",
    sandboxMode: "workspace-write",
  });

  const health = await connector.healthCheck();
  const spawnCall = JSON.parse(harness.calls[0]);

  assert.equal(spawnCall.command, "codex");
  assert.ok(spawnCall.args.includes("app-server"));
  assert.ok(spawnCall.args.includes('approval_policy="never"'));
  assert.ok(spawnCall.args.includes('sandbox_mode="workspace-write"'));
  assert.equal(health.healthy, true);
  assert.equal(health.transport, "app-server-jsonrpc");
});

test("creates threads, submits turns, and emits app-server notifications", async () => {
  const harness = createFakeSpawnHarness();
  const connector = new CodexAppServerConnector({
    spawnProcess: harness.spawnProcess,
    command: "codex",
    cwd: "/workspace/project",
    codexHome: "/tmp/fake-codex-home",
  });
  const notifications = [];
  connector.onNotification((message) => {
    notifications.push(message.method);
  });

  const session = await connector.startThread();
  const turn = await connector.startTurn({
    threadId: session.runtimeSessionId,
    input: [{ type: "text", text: "hello", text_elements: [] }],
  });

  assert.equal(session.runtimeSessionId, "runtime-thread-1");
  assert.equal(turn.runtimeTurnId, "runtime-turn-1");
  assert.ok(notifications.includes("thread/started"));
});
