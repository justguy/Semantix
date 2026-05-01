#!/usr/bin/env node
/**
 * Batch + contradiction JSON probe for the Spec Studio evaluate endpoint.
 *
 * Proves two patterns not covered by the sequential probe:
 *  1. Batch gap presentation — T0 surfaces 3 independent questions in one
 *     nextTurn; T1 answers all three in a single user_turn.
 *  2. Contradiction detection — T2 free text references existing infrastructure
 *     that contradicts the "new system" declaration from T1; the evaluator
 *     raises a contradiction blocker and issues an adversarial reconciliation
 *     question; T3 resolves it and advances to ready.
 *
 * Usage:
 *   npm run probe:spec-studio-batch --workspace packages/stx
 */

import http from "node:http";
import { fileURLToPath } from "node:url";
import { createControlPlaneServer } from "../src/http/server.js";
import { createSemantixHandshakeAdapter } from "../src/spec-studio-handshake.js";
import { createSpecStudioBatchProbeEvaluator } from "../src/spec-studio-batch-probe-evaluator.js";

const SESSION_ID = "sess_batch_probe_001";

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
          try { parsed = JSON.parse(text); }
          catch { parsed = { error: "NON_JSON_RESPONSE", raw: text }; }
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
  const nt = packet.nextTurn;
  let ntDesc = null;
  if (nt) {
    const batchCount = nt.body?.kind === "batch" ? ` [${nt.body.questions?.length ?? 0} questions]` : "";
    ntDesc = `${nt.id} (${nt.phase}, ${nt.body?.kind}${batchCount})`;
  }
  return {
    readiness: packet.readiness,
    iteration: packet.iteration,
    alignmentPct: packet.coverage?.alignmentPct,
    openBlockers: packet.coverage?.openBlockers ?? 0,
    openConcerns: packet.coverage?.openConcerns ?? 0,
    mode: packet.existingSystemContext?.mode,
    findings: (packet.findings ?? []).map((f) => `${f.id}:${f.kind}/${f.sev}(resolved=${f.resolved})`),
    nextTurn: ntDesc,
  };
}

function printTurn(label, packet) {
  const c = compact(packet);
  const findingsStr = c.findings.length ? `\n       findings: ${c.findings.join(", ")}` : "";
  process.stdout.write(
    `[${label}] readiness=${c.readiness} alignmentPct=${c.alignmentPct}% ` +
    `blockers=${c.openBlockers} concerns=${c.openConcerns} mode=${c.mode}${findingsStr}\n` +
    `       nextTurn=${c.nextTurn ?? "null"}\n`,
  );
}

function probeError(message, body) {
  const err = new Error(message);
  err.body = body;
  return err;
}

// ---- server ---------------------------------------------------------------

