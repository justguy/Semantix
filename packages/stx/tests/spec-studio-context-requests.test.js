import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  CONTEXT_REQUEST_PURPOSE,
  createContextRequest,
  createContextRequestSequencer,
  planContextRequests,
  requestCollectHoplonEvidence,
  requestFindConstraints,
  requestFindExistingFlow,
  requestFindReusableComponent,
  requestIdentifyTargetSurface,
  requestInspectReferenceArtifact,
  requestSummarizeCurrentBehavior,
} from "../src/spec-studio-context-requests.js";

import {
  CONTEXT_REQUEST_PURPOSE_VALUES,
  validateSemantixContextRequest,
} from "../src/spec-studio-contracts.js";

import {
  ambiguousNeedsUserPacket,
  greenfieldReadyPacket,
  hoplonGroundedPacket,
  updateReadyPacket,
} from "./fixtures/spec-studio-samples.js";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---- Constants -----------------------------------------------------------

test("CONTEXT_REQUEST_PURPOSE exposes every contract purpose", () => {
  for (const purpose of CONTEXT_REQUEST_PURPOSE_VALUES) {
    assert.ok(
      Object.values(CONTEXT_REQUEST_PURPOSE).includes(purpose),
      `CONTEXT_REQUEST_PURPOSE missing ${purpose}`,
    );
  }
});

// ---- createContextRequest --------------------------------------------------

test("createContextRequest builds a validating context request", () => {
  const req = createContextRequest({
    id: "CTX-001",
    sessionId: "spec_a",
    iteration: 2,
    purpose: "identify_target_surface",
    query: "Find the existing run dashboard surface",
    reason: "User asked about the run dashboard.",
  });
  const result = validateSemantixContextRequest(req);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.ok(req.requestedFrom.includes("phalanx"));
});

test("createContextRequest applies default sources per purpose", () => {
  const req = createContextRequest({
    id: "CTX-002",
    sessionId: "spec_a",
    iteration: 1,
    purpose: "find_existing_flow",
    query: "find flow",
    reason: "needed",
  });
  assert.deepEqual(req.requestedFrom.sort(), ["phalanx", "repo"].sort());
});

test("createContextRequest deduplicates and sanitizes requestedFrom", () => {
  const req = createContextRequest({
    id: "CTX-003",
    sessionId: "spec_a",
    iteration: 1,
    purpose: "collect_hoplon_evidence",
    query: "collect evidence",
    reason: "needed",
    requestedFrom: ["phalanx", "phalanx", "hoplon", "rumor"],
  });
  assert.deepEqual(req.requestedFrom.sort(), ["hoplon", "phalanx"]);
});

test("createContextRequest sets mustReturnEvidenceRefs for evidence-needing purposes", () => {
  const req = createContextRequest({
    id: "CTX-004",
    sessionId: "spec_a",
    iteration: 1,
    purpose: "collect_hoplon_evidence",
    query: "collect evidence",
    reason: "needed",
  });
  assert.equal(req.constraints.mustReturnEvidenceRefs, true);
});

test("createContextRequest preserves explicit allowedSources/maxResults", () => {
  const req = createContextRequest({
    id: "CTX-005",
    sessionId: "spec_a",
    iteration: 1,
    purpose: "identify_target_surface",
    query: "identify",
    reason: "needed",
    constraints: {
      allowedSources: ["phalanx", "repo"],
      maxResults: 5,
      targetRepo: "Project-Phalanx",
    },
  });
  assert.deepEqual(req.constraints.allowedSources, ["phalanx", "repo"]);
  assert.equal(req.constraints.maxResults, 5);
  assert.equal(req.constraints.targetRepo, "Project-Phalanx");
});

test("createContextRequest rejects malformed input", () => {
  assert.throws(
    () =>
      createContextRequest({
        sessionId: "spec_a",
        iteration: 1,
        purpose: "identify_target_surface",
        query: "ok",
        reason: "ok",
      }),
    (error) => error.name === "ValidationError",
  );
});

