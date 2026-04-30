import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTEXT_REQUEST_PURPOSE_VALUES,
  CONTEXT_REQUEST_SOURCE_VALUES,
  CONTEXT_RESPONSE_STATUS_VALUES,
  CONTEXT_SOURCE_KIND_VALUES,
  CONTRACT_VERSION,
  EXISTING_SYSTEM_MODE,
  EXISTING_SYSTEM_MODE_VALUES,
  FINDING_KIND_VALUES,
  FINDING_SEVERITY_VALUES,
  READINESS,
  READINESS_VALUES,
  SOURCE_PHALANX_DEGRADED,
  SOURCE_SEMANTIX,
  STAFF_OWNED_FIELDS,
  assertSemantixAlignmentPacket,
  assertSemantixContextRequest,
  assertSemantixContextResponse,
  isContextSourceKind,
  isExistingSystemMode,
  isReadiness,
  validateContextSource,
  validateFinding,
  validateGroundedFact,
  validateSemantixAlignmentPacket,
  validateSemantixContextRequest,
  validateSemantixContextResponse,
  validateSemantixTurn,
} from "../src/spec-studio-contracts.js";

import {
  ambiguousNeedsUserPacket,
  degradedPacket,
  greenfieldReadyPacket,
  hoplonGroundedPacket,
  replacementBlockedPacket,
  updateReadyPacket,
  upstreamSamplePackets,
} from "./fixtures/spec-studio-samples.js";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectErrorCode(result, code) {
  assert.equal(result.ok, false, `expected validation to fail with code "${code}"`);
  assert.ok(
    result.errors.some((error) => error.code === code),
    `expected error code "${code}" in: ${JSON.stringify(result.errors)}`,
  );
}

// ---- Constants and type guards --------------------------------------------

test("contract version constant matches the upstream string identifier", () => {
  assert.equal(CONTRACT_VERSION, "semantix.phalanx.spec-studio.v1");
});

test("readiness constants and values stay in lockstep", () => {
  assert.equal(READINESS.READY, "ready");
  assert.equal(READINESS.NEEDS_USER, "needs_user");
  assert.equal(READINESS.BLOCKED, "blocked");
  assert.deepEqual([...READINESS_VALUES], ["ready", "needs_user", "blocked"]);
});

test("existing-system mode constants stay in lockstep", () => {
  assert.equal(EXISTING_SYSTEM_MODE.NEW, "new");
  assert.equal(EXISTING_SYSTEM_MODE.UPDATE, "update");
  assert.equal(EXISTING_SYSTEM_MODE.UNKNOWN, "unknown");
  assert.deepEqual([...EXISTING_SYSTEM_MODE_VALUES], ["new", "update", "unknown"]);
});

test("context source, finding, and request enums match the spec", () => {
  assert.deepEqual(
    [...CONTEXT_SOURCE_KIND_VALUES],
    ["user", "html", "spec", "phalanx", "hoplon", "repo", "trace", "upload"],
  );
  assert.deepEqual([...FINDING_KIND_VALUES], [
    "gap",
    "contradiction",
    "assumption",
    "risk",
    "drift",
  ]);
  assert.deepEqual([...FINDING_SEVERITY_VALUES], ["blocker", "concern", "fyi"]);
  assert.deepEqual([...CONTEXT_REQUEST_PURPOSE_VALUES], [
    "identify_target_surface",
    "summarize_current_behavior",
    "find_existing_flow",
    "find_reusable_component",
    "find_constraints",
    "collect_hoplon_evidence",
    "inspect_reference_artifact",
  ]);
  assert.deepEqual([...CONTEXT_REQUEST_SOURCE_VALUES], [
    "phalanx",
    "hoplon",
    "repo",
    "upload",
    "trace",
  ]);
  assert.deepEqual([...CONTEXT_RESPONSE_STATUS_VALUES], ["ok", "empty", "error"]);
});

test("type guards reject unknown values", () => {
  assert.equal(isReadiness("ready"), true);
  assert.equal(isReadiness("ok"), false);
  assert.equal(isExistingSystemMode("update"), true);
  assert.equal(isExistingSystemMode("partial"), false);
  assert.equal(isContextSourceKind("hoplon"), true);
  assert.equal(isContextSourceKind("memory"), false);
});

// ---- Acceptance: upstream sample packets ----------------------------------

