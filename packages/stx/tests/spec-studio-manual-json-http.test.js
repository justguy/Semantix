import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

import { createControlPlaneServer } from "../src/http/server.js";
import { createSemantixHandshakeAdapter } from "../src/spec-studio-handshake.js";
import { createDegradedPacket, isDegradedPacket, isPacketLockable } from "../src/spec-studio-degraded.js";
import { validatePlanningHandoff } from "../src/spec-studio-planning-handoff.js";
import {
  DEFAULT_PROBE_URL,
  isManualProofDegradedOrFallbackPacket,
  parseProbeArgs,
  parseProbeUrl,
  runProbe,
} from "../scripts/probe-spec-studio-json.js";

const testDir = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(testDir, "fixtures", "spec-studio-manual-json");
const planningHandoffFixtureDir = join(testDir, "fixtures", "spec-studio-planning-handoff");

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

function loadPlanningHandoffFixture(name) {
  return JSON.parse(readFileSync(join(planningHandoffFixtureDir, name), "utf8"));
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

async function get(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: Number(parsed.port),
      path: parsed.pathname,
      method: "GET",
      headers: {
        "accept": "application/json",
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

function assertUnavailableDegradedVisibility(res, expected) {
  assert.equal(res.status, 200);
  assert.equal(res.body.packet.source, "semantix");
  assert.equal(res.body.packet.readiness, "needs_user");
  assert.equal(res.body.packet.nextTurn, null);
  assert.equal(res.body.packet.coverage.alignmentPct, 0);
  assert.equal(res.body.packet.requirements.length, 0);
  assert.equal(res.body.contextRequests.length, 0);
  assert.ok(isDegradedPacket(res.body.packet));
  assert.equal(isPacketLockable(res.body.packet), false);

  const findingText = res.body.packet.findings[0].text;
  assert.match(findingText, /live LLM connector/i);
  assert.match(findingText, new RegExp(`trigger="${expected.trigger}"`));
  if (expected.userTurnKind) {
    assert.match(findingText, new RegExp(`userTurn\\.body\\.kind="${expected.userTurnKind}"`));
  }
  if (expected.contextResponseCount !== undefined) {
    assert.match(findingText, new RegExp(`contextResponses=${expected.contextResponseCount}`));
  }

  assert.equal(res.body.events[0].kind, "semantix.unavailable");
  assert.equal(res.body.events[0].payload.reason, findingText);
  assert.equal(res.body.events[0].payload.trigger, expected.trigger);
  assert.equal(res.body.events[0].payload.userTurnKind ?? null, expected.userTurnKind ?? null);
  assert.equal(res.body.events[0].payload.contextResponseCount, expected.contextResponseCount ?? 0);
  return findingText;
}

test("initial request without live connector returns unavailable degraded packet", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const body = loadFixture("initial.json");
  const res = await post(url, body);

  assert.equal(res.status, 200);
  assert.equal(res.body.packet.sessionId, body.sessionId);
  assert.equal(res.body.packet.readiness, "needs_user");
  assert.equal(res.body.packet.nextTurn, null);
  assert.ok(isDegradedPacket(res.body.packet));
  assert.match(res.body.packet.findings[0].text, /requires a live LLM connector/i);
  assert.equal(typeof res.body.packet.coverage.alignmentPct, "number");
});

test("default evaluator never falls back to probe for identical requests", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const body = loadFixture("initial.json");
  const first = await post(url, body);
  const second = await post(url, body);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(isDegradedPacket(first.body.packet), true);
  assert.equal(isDegradedPacket(second.body.packet), true);
  assert.match(first.body.packet.findings[0].text, /no probe or mocked evaluator/i);
  assert.match(second.body.packet.findings[0].text, /no probe or mocked evaluator/i);
});

test("SPEC_STUDIO_EVALUATOR=probe is quarantined from the public server path", async (t) => {
  const previousMode = process.env.SPEC_STUDIO_EVALUATOR;
  process.env.SPEC_STUDIO_EVALUATOR = "probe";
  t.after(() => {
    if (previousMode === undefined) {
      delete process.env.SPEC_STUDIO_EVALUATOR;
    } else {
      process.env.SPEC_STUDIO_EVALUATOR = previousMode;
    }
  });

  const { url, close } = await startServer();
  t.after(close);

  const mode = await get(url.replace("/spec-studio/evaluate", "/spec-studio/mode"));
  assert.deepEqual(mode.body, {
    evaluatorMode: "unavailable",
    ready: false,
  });

  const res = await post(url, loadFixture("initial.json"));
  assert.equal(res.status, 200);
  assert.equal(res.body.packet.source, "semantix");
  assert.equal(res.body.packet.nextTurn, null);
  assert.equal(isDegradedPacket(res.body.packet), true);
  assert.match(res.body.packet.findings[0].text, /fixture-only/i);
  assert.doesNotMatch(res.body.packet.findings[0].text, /Product goal fixture/i);
  assert.equal(res.body.events[0].kind, "semantix.unavailable");
});

test("planning handoff endpoint compiles locked packet inputs", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const res = await post(url.replace("/spec-studio/evaluate", "/spec-studio/planning-handoff"), {
    packet: loadPlanningHandoffFixture("greenfield-minimal.packet.json"),
    lockedArtifact: loadPlanningHandoffFixture("greenfield-minimal.locked-artifact.json"),
    auditState: loadPlanningHandoffFixture("greenfield-minimal.audit-state.json"),
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.summary.valid, true);
  assert.equal(res.body.summary.byteIdentical, true);
  assert.equal(res.body.handoff.handoffId, res.body.summary.handoffId);
  assert.equal(validatePlanningHandoff(res.body.handoff).ok, true);
});

test("user choice without live connector returns unavailable degraded packet", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const body = loadFixture("choice-turn.json");
  const res = await post(url, body);

  assert.equal(res.status, 200);
  assert.equal(res.body.packet.readiness, "needs_user");
  assert.ok(isDegradedPacket(res.body.packet));
  assert.equal(isPacketLockable(res.body.packet), false);
});