// ---- Per-purpose helpers ---------------------------------------------------

test("requestIdentifyTargetSurface produces a validated request", () => {
  const sequencer = createContextRequestSequencer({ sessionId: "spec_a", iteration: 1 });
  const req = requestIdentifyTargetSurface({
    sequencer,
    query: "identify",
    reason: "test",
  });
  assert.equal(req.purpose, "identify_target_surface");
  assert.equal(req.sessionId, "spec_a");
  assert.match(req.id, /^CTX-001$/);
});

test("requestSummarizeCurrentBehavior includes evidence requirement by default", () => {
  const req = requestSummarizeCurrentBehavior({
    id: "CTX-200",
    sessionId: "spec_a",
    iteration: 1,
    query: "summarize current behavior",
    reason: "needed",
  });
  assert.equal(req.purpose, "summarize_current_behavior");
  assert.equal(req.constraints.mustReturnEvidenceRefs, true);
});

test("requestFindExistingFlow defaults to phalanx + repo", () => {
  const req = requestFindExistingFlow({
    id: "CTX-201",
    sessionId: "spec_a",
    iteration: 1,
    query: "find flow",
    reason: "needed",
  });
  assert.deepEqual(req.requestedFrom.sort(), ["phalanx", "repo"]);
});

test("requestFindReusableComponent enables evidence requirement", () => {
  const req = requestFindReusableComponent({
    id: "CTX-202",
    sessionId: "spec_a",
    iteration: 1,
    query: "find component",
    reason: "needed",
  });
  assert.equal(req.constraints.mustReturnEvidenceRefs, true);
});

test("requestFindConstraints uses phalanx/repo/hoplon", () => {
  const req = requestFindConstraints({
    id: "CTX-203",
    sessionId: "spec_a",
    iteration: 1,
    query: "find constraints",
    reason: "needed",
  });
  assert.ok(req.requestedFrom.includes("phalanx"));
  assert.ok(req.requestedFrom.includes("hoplon"));
});

test("requestCollectHoplonEvidence routes through phalanx broker", () => {
  const req = requestCollectHoplonEvidence({
    id: "CTX-204",
    sessionId: "spec_a",
    iteration: 1,
    query: "collect evidence",
    reason: "needed",
  });
  assert.deepEqual(req.requestedFrom.sort(), ["hoplon", "phalanx"]);
  assert.equal(req.constraints.mustReturnEvidenceRefs, true);
});

test("requestInspectReferenceArtifact targets uploads", () => {
  const req = requestInspectReferenceArtifact({
    id: "CTX-205",
    sessionId: "spec_a",
    iteration: 1,
    query: "inspect artifact",
    reason: "user uploaded screenshot",
  });
  assert.deepEqual(req.requestedFrom.sort(), ["phalanx", "upload"]);
});

test("helper requires either an explicit id or a sequencer", () => {
  assert.throws(
    () => requestIdentifyTargetSurface({ sessionId: "spec", query: "x", reason: "y" }),
    (error) => error.name === "ValidationError",
  );
});

// ---- Sequencer ------------------------------------------------------------

test("createContextRequestSequencer mints stable padded ids", () => {
  const sequencer = createContextRequestSequencer({ sessionId: "spec_a" });
  assert.equal(sequencer.next(), "CTX-001");
  assert.equal(sequencer.next(), "CTX-002");
  assert.equal(sequencer.next(), "CTX-003");
});

test("createContextRequestSequencer accepts a custom prefix and start", () => {
  const sequencer = createContextRequestSequencer({
    sessionId: "spec_a",
    prefix: "RM-",
    start: 9,
  });
  assert.equal(sequencer.next(), "RM-010");
});

// ---- planContextRequests -------------------------------------------------

test("planContextRequests emits identify_target_surface for ambiguous mode", () => {
  const requests = planContextRequests({ packet: ambiguousNeedsUserPacket });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].purpose, "identify_target_surface");
  assert.match(requests[0].reason, /mode is unknown/i);
});

