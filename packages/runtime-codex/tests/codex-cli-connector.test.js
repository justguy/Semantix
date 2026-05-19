import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CodexCliConnector } from "../src/connectors/codex-cli-connector.js";

test("CodexCliConnector force-kills a child that ignores abort SIGTERM", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "semantix-codex-abort-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const command = join(dir, "codex-stub");
  await writeFile(
    command,
    [
      "#!/bin/sh",
      "trap '' TERM",
      "printf 'started\\n'",
      "while :; do sleep 1; done",
      "",
    ].join("\n"),
  );
  await chmod(command, 0o755);

  const connector = new CodexCliConnector({
    command,
    cwd: dir,
    env: {},
  });
  const controller = new AbortController();
  const startedAt = Date.now();
  const execution = connector.execute({
    input: "ignored",
    signal: controller.signal,
    abortGraceMs: 25,
    onStdoutLine: (line) => {
      if (line === "started") {
        controller.abort();
      }
    },
  });

  const result = await execution;

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stdout, /started/);
  assert.ok(Date.now() - startedAt < 2000, "abort should not hang indefinitely");
});
