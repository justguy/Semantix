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

      if (message.method === "turn/interrupt") {
        child.stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              turn: {
                id: message.params.turnId,
                status: "interrupted",
              },
            },
          })}\n`,
        );
      }

      if (message.method === "thread/read") {
        child.stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              thread: {
                id: message.params.threadId,
                preview: "hello",
                status: { type: "idle" },
                turns: [
                  {
                    id: "runtime-turn-1",
                    status: "interrupted",
                  },
                ],
              },
            },
          })}\n`,
        );
      }

      if (message.method === "thread/turns/list") {
        child.stdout.write(
          `${JSON.stringify({
            id: message.id,
            result: {
              data: [
                {
                  id: "runtime-turn-1",
                  status: "interrupted",
                },
              ],
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
  const initializeCall = JSON.parse(harness.calls[1]);
  assert.equal(initializeCall.method, "initialize");
  assert.equal(initializeCall.params.capabilities.experimental, true);
  assert.equal(initializeCall.params.capabilities.experimentalApi, true);
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
  const thread = await connector.readThread({
    threadId: session.runtimeSessionId,
  });
  const turns = await connector.listTurns({
    threadId: session.runtimeSessionId,
  });
  const interrupted = await connector.interruptTurn({
    threadId: session.runtimeSessionId,
    turnId: turn.runtimeTurnId,
  });

  assert.equal(session.runtimeSessionId, "runtime-thread-1");
  assert.equal(turn.runtimeTurnId, "runtime-turn-1");
  assert.equal(thread.id, "runtime-thread-1");
  assert.equal(turns[0].id, "runtime-turn-1");
  assert.equal(interrupted.turn.status, "interrupted");
  assert.ok(notifications.includes("thread/started"));

  const requests = harness.calls.slice(1).map((call) => JSON.parse(call));
  assert.deepEqual(
    requests.find((request) => request.method === "thread/read").params,
    {
      threadId: "runtime-thread-1",
      includeTurns: true,
    },
  );
  assert.deepEqual(
    requests.find((request) => request.method === "thread/turns/list").params,
    {
      threadId: "runtime-thread-1",
    },
  );
  assert.deepEqual(
    requests.find((request) => request.method === "turn/interrupt").params,
    {
      threadId: "runtime-thread-1",
      turnId: "runtime-turn-1",
      expectedTurnId: "runtime-turn-1",
    },
  );
});
