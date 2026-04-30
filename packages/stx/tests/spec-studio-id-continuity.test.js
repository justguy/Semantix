import assert from "node:assert/strict";
import test from "node:test";

import {
  ID_CONTINUITY_VIOLATION,
  assertIdContinuity,
  checkIdContinuity,
} from "../src/spec-studio-id-continuity.js";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function basePacket() {
  return {
    requirements: [
      {
        id: "REQ-001",
        type: "functional",
        text: "Original requirement text",
        priority: "must",
        sourceRef: "dec_001",
        acceptance: "It does the thing.",
        status: "confirmed",
      },
    ],
    findings: [
      {
        id: "F-001",
        kind: "gap",
        sev: "concern",
        section: "scope",
        ref: "REQ-001",
        text: "Need a clearer success criterion",
        resolved: false,
        raisedBy: "semantix",
      },
    ],
    groundedFacts: [
      {
        id: "FACT-001",
        source: "hoplon",
        text: "An existing right panel exists.",
        confidence: "high",
        evidenceRef: "hoplon://run-view#right-panel",
      },
    ],
  };
}

function expectViolation(result, kind, id) {
  assert.equal(result.ok, false, `expected violation kind="${kind}" id="${id}"`);
  assert.ok(
    result.violations.some((v) => v.kind === kind && v.id === id),
    `expected violation kind="${kind}" id="${id}" in: ${JSON.stringify(result.violations)}`,
  );
}

// ---- Preservation ---------------------------------------------------------

test("preserves unchanged requirement, finding, and grounded-fact IDs across turns", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  const result = checkIdContinuity({ priorPacket: prior, nextPacket: next });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.deepEqual(result.summary.preservedRequirements, ["REQ-001"]);
  assert.deepEqual(result.summary.preservedFindings, ["F-001"]);
  assert.deepEqual(result.summary.preservedGroundedFacts, ["FACT-001"]);
});

test("captures additions in summary and tolerates them", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.requirements.push({
    id: "REQ-002",
    type: "constraint",
    text: "New constraint",
    priority: "should",
    sourceRef: "dec_002",
    acceptance: "Constraint holds.",
    status: "confirmed",
  });
  next.findings.push({
    id: "F-002",
    kind: "risk",
    sev: "fyi",
    section: "risks",
    ref: "REQ-002",
    text: "Edge-case risk",
    resolved: false,
    raisedBy: "semantix",
  });
  next.groundedFacts.push({
    id: "FACT-002",
    source: "phalanx",
    text: "Another fact",
    confidence: "medium",
    evidenceRef: "phalanx://session/x",
  });

  const result = checkIdContinuity({ priorPacket: prior, nextPacket: next });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.deepEqual(result.summary.newRequirements, ["REQ-002"]);
  assert.deepEqual(result.summary.newFindings, ["F-002"]);
  assert.deepEqual(result.summary.newGroundedFacts, ["FACT-002"]);
});

// ---- Supersession --------------------------------------------------------

test("accepts supersession when status flips and supersededBy points to a new id", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.requirements[0] = { ...next.requirements[0], status: "superseded", supersededBy: "REQ-002" };
  next.requirements.push({
    id: "REQ-002",
    type: "functional",
    text: "Refined requirement text",
    priority: "must",
    sourceRef: "dec_002",
    acceptance: "Refined acceptance.",
    status: "confirmed",
  });

  const result = checkIdContinuity({ priorPacket: prior, nextPacket: next });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.deepEqual(result.summary.supersededRequirements, ["REQ-001"]);
  assert.deepEqual(result.summary.newRequirements, ["REQ-002"]);
});

test("rejects supersession that does not name a supersededBy replacement", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.requirements[0] = { ...next.requirements[0], status: "superseded" };
  expectViolation(
    checkIdContinuity({ priorPacket: prior, nextPacket: next }),
    ID_CONTINUITY_VIOLATION.REQUIREMENT_SUPERSEDED_WITHOUT_REPLACEMENT,
    "REQ-001",
  );
});

test("rejects supersededBy pointing to an id that is not in the next packet", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.requirements[0] = {
    ...next.requirements[0],
    status: "superseded",
    supersededBy: "REQ-999",
  };
  expectViolation(
    checkIdContinuity({ priorPacket: prior, nextPacket: next }),
    ID_CONTINUITY_VIOLATION.REQUIREMENT_SUPERSEDED_WITHOUT_REPLACEMENT,
    "REQ-001",
  );
});