test("validation accepts upstream greenfield-ready sample", () => {
  const result = validateSemantixAlignmentPacket(greenfieldReadyPacket);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validation accepts upstream update-ready sample", () => {
  const result = validateSemantixAlignmentPacket(updateReadyPacket);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validation accepts upstream ambiguous needs_user sample", () => {
  const result = validateSemantixAlignmentPacket(ambiguousNeedsUserPacket);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validation accepts upstream replacement/duplicate blocked sample", () => {
  const result = validateSemantixAlignmentPacket(replacementBlockedPacket);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validation accepts upstream Hoplon-grounded update sample", () => {
  const result = validateSemantixAlignmentPacket(hoplonGroundedPacket);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validation accepts upstream degraded sample", () => {
  const result = validateSemantixAlignmentPacket(degradedPacket);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("upstreamSamplePackets exposes all six fixtures", () => {
  const expectedKeys = [
    "greenfieldReady",
    "updateReady",
    "ambiguousNeedsUser",
    "replacementBlocked",
    "hoplonGrounded",
    "degraded",
  ];
  for (const key of expectedKeys) {
    const result = validateSemantixAlignmentPacket(upstreamSamplePackets[key]);
    assert.equal(result.ok, true, `${key}: ${JSON.stringify(result.errors)}`);
  }
});

// ---- Rejection: malformed readiness ---------------------------------------

test("rejects packets with unrecognized readiness value", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.readiness = "almost_ready";
  expectErrorCode(validateSemantixAlignmentPacket(packet), "invalid_readiness");
});

test("rejects packets with non-string readiness", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.readiness = 1;
  expectErrorCode(validateSemantixAlignmentPacket(packet), "invalid_readiness");
});

// ---- Rejection: missing existingSystemContext -----------------------------

test("rejects packets missing existingSystemContext entirely", () => {
  const packet = deepClone(greenfieldReadyPacket);
  delete packet.existingSystemContext;
  expectErrorCode(
    validateSemantixAlignmentPacket(packet),
    "existing_system_context_missing",
  );
});

test("rejects packets with null existingSystemContext", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.existingSystemContext = null;
  expectErrorCode(
    validateSemantixAlignmentPacket(packet),
    "existing_system_context_missing",
  );
});

// ---- Rejection: ready + unknown mode --------------------------------------

test("rejects ready packets that report mode=unknown", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.existingSystemContext = { mode: "unknown" };
  expectErrorCode(validateSemantixAlignmentPacket(packet), "ready_with_unknown_mode");
});

// ---- Rejection: ready update without target surfaces ----------------------

test("rejects ready+update packets that omit targetSurfaces", () => {
  const packet = deepClone(updateReadyPacket);
  delete packet.existingSystemContext.targetSurfaces;
  expectErrorCode(
    validateSemantixAlignmentPacket(packet),
    "ready_update_missing_target_surfaces",
  );
});

test("rejects ready+update packets with empty targetSurfaces array", () => {
  const packet = deepClone(updateReadyPacket);
  packet.existingSystemContext.targetSurfaces = [];
  expectErrorCode(
    validateSemantixAlignmentPacket(packet),
    "ready_update_missing_target_surfaces",
  );
});

// ---- Rejection: ready update without non-change/reuse/compatibility -------

test("rejects ready+update packets without doNotChange/reuse/compatibility boundaries", () => {
  const packet = deepClone(updateReadyPacket);
  delete packet.existingSystemContext.doNotChange;
  delete packet.existingSystemContext.reuseRequirements;
  delete packet.existingSystemContext.compatibilityRequirements;
  expectErrorCode(
    validateSemantixAlignmentPacket(packet),
    "ready_update_missing_boundaries",
  );
});