test("planContextRequests emits target-surface request when update mode lacks targetSurfaces", () => {
  const packet = deepClone(updateReadyPacket);
  packet.existingSystemContext.targetSurfaces = [];
  const requests = planContextRequests({ packet });
  assert.equal(requests[0].purpose, "identify_target_surface");
  assert.match(requests[0].reason, /Update mode without targetSurfaces/i);
});

test("planContextRequests emits behavior + reuse + constraints when update lacks boundaries", () => {
  const packet = deepClone(updateReadyPacket);
  delete packet.existingSystemContext.doNotChange;
  delete packet.existingSystemContext.reuseRequirements;
  delete packet.existingSystemContext.compatibilityRequirements;
  const requests = planContextRequests({ packet });
  const purposes = requests.map((req) => req.purpose);
  assert.ok(purposes.includes("summarize_current_behavior"));
  assert.ok(purposes.includes("find_reusable_component"));
  assert.ok(purposes.includes("find_constraints"));
});

test("planContextRequests emits inspect_reference_artifact entries for attached references", () => {
  const packet = deepClone(hoplonGroundedPacket);
  packet.existingSystemContext.referenceArtifacts = [
    { id: "art_1", kind: "screenshot" },
    { id: "art_2", kind: "html" },
  ];
  const requests = planContextRequests({ packet });
  const inspect = requests.filter((req) => req.purpose === "inspect_reference_artifact");
  assert.equal(inspect.length, 2);
});

test("planContextRequests emits nothing for a fully aligned greenfield packet", () => {
  const requests = planContextRequests({ packet: greenfieldReadyPacket });
  assert.deepEqual(requests, []);
});

test("planContextRequests emits nothing for a fully aligned update packet", () => {
  const requests = planContextRequests({ packet: updateReadyPacket });
  assert.deepEqual(requests, []);
});

test("planContextRequests preserves stable ids across the sequencer", () => {
  const sequencer = createContextRequestSequencer({ sessionId: "spec_a", iteration: 3 });
  const packet = deepClone(updateReadyPacket);
  delete packet.existingSystemContext.doNotChange;
  delete packet.existingSystemContext.reuseRequirements;
  delete packet.existingSystemContext.compatibilityRequirements;
  const requests = planContextRequests({ packet, sequencer, iteration: 3 });
  const ids = requests.map((req) => req.id);
  assert.deepEqual(ids, [...new Set(ids)]);
  assert.ok(requests.every((req) => req.iteration === 3));
});

// ---- Authority boundary: no direct Semantix-to-Hoplon path ---------------

test("Semantix Spec Studio source files do not import Hoplon directly", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const srcDir = join(here, "..", "src");
  const offending = [];
  function walk(dir) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".js")) continue;
      const content = readFileSync(full, "utf8");
      const importMatches = content.matchAll(
        /^\s*import[^\n]*from\s+(['"])([^'"\n]+)\1/gm,
      );
      for (const match of importMatches) {
        const specifier = match[2];
        if (
          /(^|[\\\/])hoplon([\\\/]|$)/.test(specifier) ||
          /^@hoplon\//.test(specifier) ||
          /\bhoplon-mcp\b/.test(specifier)
        ) {
          offending.push({ file: full, specifier });
        }
      }
    }
  }
  walk(srcDir);
  assert.deepEqual(
    offending,
    [],
    `Found Hoplon imports in stx source: ${JSON.stringify(offending)}`,
  );
});

test("Semantix package manifest does not list Hoplon as a dependency", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const pkgPath = join(here, "..", "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = pkg[section] ?? {};
    for (const name of Object.keys(deps)) {
      assert.ok(
        !/hoplon/i.test(name),
        `${section} contains a Hoplon dependency "${name}"; Semantix must not call Hoplon directly.`,
      );
    }
  }
});