test("rejects requirement self-supersession", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.requirements[0] = {
    ...next.requirements[0],
    status: "superseded",
    supersededBy: "REQ-001",
  };
  expectViolation(
    checkIdContinuity({ priorPacket: prior, nextPacket: next }),
    ID_CONTINUITY_VIOLATION.REQUIREMENT_SUPERSEDED_WITHOUT_REPLACEMENT,
    "REQ-001",
  );
});

test("reports duplicate ids before map-based continuity comparison masks them", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.requirements.push({ ...next.requirements[0] });
  next.findings.push({ ...next.findings[0] });
  next.groundedFacts.push({ ...next.groundedFacts[0] });
  const result = checkIdContinuity({
    priorPacket: prior,
    nextPacket: next,
    priorContextRequests: [{ id: "CTX-001" }],
    nextContextRequests: [{ id: "CTX-002" }, { id: "CTX-002" }],
  });
  expectViolation(result, ID_CONTINUITY_VIOLATION.DUPLICATE_ID, "REQ-001");
  expectViolation(result, ID_CONTINUITY_VIOLATION.DUPLICATE_ID, "F-001");
  expectViolation(result, ID_CONTINUITY_VIOLATION.DUPLICATE_ID, "FACT-001");
  expectViolation(result, ID_CONTINUITY_VIOLATION.DUPLICATE_ID, "CTX-002");
});

test("rejects reuse of a previously superseded requirement id", () => {
  const prior = basePacket();
  prior.requirements[0].status = "superseded";
  prior.requirements[0].supersededBy = "REQ-099";
  prior.requirements.push({
    id: "REQ-099",
    type: "functional",
    text: "Replacement",
    priority: "must",
    sourceRef: "dec",
    acceptance: "ok",
    status: "confirmed",
  });

  const next = deepClone(prior);
  next.requirements[0].status = "confirmed";

  expectViolation(
    checkIdContinuity({ priorPacket: prior, nextPacket: next }),
    ID_CONTINUITY_VIOLATION.REQUIREMENT_REUSED_AFTER_SUPERSEDE,
    "REQ-001",
  );
});

// ---- Drops and silent mutations ------------------------------------------

test("rejects dropped prior requirement IDs", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.requirements = [];
  expectViolation(
    checkIdContinuity({ priorPacket: prior, nextPacket: next }),
    ID_CONTINUITY_VIOLATION.REQUIREMENT_DROPPED,
    "REQ-001",
  );
});

test("tolerates dropping a requirement that was already superseded in the prior packet", () => {
  const prior = basePacket();
  prior.requirements[0].status = "superseded";
  prior.requirements[0].supersededBy = "REQ-099";
  prior.requirements.push({
    id: "REQ-099",
    type: "functional",
    text: "Replacement",
    priority: "must",
    sourceRef: "dec",
    acceptance: "ok",
    status: "confirmed",
  });

  const next = deepClone(prior);
  next.requirements = next.requirements.filter((r) => r.id !== "REQ-001");

  const result = checkIdContinuity({ priorPacket: prior, nextPacket: next });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});

test("rejects silent same-id requirement mutation", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.requirements[0].text = "Mutated text without supersedion";
  expectViolation(
    checkIdContinuity({ priorPacket: prior, nextPacket: next }),
    ID_CONTINUITY_VIOLATION.REQUIREMENT_MUTATED,
    "REQ-001",
  );
});

test("rejects silent same-id requirement priority change", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.requirements[0].priority = "should";
  expectViolation(
    checkIdContinuity({ priorPacket: prior, nextPacket: next }),
    ID_CONTINUITY_VIOLATION.REQUIREMENT_MUTATED,
    "REQ-001",
  );
});

// ---- Findings -----------------------------------------------------------

test("rejects dropped finding IDs (resolved findings must remain visible)", () => {
  const prior = basePacket();
  prior.findings[0].resolved = true;
  prior.findings[0].resolvedAt = "2026-04-30T00:00:00.000Z";

  const next = deepClone(prior);
  next.findings = [];
  expectViolation(
    checkIdContinuity({ priorPacket: prior, nextPacket: next }),
    ID_CONTINUITY_VIOLATION.FINDING_DROPPED,
    "F-001",
  );
});