test("ready+update packets pass when only compatibilityRequirements is present", () => {
  const packet = deepClone(updateReadyPacket);
  delete packet.existingSystemContext.doNotChange;
  delete packet.existingSystemContext.reuseRequirements;
  packet.existingSystemContext.compatibilityRequirements = ["Maintain v1 API contract."];
  const result = validateSemantixAlignmentPacket(packet);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

// ---- Rejection: groundedFacts without evidenceRef -------------------------

test("rejects packets whose groundedFacts entry is missing evidenceRef", () => {
  const packet = deepClone(hoplonGroundedPacket);
  delete packet.groundedFacts[0].evidenceRef;
  expectErrorCode(
    validateSemantixAlignmentPacket(packet),
    "grounded_fact_missing_evidence_ref",
  );
});

test("rejects packets whose groundedFacts entry has empty evidenceRef", () => {
  const packet = deepClone(hoplonGroundedPacket);
  packet.groundedFacts[0].evidenceRef = "";
  expectErrorCode(
    validateSemantixAlignmentPacket(packet),
    "grounded_fact_missing_evidence_ref",
  );
});

test("standalone grounded fact validator rejects missing evidenceRef", () => {
  const result = validateGroundedFact({
    id: "FACT-001",
    source: "hoplon",
    text: "A fact",
    confidence: "high",
  });
  expectErrorCode(result, "grounded_fact_missing_evidence_ref");
});

// ---- Rejection: Staff-owned output fields ---------------------------------

for (const field of STAFF_OWNED_FIELDS) {
  test(`rejects packets that include Staff-owned field "${field}"`, () => {
    const packet = deepClone(greenfieldReadyPacket);
    packet[field] = field.includes("Plan") ? { steps: [] } : "Staff content";
    expectErrorCode(validateSemantixAlignmentPacket(packet), "staff_owned_field_present");
  });
}

// ---- Required field absences ----------------------------------------------

test("rejects packets missing source", () => {
  const packet = deepClone(greenfieldReadyPacket);
  delete packet.source;
  expectErrorCode(validateSemantixAlignmentPacket(packet), "invalid_source");
});

test("accepts phalanx-degraded source", () => {
  const packet = deepClone(degradedPacket);
  packet.source = SOURCE_PHALANX_DEGRADED;
  const result = validateSemantixAlignmentPacket(packet);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("rejects phalanx-degraded packets that claim ready", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.source = SOURCE_PHALANX_DEGRADED;
  expectErrorCode(
    validateSemantixAlignmentPacket(packet),
    "phalanx_degraded_cannot_be_ready",
  );
});

test("rejects packets with unknown source", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.source = "third-party";
  expectErrorCode(validateSemantixAlignmentPacket(packet), "invalid_source");
});

test("rejects packets missing nextTurn key entirely", () => {
  const packet = deepClone(greenfieldReadyPacket);
  delete packet.nextTurn;
  expectErrorCode(validateSemantixAlignmentPacket(packet), "missing_next_turn");
});

test("accepts contractVersion=1 numeric form for backwards compatibility", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.contractVersion = 1;
  const result = validateSemantixAlignmentPacket(packet);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("rejects packets missing required structural arrays and objects", () => {
  const packet = deepClone(greenfieldReadyPacket);
  delete packet.contextSources;
  delete packet.groundedFacts;
  delete packet.findings;
  delete packet.coverage;
  const result = validateSemantixAlignmentPacket(packet);
  expectErrorCode(result, "invalid_context_sources");
  expectErrorCode(result, "invalid_grounded_facts");
  expectErrorCode(result, "invalid_findings");
  expectErrorCode(result, "invalid_coverage");
});

test("rejects malformed and duplicate requirement facts", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.requirements = [
    { id: "REQ-001" },
    { ...greenfieldReadyPacket.requirements[0] },
  ];
  const result = validateSemantixAlignmentPacket(packet);
  expectErrorCode(result, "requirement_invalid_type");
  expectErrorCode(result, "requirement_missing_text");
  expectErrorCode(result, "requirement_invalid_priority");
  expectErrorCode(result, "requirement_missing_source_ref");
  expectErrorCode(result, "requirement_missing_acceptance");
  expectErrorCode(result, "requirement_invalid_status");
  expectErrorCode(result, "duplicate_requirement_id");
});

// ---- Throwing assertion variant -------------------------------------------

test("assertSemantixAlignmentPacket succeeds on valid packets", () => {
  assert.doesNotThrow(() => assertSemantixAlignmentPacket(greenfieldReadyPacket));
});

test("assertSemantixAlignmentPacket throws on invalid packets", () => {
  assert.throws(
    () => assertSemantixAlignmentPacket({ readiness: "bogus" }),
    (error) => error.name === "ValidationError",
  );
});

// ---- Context request validation -------------------------------------------

test("validates a well-formed context request from the spec example", () => {
  const request = {
    id: "CTX-001",
    sessionId: "spec_s1",
    iteration: 2,
    purpose: "identify_target_surface",
    query:
      "Find whether a Run View or dashboard surface already exists for runtime observation summaries.",
    requestedFrom: ["phalanx", "hoplon", "repo"],
    constraints: {
      maxResults: 5,
      targetRepo: "Project-Phalanx",
      allowedSources: ["phalanx", "hoplon", "repo"],
      mustReturnEvidenceRefs: true,
    },
    reason:
      "The user asked for a dashboard-like update; Semantix must determine whether this is new work or an update.",
  };
  const result = validateSemantixContextRequest(request);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("rejects context requests with unknown purpose", () => {
  const result = validateSemantixContextRequest({
    id: "CTX-001",
    sessionId: "spec_s1",
    iteration: 1,
    purpose: "guess_target",
    query: "?",
    requestedFrom: ["phalanx"],
    constraints: {},
    reason: "test",
  });
  expectErrorCode(result, "invalid_purpose");
});

test("rejects context requests with empty requestedFrom", () => {
  const result = validateSemantixContextRequest({
    id: "CTX-001",
    sessionId: "spec_s1",
    iteration: 1,
    purpose: "identify_target_surface",
    query: "?",
    requestedFrom: [],
    constraints: {},
    reason: "test",
  });
  expectErrorCode(result, "invalid_requested_from");
});

test("assertSemantixContextRequest throws on invalid input", () => {
  assert.throws(
    () => assertSemantixContextRequest({}),
    (error) => error.name === "ValidationError",
  );
});

// ---- Context response validation ------------------------------------------

test("validates a well-formed context response", () => {
  const response = {
    requestId: "CTX-001",
    status: "ok",
    facts: [
      {
        id: "FACT-001",
        source: "hoplon",
        text: "Existing right panel found.",
        confidence: "high",
        evidenceRef: "hoplon://trace/run-view#right-panel",
      },
    ],
    artifacts: [],
    summary: "One grounded fact returned.",
  };
  const result = validateSemantixContextResponse(response);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("rejects context response with status=error and no error detail", () => {
  const result = validateSemantixContextResponse({
    requestId: "CTX-001",
    status: "error",
    facts: [],
    summary: "",
  });
  expectErrorCode(result, "missing_error_detail");
});

test("rejects context response whose grounded fact lacks evidenceRef", () => {
  const result = validateSemantixContextResponse({
    requestId: "CTX-001",
    status: "ok",
    facts: [{ id: "FACT-001", source: "hoplon", text: "x", confidence: "high" }],
    summary: "missing evidenceRef",
  });
  expectErrorCode(result, "grounded_fact_missing_evidence_ref");
});

test("assertSemantixContextResponse throws on invalid input", () => {
  assert.throws(
    () => assertSemantixContextResponse({ requestId: "" }),
    (error) => error.name === "ValidationError",
  );
});

// ---- Component validators -------------------------------------------------

test("validateContextSource accepts the Hoplon sample source", () => {
  const result = validateContextSource(hoplonGroundedPacket.contextSources[0]);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validateContextSource rejects unknown kind", () => {
  const result = validateContextSource({
    id: "SRC-001",
    kind: "memory",
    status: "used",
    summary: "x",
    evidenceRefs: [],
  });
  expectErrorCode(result, "context_source_invalid_kind");
});

test("validateFinding accepts the ambiguous sample finding", () => {
  const result = validateFinding(ambiguousNeedsUserPacket.findings[0]);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validateFinding rejects unknown kind", () => {
  const result = validateFinding({
    id: "F-1",
    kind: "todo",
    sev: "blocker",
    section: "scope",
    ref: "x",
    text: "x",
    resolved: false,
    raisedBy: "semantix",
  });
  expectErrorCode(result, "finding_invalid_kind");
});

test("validateFinding rejects missing contract-critical fields", () => {
  const result = validateFinding({
    id: "F-1",
    kind: "gap",
    sev: "blocker",
    text: "x",
    resolved: false,
  });
  expectErrorCode(result, "finding_invalid_section");
  expectErrorCode(result, "finding_missing_ref");
  expectErrorCode(result, "finding_invalid_raised_by");
});

test("validateSemantixTurn accepts null", () => {
  const result = validateSemantixTurn(null);
  assert.equal(result.ok, true);
});

test("validateSemantixTurn accepts the ambiguous sample turn", () => {
  const result = validateSemantixTurn(ambiguousNeedsUserPacket.nextTurn);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("validateSemantixTurn rejects missing at and target", () => {
  const turn = deepClone(ambiguousNeedsUserPacket.nextTurn);
  delete turn.at;
  delete turn.target;
  const result = validateSemantixTurn(turn);
  expectErrorCode(result, "next_turn_missing_at");
  expectErrorCode(result, "next_turn_missing_target");
});

test("validateSemantixTurn rejects malformed turn", () => {
  const result = validateSemantixTurn({ id: "", side: "user" });
  assert.equal(result.ok, false);
});

// ---- Source identifier exports --------------------------------------------

test("source identifier exports are stable", () => {
  assert.equal(SOURCE_SEMANTIX, "semantix");
  assert.equal(SOURCE_PHALANX_DEGRADED, "phalanx-degraded");
});