test("free text user turn without live connector returns unavailable degraded packet", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const res = await post(url, loadFixture("free-turn.json"));
  assert.equal(res.status, 200);
  assert.equal(res.body.packet.readiness, "needs_user");
  assert.ok(isDegradedPacket(res.body.packet));
});

test("manual probe URL parser defaults and validates CLI args", () => {
  assert.equal(parseProbeUrl([]), DEFAULT_PROBE_URL);
  assert.deepEqual(parseProbeArgs(["--mode", "llm"]), {
    url: DEFAULT_PROBE_URL,
    mode: "llm",
  });
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

test("manual proof degraded/fallback predicate rejects non-live packets", () => {
  assert.equal(
    isManualProofDegradedOrFallbackPacket({
      source: "phalanx-degraded",
      readiness: "needs_user",
    }),
    true,
  );
  assert.equal(
    isManualProofDegradedOrFallbackPacket(createDegradedPacket({
      sessionId: "spec_manual_predicate_degraded",
      reason: "Manual proof negative test degraded packet.",
    })),
    true,
  );
});

test("manual probe runner fails closed against unavailable server", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  await assert.rejects(
    () => runProbe({ url, log: () => {} }),
    /expected evaluatorMode="probe" but server reports "unavailable"/,
  );
});

test("manual probe runner fails closed when expected evaluator mode does not match server", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  await assert.rejects(
    () => runProbe({ url, mode: "llm", log: () => {} }),
    /expected evaluatorMode="llm" but server reports "unavailable"/,
  );
});

test("manual probe runner fails closed on Semantix degraded packet success", async (t) => {
  const degradedAdapter = {
    evaluatorMode: "probe",
    evaluate: async (request) => ({
      packet: createDegradedPacket({
        sessionId: request.sessionId,
        reason: "Manual proof negative test degraded packet.",
      }),
      events: [],
      contextRequests: [],
    }),
  };
  const { url, close } = await startServer({ specStudioAdapter: degradedAdapter });
  t.after(close);

  await assert.rejects(
    () => runProbe({ url, log: () => {} }),
    /initial response is degraded and cannot prove live readiness/,
  );
});

test("manual probe runner fails closed on Phalanx fallback packet success", async (t) => {
  const fallbackAdapter = {
    evaluatorMode: "probe",
    evaluate: async (request) => ({
      packet: {
        source: "phalanx-degraded",
        sessionId: request.sessionId,
        iteration: 0,
        readiness: "needs_user",
        coverage: { alignmentPct: 0 },
        findings: [],
      },
      events: [],
      contextRequests: [],
    }),
  };
  const { url, close } = await startServer({ specStudioAdapter: fallbackAdapter });
  t.after(close);

  await assert.rejects(
    () => runProbe({ url, log: () => {} }),
    /initial response used fallback source "phalanx-degraded"/,
  );
});

test("server reports unavailable instead of falling back to probe when no connector exists", async (t) => {
  const previousMode = process.env.SPEC_STUDIO_EVALUATOR;
  process.env.SPEC_STUDIO_EVALUATOR = "llm";
  t.after(() => {
    if (previousMode === undefined) {
      delete process.env.SPEC_STUDIO_EVALUATOR;
    } else {
      process.env.SPEC_STUDIO_EVALUATOR = previousMode;
    }
  });

  const { url, close } = await startServer();
  t.after(close);

  const modeUrl = url.replace("/spec-studio/evaluate", "/spec-studio/mode");
  const mode = await get(modeUrl);
  assert.equal(mode.status, 200);
  assert.deepEqual(mode.body, {
    evaluatorMode: "unavailable",
    ready: false,
  });

  const res = await post(url, loadFixture("initial.json"));
  assert.equal(res.status, 200);
  assert.equal(res.body.packet.readiness, "needs_user");
  assert.match(res.body.packet.findings[0].text, /live LLM connector/i);
});