test("rejects regression of a previously resolved finding", () => {
  const prior = basePacket();
  prior.findings[0].resolved = true;
  prior.findings[0].resolvedAt = "2026-04-30T00:00:00.000Z";

  const next = deepClone(prior);
  next.findings[0].resolved = false;
  delete next.findings[0].resolvedAt;
  expectViolation(
    checkIdContinuity({ priorPacket: prior, nextPacket: next }),
    ID_CONTINUITY_VIOLATION.FINDING_RESOLVED_REGRESSED,
    "F-001",
  );
});

test("rejects silent finding mutation under the same id", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.findings[0].text = "Mutated finding";
  expectViolation(
    checkIdContinuity({ priorPacket: prior, nextPacket: next }),
    ID_CONTINUITY_VIOLATION.FINDING_MUTATED,
    "F-001",
  );
});

test("rejects silent finding severity change under the same id", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.findings[0].sev = "blocker";
  expectViolation(
    checkIdContinuity({ priorPacket: prior, nextPacket: next }),
    ID_CONTINUITY_VIOLATION.FINDING_MUTATED,
    "F-001",
  );
});

test("tracks resolved findings in the summary", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.findings[0].resolved = true;
  next.findings[0].resolvedAt = "2026-04-30T00:00:00.000Z";

  const result = checkIdContinuity({ priorPacket: prior, nextPacket: next });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.deepEqual(result.summary.resolvedFindings, ["F-001"]);
});

// ---- Grounded facts -----------------------------------------------------

test("rejects dropped grounded-fact IDs", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.groundedFacts = [];
  expectViolation(
    checkIdContinuity({ priorPacket: prior, nextPacket: next }),
    ID_CONTINUITY_VIOLATION.GROUNDED_FACT_DROPPED,
    "FACT-001",
  );
});

test("rejects silent grounded-fact mutation", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.groundedFacts[0].evidenceRef = "hoplon://different-trace";
  expectViolation(
    checkIdContinuity({ priorPacket: prior, nextPacket: next }),
    ID_CONTINUITY_VIOLATION.GROUNDED_FACT_MUTATED,
    "FACT-001",
  );
});

// ---- Context requests ---------------------------------------------------

test("rejects reissued context-request IDs across turns", () => {
  const result = checkIdContinuity({
    priorPacket: {},
    nextPacket: {},
    priorContextRequests: [{ id: "CTX-001" }],
    nextContextRequests: [{ id: "CTX-001" }, { id: "CTX-002" }],
  });
  expectViolation(result, ID_CONTINUITY_VIOLATION.CONTEXT_REQUEST_REISSUED, "CTX-001");
  assert.deepEqual(result.summary.newContextRequests, ["CTX-002"]);
});

test("does not flag fresh context-request IDs", () => {
  const result = checkIdContinuity({
    priorPacket: {},
    nextPacket: {},
    priorContextRequests: [{ id: "CTX-001" }],
    nextContextRequests: [{ id: "CTX-002" }],
  });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
  assert.deepEqual(result.summary.newContextRequests, ["CTX-002"]);
});

// ---- Throwing variant ---------------------------------------------------

test("assertIdContinuity throws on violations and returns the report on success", () => {
  const prior = basePacket();
  const next = deepClone(prior);
  next.requirements[0].text = "Mutated";
  assert.throws(
    () => assertIdContinuity({ priorPacket: prior, nextPacket: next }),
    (error) => error.name === "ValidationError",
  );
  const passing = assertIdContinuity({ priorPacket: prior, nextPacket: prior });
  assert.equal(passing.ok, true);
});

// ---- Decision IDs are Phalanx-owned --------------------------------------

test("does not mint or mutate decision IDs (Phalanx-owned)", () => {
  // The continuity guard intentionally has no decision-id rules; this test
  // documents the contract boundary so future contributors do not add one.
  const prior = { decisions: [{ id: "dec_001" }, { id: "dec_002" }] };
  const next = { decisions: [{ id: "dec_001" }, { id: "dec_003" }] };
  const result = checkIdContinuity({ priorPacket: prior, nextPacket: next });
  assert.equal(result.ok, true, JSON.stringify(result.violations));
});
