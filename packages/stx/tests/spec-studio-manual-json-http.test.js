import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

import { createControlPlaneServer } from "../src/http/server.js";
import { createSemantixHandshakeAdapter } from "../src/spec-studio-handshake.js";
import { isPacketLockable } from "../src/spec-studio-degraded.js";
import {
  DEFAULT_PROBE_URL,
  parseProbeUrl,
  runProbe,
} from "../scripts/probe-spec-studio-json.js";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "spec-studio-manual-json");

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

async function post(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: Number(parsed.port),
      path: parsed.pathname,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(data),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        body: JSON.parse(Buffer.concat(chunks).toString("utf8")),
      }));
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function postRaw(url, rawBody) {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(rawBody);
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: Number(parsed.port),
      path: parsed.pathname,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": data.length,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = null; }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// Helper to start a server and return { url, close }
async function startServer(options = {}) {
  const server = createControlPlaneServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/spec-studio/evaluate`;
  return {
    url,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("initial request without optional arrays returns 200 needs_user packet", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const body = loadFixture("initial.json");
  const res = await post(url, body);

  assert.equal(res.status, 200);
  assert.equal(res.body.packet.sessionId, body.sessionId);
  assert.equal(res.body.packet.readiness, "needs_user");
  assert.ok(res.body.packet.nextTurn, "initial response should have a nextTurn question");
  assert.equal(typeof res.body.packet.coverage.alignmentPct, "number");
});

test("default JSON probe evaluator is deterministic for identical requests", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const body = loadFixture("initial.json");
  const first = await post(url, body);
  const second = await post(url, body);

  assert.equal(first.status, 200);
  assert.deepEqual(second.body, first.body);
});

test("user choice with currentPacket returns 200 ready packet", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const body = loadFixture("choice-turn.json");
  const res = await post(url, body);

  assert.equal(res.status, 200);
  assert.equal(res.body.packet.readiness, "ready");
  assert.equal(res.body.packet.coverage.alignmentPct, 100);
  assert.ok(isPacketLockable(res.body.packet), "ready packet should be lockable");
});

test("free text user turn returns 200 needs_user packet", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const res = await post(url, loadFixture("free-turn.json"));
  assert.equal(res.status, 200);
  assert.equal(res.body.packet.readiness, "needs_user");
});

test("manual probe URL parser defaults and validates CLI args", () => {
  assert.equal(parseProbeUrl([]), DEFAULT_PROBE_URL);
  assert.equal(
    parseProbeUrl(["--url", "http://127.0.0.1:9000/spec-studio/evaluate"]),
    "http://127.0.0.1:9000/spec-studio/evaluate",
  );
  assert.equal(
    parseProbeUrl(["--url=http://127.0.0.1:9001/spec-studio/evaluate"]),
    "http://127.0.0.1:9001/spec-studio/evaluate",
  );
  assert.throws(() => parseProbeUrl(["--url"]), /requires a value/);
  assert.throws(() => parseProbeUrl(["--bad"]), /Unknown argument/);
  assert.throws(
    () => parseProbeUrl(["--url", "http://127.0.0.1:9000/spec-studio/evaluate", "--bad"]),
    /Unknown argument/,
  );
  assert.throws(
    () => parseProbeUrl([
      "--url=http://127.0.0.1:9000/spec-studio/evaluate",
      "--url=http://127.0.0.1:9001/spec-studio/evaluate",
    ]),
    /only be provided once/,
  );
});

test("manual probe runner completes the two-turn HTTP discussion loop", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const result = await runProbe({ url, log: () => {} });

  assert.equal(result.first.packet.readiness, "needs_user");
  assert.equal(result.second.packet.readiness, "ready");
  assert.equal(result.second.packet.coverage.alignmentPct, 100);
});

test("skip trigger returns 200 valid packet", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const res = await post(url, loadFixture("skip-turn.json"));
  assert.equal(res.status, 200);
  assert.ok(["needs_user", "ready", "blocked"].includes(res.body.packet.readiness));
});

test("delegate turn returns 200 valid packet", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const res = await post(url, loadFixture("delegate-turn.json"));
  assert.equal(res.status, 200);
  assert.ok(["needs_user", "ready", "blocked"].includes(res.body.packet.readiness));
});

test("reconsider turn returns 200 valid packet", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const res = await post(url, loadFixture("reconsider-turn.json"));
  assert.equal(res.status, 200);
  assert.ok(["needs_user", "ready", "blocked"].includes(res.body.packet.readiness));
});

test("nested context-response episode returns 200 valid packet", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const res = await post(url, loadFixture("context-response-nested.json"));
  assert.equal(res.status, 200);
  assert.ok(["needs_user", "ready", "blocked"].includes(res.body.packet.readiness));
});

test("malformed request body returns 400", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const res = await post(url, loadFixture("malformed-request.json"));
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "VALIDATION_ERROR");
});

test("invalid JSON body returns 400", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const res = await postRaw(url, "not-json{{{");
  assert.equal(res.status, 400);
});

test("evaluator failure returns 200 with non-lockable degraded packet", async (t) => {
  const brokenAdapter = createSemantixHandshakeAdapter({
    evaluator: () => { throw new Error("Deliberate evaluator failure for test"); },
  });
  const { url, close } = await startServer({ specStudioAdapter: brokenAdapter });
  t.after(close);

  const res = await post(url, { sessionId: "sess_broken", trigger: "initial" });
  assert.equal(res.status, 200);
  assert.equal(res.body.packet.readiness, "needs_user");
  assert.ok(!isPacketLockable(res.body.packet), "degraded packet must not be lockable");
});