async function startServer() {
  const server = createControlPlaneServer({
    specStudioAdapter: createSemantixHandshakeAdapter({
      evaluator: createSpecStudioBatchProbeEvaluator(),
    }),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const { port } = server.address();
  return { server, url: `http://127.0.0.1:${port}/spec-studio/evaluate` };
}

// ---- turn -----------------------------------------------------------------

async function turn(label, url, trigger, userTurn, currentPacket) {
  const req = { sessionId: SESSION_ID, trigger, decisions: [], findings: [], contextResponses: [] };
  if (currentPacket) req.currentPacket = currentPacket;
  if (userTurn) req.userTurn = userTurn;

  const res = await postJson(url, req);
  if (res.status !== 200) throw probeError(`[${label}] HTTP ${res.status}`, res.body);
  if (!res.body?.packet || typeof res.body.packet !== "object") {
    throw probeError(`[${label}] missing packet`, res.body);
  }
  printTurn(label, res.body.packet);
  return res.body.packet;
}

// ---- probe ----------------------------------------------------------------

export async function runBatchProbe() {
  const { server, url } = await startServer();
  process.stdout.write(`\nServer: ${url}\n`);
  process.stdout.write(`Session: ${SESSION_ID}\n\n`);

  try {
    // T0: initial → batch of 3 independent questions
    let packet = await turn("T0", url, "initial", null, null);
    assert(packet.nextTurn?.body?.kind === "batch",     "T0: expected batch nextTurn body");
    assert(packet.nextTurn?.body?.questions?.length === 3, "T0: expected 3 batch questions");
    assert(packet.readiness === "needs_user",           "T0: expected needs_user");
    process.stdout.write(`       ^ batch question ids: ${packet.nextTurn.body.questions.map((q) => q.id).join(", ")}\n\n`);

    // T1: answer all 3 batch questions in one user_turn
    packet = await turn("T1", url, "user_turn", {
      id: "turn_batch_001",
      body: {
        kind: "batch",
        answers: [
          { questionId: "Q-SYSTEM-TYPE", kind: "choice", picked: "OPT-NEW",      label: "New system" },
          { questionId: "Q-USER-TYPE",   kind: "choice", picked: "OPT-END-USER", label: "End user"   },
          { questionId: "Q-TIMELINE",    kind: "choice", picked: "OPT-Q2",       label: "Q2 2026"    },
        ],
      },
    }, packet);
    assert(packet.readiness === "needs_user",           "T1: expected needs_user");
    assert(packet.coverage?.alignmentPct === 65,        "T1: expected 65% after batch answers");
    assert(packet.existingSystemContext?.mode === "new", "T1: expected mode=new");
    process.stdout.write(`       ^ 3 answers → alignment jumped from 10% to 65% in one turn\n\n`);

    // T2: free text with contradiction (references existing SAP Finance API)
    packet = await turn("T2", url, "user_turn", {
      id: "turn_batch_002",
      body: {
        kind: "free",
        text: "Users submit expense reports for approval. We'll route approvals through the existing SAP Finance API.",
      },
    }, packet);
    assert(packet.readiness === "needs_user",           "T2: expected needs_user after contradiction");
    assert(packet.coverage?.openBlockers === 1,         "T2: expected 1 blocker from contradiction");
    assert(packet.coverage?.alignmentPct < 65,          "T2: expected alignment regression on contradiction");
    assert(packet.findings?.some((f) => f.kind === "contradiction" && !f.resolved), "T2: expected unresolved contradiction finding");
    assert(packet.nextTurn?.phase === "adversarial",    "T2: expected adversarial phase on contradiction question");
    process.stdout.write(`       ^ contradiction detected: declared mode=new but free text references existing SAP infra\n\n`);

    // T3: reconcile — new app integrating with existing infrastructure
    packet = await turn("T3", url, "user_turn", {
      id: "turn_batch_003",
      body: {
        kind: "choice",
        picked: "OPT-NEW-WITH-INTEGRATION",
        label: "New app that integrates with existing infrastructure",
        questionTurnId: "T-BATCH-Q3",
      },
    }, packet);
    assert(packet.readiness === "ready",                "T3: expected ready");
    assert(packet.coverage?.alignmentPct === 100,       "T3: expected 100%");
    assert(packet.findings?.every((f) => f.resolved),  "T3: expected all findings resolved");
    process.stdout.write(`       ^ contradiction resolved: existingSystemContext.mode → ${packet.existingSystemContext?.mode}\n\n`);

    process.stdout.write(`PROBE PASSED: batch presentation + contradiction detection + resolution.\n`);
    process.stdout.write(`  Requirements captured: ${packet.requirements?.length ?? 0}\n`);
    process.stdout.write(`  Findings resolved: ${packet.findings?.filter((f) => f.resolved).length ?? 0} / ${packet.findings?.length ?? 0}\n`);

    return packet;
  } finally {
    server.close();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// ---- entrypoint -----------------------------------------------------------

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isEntry) {
  runBatchProbe().catch((err) => {
    process.stderr.write(`\nFAIL: ${err.message}\n`);
    if (err.body !== undefined) process.stderr.write(JSON.stringify(err.body, null, 2) + "\n");
    process.exit(1);
  });
}