test("llm evaluate endpoint degrades empty initial request without calling connector", async (t) => {
  const previousMode = process.env.SPEC_STUDIO_EVALUATOR;
  process.env.SPEC_STUDIO_EVALUATOR = "llm";
  t.after(() => {
    if (previousMode === undefined) {
      delete process.env.SPEC_STUDIO_EVALUATOR;
    } else {
      process.env.SPEC_STUDIO_EVALUATOR = previousMode;
    }
  });

  let calls = 0;
  const connector = {
    execute: async () => {
      calls += 1;
      return { exitCode: 0, stdout: "", stderr: "" };
    },
  };
  const { url, close } = await startServer({ connector });
  t.after(close);

  const res = await post(url, {
    sessionId: "spec_http_empty_initial",
    trigger: "initial",
    originalUserRequest: "",
    userTurn: {
      id: "u1",
      body: { kind: "text", text: "   " },
    },
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.equal(res.status, 200);
  assert.equal(calls, 0);
  assert.equal(res.body.packet.readiness, "needs_user");
  assert.equal(res.body.packet.nextTurn, null);
  assert.equal(res.body.packet.findings[0].id, "F-DEGRADED-001");
  assert.match(res.body.packet.findings[0].text, /initial request is empty/i);
  assert.equal(res.body.events[0].kind, "llm.evaluator.degraded");
});

test("llm evaluate endpoint degrades instead of mocking when connector stdout is empty", async (t) => {
  const previousMode = process.env.SPEC_STUDIO_EVALUATOR;
  process.env.SPEC_STUDIO_EVALUATOR = "llm";
  t.after(() => {
    if (previousMode === undefined) {
      delete process.env.SPEC_STUDIO_EVALUATOR;
    } else {
      process.env.SPEC_STUDIO_EVALUATOR = previousMode;
    }
  });

  const connector = {
    execute: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
  };
  const { url, close } = await startServer({ connector });
  t.after(close);

  const res = await post(url, {
    sessionId: "spec_http_empty_output_fallback",
    trigger: "initial",
    userTurn: {
      id: "u1",
      body: { kind: "text", text: "Build a notes app." },
    },
    decisions: [],
    findings: [],
    contextResponses: [],
  });

  assert.equal(res.status, 200);
  assert.equal(res.body.packet.readiness, "needs_user");
  assert.equal(res.body.packet.originalUserRequest, "Build a notes app.");
  assert.ok(isDegradedPacket(res.body.packet), "empty LLM output must not be replaced by a probe packet");
  assert.ok(
    res.body.packet.findings.some((finding) => /LLM evaluator returned empty output/i.test(finding.text)),
  );
  assert.equal(res.body.events[0].kind, "llm.evaluator.degraded");
  assert.equal(res.body.llmResponses.length, 2);
  assert.equal(res.body.llmResponses[0].stdout, "");
  assert.equal(res.body.llmResponses[0].rawText, "");
});

test("manual HTTP trigger flows expose trigger-specific degraded visibility", async (t) => {
  const { url, close } = await startServer();
  t.after(close);

  const cases = [
    {
      fixture: "skip-turn.json",
      trigger: "skip",
    },
    {
      fixture: "delegate-turn.json",
      trigger: "user_turn",
      userTurnKind: "delegate",
    },
    {
      fixture: "reconsider-turn.json",
      trigger: "reconsider",
      userTurnKind: "reconsider",
    },
    {
      fixture: "context-response-nested.json",
      trigger: "context_response",
      contextResponseCount: 1,
    },
  ];
  const visibleReasons = new Set();
  for (const entry of cases) {
    const res = await post(url, loadFixture(entry.fixture));
    visibleReasons.add(assertUnavailableDegradedVisibility(res, entry));
  }
  assert.equal(visibleReasons.size, cases.length);
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
  assert.equal(res.body.packet.source, "semantix");
  assert.equal(res.body.packet.nextTurn, null);
  assert.equal(res.body.packet.coverage.alignmentPct, 0);
  assert.equal(res.body.packet.requirements.length, 0);
  assert.ok(isDegradedPacket(res.body.packet));
  assert.match(res.body.packet.findings[0].text, /Deliberate evaluator failure for test/);
  assert.equal(res.body.events[0].kind, "semantix.degraded");
  assert.match(res.body.events[0].payload.reason, /Deliberate evaluator failure for test/);
  assert.ok(!isPacketLockable(res.body.packet), "degraded packet must not be lockable");
});
