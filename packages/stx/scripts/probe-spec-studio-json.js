#!/usr/bin/env node
/**
 * Manual JSON probe for the Spec Studio evaluate endpoint.
 * POSTs initial.json, captures the packet, then POSTs choice-turn.json.
 * Exits 0 on valid two-turn sequence, nonzero on failure.
 *
 * Usage:
 *   npm run probe:spec-studio-json --workspace packages/stx -- --url http://127.0.0.1:4401/spec-studio/evaluate
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import http from "node:http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "..", "tests", "fixtures", "spec-studio-manual-json");
export const DEFAULT_PROBE_URL = "http://127.0.0.1:4401/spec-studio/evaluate";

export function parseProbeArgs(args = process.argv.slice(2)) {
  let url = null;
  let mode = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--url") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--url requires a value.");
      }
      if (url) {
        throw new Error("--url may only be provided once.");
      }
      url = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--url=")) {
      const value = arg.slice("--url=".length);
      if (!value) {
        throw new Error("--url requires a value.");
      }
      if (url) {
        throw new Error("--url may only be provided once.");
      }
      url = value;
      continue;
    }
    if (arg === "--mode") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--mode requires a value (probe or llm).");
      }
      if (!["probe", "llm"].includes(value)) {
        throw new Error(`--mode must be "probe" or "llm", got "${value}".`);
      }
      mode = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--mode=")) {
      const value = arg.slice("--mode=".length);
      if (!["probe", "llm"].includes(value)) {
        throw new Error(`--mode must be "probe" or "llm", got "${value}".`);
      }
      mode = value;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log([
        "Usage: probe-spec-studio-json.js [options]",
        "",
        "Options:",
        "  --url <url>        Spec Studio evaluate endpoint (default: http://127.0.0.1:4401/spec-studio/evaluate)",
        "  --mode probe|llm   Expected evaluator mode. When --mode llm, the probe checks GET /spec-studio/mode first.",
        "  --help             Show this help message.",
      ].join("\n"));
      process.exit(0);
    }
    throw new Error(`Unknown argument "${arg}".`);
  }
  return { url: url ?? DEFAULT_PROBE_URL, mode: mode ?? "probe" };
}

export function parseProbeUrl(args = process.argv.slice(2)) {
  return parseProbeArgs(args).url;
}

function loadFixture(name) {
  return JSON.parse(readFileSync(join(fixtureDir, name), "utf8"));
}

async function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": Buffer.byteLength(data),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let body;
        try {
          body = JSON.parse(text);
        } catch {
          body = { error: "NON_JSON_RESPONSE", message: text };
        }
        resolve({ status: res.statusCode, body });
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function compact(packet) {
  return {
    readiness: packet.readiness,
    source: packet.source,
    iteration: packet.iteration,
    nextTurn: packet.nextTurn ? `${packet.nextTurn.id} (${packet.nextTurn.phase ?? "?"})` : null,
    alignmentPct: packet.coverage?.alignmentPct,
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function probeError(message, body) {
  const error = new Error(message);
  error.body = body;
  return error;
}

async function getJson(url) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : undefined,
      path: `${parsed.pathname}${parsed.search}`,
      method: "GET",
      headers: { "accept": "application/json" },
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
        } catch {
          resolve({ status: res.statusCode, body: null });
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

export async function runProbe({
  url = DEFAULT_PROBE_URL,
  mode = "probe",
  log = console.log,
} = {}) {
  log(`Probing: ${url} (expected mode: ${mode})`);

  // Check evaluator mode when --mode is specified
  const baseUrl = url.replace(/\/spec-studio\/evaluate.*$/, "");
  const modeUrl = `${baseUrl}/spec-studio/mode`;
  try {
    const modeResult = await getJson(modeUrl);
    if (modeResult.status === 200 && modeResult.body) {
      const serverMode = modeResult.body.evaluatorMode ?? "unknown";
      log(`[mode] server evaluatorMode: ${serverMode}, ready: ${modeResult.body.ready}`);
      if (serverMode !== mode) {
        throw probeError(
          `expected evaluatorMode="${mode}" but server reports "${serverMode}"`,
          modeResult.body,
        );
      }
    }
  } catch (error) {
    if (error?.body !== undefined) {
      throw error;
    }
    throw probeError(
      `could not verify evaluator mode at ${modeUrl}`,
      { error: "MODE_CHECK_FAILED", message: error?.message ?? String(error) },
    );
  }

  const initial = loadFixture("initial.json");
  log("\n[1] POST initial.json");
  const r1 = await postJson(url, initial);
  if (r1.status !== 200) {
    throw probeError(`initial returned HTTP ${r1.status}`, r1.body);
  }
  const packet1 = r1.body.packet;
  if (!isObject(packet1)) {
    throw probeError("initial response did not include packet", r1.body);
  }
  log("    ->", JSON.stringify(compact(packet1)));

  const choice = loadFixture("choice-turn.json");
  choice.currentPacket = packet1;
  choice.sessionId = packet1.sessionId;
  log("\n[2] POST choice-turn.json (with captured currentPacket)");
  const r2 = await postJson(url, choice);
  if (r2.status !== 200) {
    throw probeError(`choice-turn returned HTTP ${r2.status}`, r2.body);
  }
  const packet2 = r2.body.packet;
  if (!isObject(packet2)) {
    throw probeError("choice-turn response did not include packet", r2.body);
  }
  log("    ->", JSON.stringify(compact(packet2)));

  if (!["needs_user", "ready", "blocked"].includes(packet2.readiness)) {
    throw probeError(`unexpected readiness "${packet2.readiness}"`, r2.body);
  }
  if (packet2.source !== "semantix" && packet2.source !== "phalanx-degraded") {
    throw probeError(`unexpected source "${packet2.source}"`, r2.body);
  }

  log("\nPROBE PASSED: two-turn JSON discussion loop completed.");
  if (packet2.readiness === "ready") {
    log("  Discussion reached ready state.");
  } else {
    log(`  Discussion is ${packet2.readiness} (probe still verifies transport).`);
  }

  return { first: r1.body, second: r2.body };
}

async function main() {
  const { url, mode } = parseProbeArgs();
  await runProbe({ url, mode });
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (entryPath) {
  main().catch((error) => {
    console.error(`FAIL: ${error.message}`);
    if (error.body !== undefined) {
      console.error(JSON.stringify(error.body, null, 2));
    }
    process.exit(1);
  });
}
