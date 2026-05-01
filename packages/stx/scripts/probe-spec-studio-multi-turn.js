#!/usr/bin/env node
/**
 * Multi-turn JSON probe for the Spec Studio evaluate endpoint.
 *
 * Runs a 6-turn session (initial → choice × 2 → free → skip → choice-defer)
 * against a local server that uses the multi-turn probe evaluator. The probe
 * starts its own in-process server on an OS-assigned port, so no running
 * instance is required.
 *
 * Usage:
 *   npm run probe:spec-studio-multi-turn --workspace packages/stx
 */

import http from "node:http";
import { fileURLToPath } from "node:url";
import { createControlPlaneServer } from "../src/http/server.js";
import { createSemantixHandshakeAdapter } from "../src/spec-studio-handshake.js";
import { createSpecStudioMultiTurnProbeEvaluator } from "../src/spec-studio-multi-turn-probe-evaluator.js";

const SESSION_ID = "sess_mt_probe_001";
const ORIGINAL_REQUEST = "Build an expense reporting app";

// ---- transport ------------------------------------------------------------

async function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : undefined,
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(data),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed;
          try {
            parsed = JSON.parse(text);
          } catch {
            parsed = { error: "NON_JSON_RESPONSE", raw: text };
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ---- formatting -----------------------------------------------------------

function compact(packet) {
  return {
    readiness: packet.readiness,
    iteration: packet.iteration,
    alignmentPct: packet.coverage?.alignmentPct,
    openBlockers: packet.coverage?.openBlockers ?? 0,
    openConcerns: packet.coverage?.openConcerns ?? 0,
    nextTurn: packet.nextTurn
      ? `${packet.nextTurn.id} (${packet.nextTurn.phase}, target:${packet.nextTurn.target})`
      : null,
    mode: packet.existingSystemContext?.mode,
    findingCount: packet.findings?.length ?? 0,
  };
}

function probeError(message, body) {
  const err = new Error(message);
  err.body = body;
  return err;
}

// ---- server lifecycle -----------------------------------------------------

async function startServer() {
  const adapter = createSemantixHandshakeAdapter({
    evaluator: createSpecStudioMultiTurnProbeEvaluator(),
  });
  const server = createControlPlaneServer({ specStudioAdapter: adapter });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/spec-studio/evaluate` };
}

// ---- turn helpers ---------------------------------------------------------

function buildRequest(trigger, userTurn, currentPacket) {
  const req = {
    sessionId: SESSION_ID,
    trigger,
    decisions: [],
    findings: [],
    contextResponses: [],
  };
  if (currentPacket) req.currentPacket = currentPacket;
  if (userTurn) req.userTurn = userTurn;
  return req;
}

async function turn(label, url, trigger, userTurn, currentPacket) {
  const req = buildRequest(trigger, userTurn, currentPacket);
  const res = await postJson(url, req);

  if (res.status !== 200) {
    throw probeError(`[${label}] HTTP ${res.status}`, res.body);
  }
  if (!res.body?.packet || typeof res.body.packet !== "object") {
    throw probeError(`[${label}] response missing packet`, res.body);
  }

  const c = compact(res.body.packet);
  process.stdout.write(
    `[${label}] trigger=${trigger} → readiness=${c.readiness} alignmentPct=${c.alignmentPct}% ` +
    `blockers=${c.openBlockers} concerns=${c.openConcerns} mode=${c.mode} findings=${c.findingCount}\n` +
    `       nextTurn=${c.nextTurn ?? "null"}\n`,
  );

  return res.body.packet;
}

// ---- probe ----------------------------------------------------------------

export async function runMultiTurnProbe({ log = process.stdout.write.bind(process.stdout) } = {}) {
  const { server, url } = await startServer();
  const { port } = server.address();
  process.stdout.write(`\nServer started on port ${port}\n`);
  process.stdout.write(`Endpoint: ${url}\n\n`);
  process.stdout.write(`Session: ${SESSION_ID}\n`);
  process.stdout.write(`Request: "${ORIGINAL_REQUEST}"\n\n`);

  try {
    // Turn 0: initial → needs_user (Q1: new vs update)
    let packet = await turn("T0", url, "initial", null, null);
    assertReadiness(packet, "needs_user", "T0");
    assertNextTurn(packet, "T-MT-Q1", "T0");

    // Turn 1: choice OPT-NEW → needs_user (Q2: user type)
    packet = await turn("T1", url, "user_turn",
      { id: "turn_mt_001", body: { kind: "choice", picked: "OPT-NEW", label: "New system", questionTurnId: "T-MT-Q1" } },
      packet,
    );
    assertReadiness(packet, "needs_user", "T1");
    assertNextTurn(packet, "T-MT-Q2", "T1");
    assertMode(packet, "new", "T1");

    // Turn 2: choice OPT-END-USER → needs_user (Q3: core action, free text)
    packet = await turn("T2", url, "user_turn",
      { id: "turn_mt_002", body: { kind: "choice", picked: "OPT-END-USER", label: "End user", questionTurnId: "T-MT-Q2" } },
      packet,
    );
    assertReadiness(packet, "needs_user", "T2");
    assertNextTurn(packet, "T-MT-Q3", "T2");

    // Turn 3: free text → needs_user (Q4: auth)
    packet = await turn("T3", url, "user_turn",
      { id: "turn_mt_003", body: { kind: "free", text: "Users need to submit expense reports and track approval status." } },
      packet,
    );
    assertReadiness(packet, "needs_user", "T3");
    assertNextTurn(packet, "T-MT-Q4", "T3");

    // Turn 4: skip auth → needs_user (Q5: confirm defer, blocker raised)
    packet = await turn("T4", url, "skip", null, packet);
    assertReadiness(packet, "needs_user", "T4");
    assertNextTurn(packet, "T-MT-Q5", "T4");
    if ((packet.coverage?.openBlockers ?? 0) !== 1) {
      throw probeError(`T4: expected 1 open blocker, got ${packet.coverage?.openBlockers}`, packet);
    }

    // Turn 5: confirm defer → ready
    packet = await turn("T5", url, "user_turn",
      { id: "turn_mt_005", body: { kind: "choice", picked: "OPT-DEFER-CONFIRM", label: "Confirmed — defer auth to a later sprint", questionTurnId: "T-MT-Q5" } },
      packet,
    );
    assertReadiness(packet, "ready", "T5");
    assertAlignmentPct(packet, 100, "T5");

    const reqCount = packet.requirements?.length ?? 0;
    process.stdout.write(`\nPROBE PASSED: 6-turn multi-gap discussion loop completed.\n`);
    process.stdout.write(`  Turns: initial → choice × 2 → free → skip → confirm-defer → ready\n`);
    process.stdout.write(`  Requirements captured: ${reqCount}\n`);
    process.stdout.write(`  Findings resolved: ${packet.findings?.filter(f => f.resolved).length ?? 0}\n`);

    return packet;
  } finally {
    server.close();
  }
}

// ---- assertions -----------------------------------------------------------

function assertReadiness(packet, expected, label) {
  if (packet.readiness !== expected) {
    throw probeError(`${label}: expected readiness="${expected}", got "${packet.readiness}"`, packet);
  }
}

function assertNextTurn(packet, expectedId, label) {
  if (packet.nextTurn?.id !== expectedId) {
    throw probeError(`${label}: expected nextTurn.id="${expectedId}", got "${packet.nextTurn?.id}"`, packet);
  }
}

function assertMode(packet, expected, label) {
  const got = packet.existingSystemContext?.mode;
  if (got !== expected) {
    throw probeError(`${label}: expected mode="${expected}", got "${got}"`, packet);
  }
}

function assertAlignmentPct(packet, expected, label) {
  const got = packet.coverage?.alignmentPct;
  if (got !== expected) {
    throw probeError(`${label}: expected alignmentPct=${expected}, got ${got}`, packet);
  }
}

// ---- entrypoint -----------------------------------------------------------

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntry) {
  runMultiTurnProbe().catch((err) => {
    process.stderr.write(`\nFAIL: ${err.message}\n`);
    if (err.body !== undefined) {
      process.stderr.write(JSON.stringify(err.body, null, 2) + "\n");
    }
    process.exit(1);
  });
}
