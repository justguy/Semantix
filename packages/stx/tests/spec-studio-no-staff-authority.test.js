import assert from "node:assert/strict";
import test from "node:test";

import {
  STAFF_OWNED_FIELDS,
  STAFF_OWNED_KEY_FRAGMENTS,
  assertNoStaffAuthorityBleed,
  findStaffAuthorityBleed,
  validateNoStaffAuthorityBleed,
} from "../src/spec-studio-no-staff-authority.js";

import { validateSemantixAlignmentPacket } from "../src/spec-studio-contracts.js";

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

test("STAFF_OWNED_FIELDS lists every documented top-level Staff field", () => {
  for (const expected of [
    "featurePuzzle",
    "featurePuzzles",
    "designDoc",
    "designDocs",
    "designDocument",
    "verifyCommand",
    "verifyCommands",
    "implementationPlan",
    "implementationPlans",
    "fileChange",
    "fileChanges",
    "fileChangeInstructions",
    "staffPlan",
    "architectureDoc",
    "decompositionPlan",
    "executionPlan",
  ]) {
    assert.ok(
      STAFF_OWNED_FIELDS.includes(expected),
      `STAFF_OWNED_FIELDS missing "${expected}"`,
    );
  }
});

test("STAFF_OWNED_KEY_FRAGMENTS covers Staff content categories", () => {
  for (const fragment of [
    "featurepuzzle",
    "designdoc",
    "verifycommand",
    "implementationplan",
    "filechange",
    "staffplan",
    "architecturedoc",
  ]) {
    assert.ok(
      STAFF_OWNED_KEY_FRAGMENTS.includes(fragment),
      `STAFF_OWNED_KEY_FRAGMENTS missing "${fragment}"`,
    );
  }
});

// ---- Clean fixtures pass --------------------------------------------------

for (const [name, packet] of Object.entries({
  greenfieldReady: greenfieldReadyPacket,
  updateReady: updateReadyPacket,
  ambiguousNeedsUser: ambiguousNeedsUserPacket,
  hoplonGrounded: hoplonGroundedPacket,
})) {
  test(`upstream sample ${name} contains no Staff-owned bleed`, () => {
    const result = validateNoStaffAuthorityBleed(packet);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
  });
}

// ---- Top-level rejection (delegates to deep walker now) -------------------

test("top-level Staff fields are reported", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.featurePuzzle = { id: "fp_1" };
  const result = validateNoStaffAuthorityBleed(packet);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.path === "$.featurePuzzle"));
});

// ---- Nested rejection: requirement extras --------------------------------

test("rejects Staff-owned key bleed inside a requirement", () => {
  const packet = deepClone(updateReadyPacket);
  packet.requirements[0].implementationPlan = {
    steps: ["edit signupController", "deploy"],
  };
  const result = validateNoStaffAuthorityBleed(packet);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((entry) => entry.path.endsWith(".implementationPlan")),
    JSON.stringify(result.errors),
  );
});

test("rejects Staff-owned key bleed nested deep inside a requirement", () => {
  const packet = deepClone(updateReadyPacket);
  packet.requirements[0].extras = {
    notes: { staffPlan: ["pick file", "write tests"] },
  };
  const result = validateNoStaffAuthorityBleed(packet);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.key === "staffPlan"));
});

// ---- Nested rejection: nextTurn body --------------------------------------

test("rejects Staff-owned key bleed inside nextTurn.body", () => {
  const packet = deepClone(ambiguousNeedsUserPacket);
  packet.nextTurn.body.designDoc = { intro: "..." };
  const result = validateNoStaffAuthorityBleed(packet);
  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some(
      (entry) =>
        entry.path === "$.nextTurn.body.designDoc" && entry.key === "designDoc",
    ),
    JSON.stringify(result.errors),
  );
});

test("rejects feature puzzles smuggled inside nextTurn body offers", () => {
  const packet = deepClone(ambiguousNeedsUserPacket);
  packet.nextTurn.body.options[0].featurePuzzle = { id: "fp_1" };
  const result = validateNoStaffAuthorityBleed(packet);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.key === "featurePuzzle"));
});

// ---- Nested rejection: findings, contextSources, groundedFacts -----------

test("rejects Staff-owned key bleed inside a finding", () => {
  const packet = deepClone(ambiguousNeedsUserPacket);
  packet.findings[0].verifyCommand = "npm run check";
  const result = validateNoStaffAuthorityBleed(packet);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.key === "verifyCommand"));
});

test("rejects Staff-owned key bleed inside a context source", () => {
  const packet = deepClone(hoplonGroundedPacket);
  packet.contextSources[0].fileChangeInstructions = ["change x"];
  const result = validateNoStaffAuthorityBleed(packet);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.key === "fileChangeInstructions"));
});

test("rejects Staff-owned key bleed inside a grounded fact", () => {
  const packet = deepClone(hoplonGroundedPacket);
  packet.groundedFacts[0].executionPlan = { phase: "ship" };
  const result = validateNoStaffAuthorityBleed(packet);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.key === "executionPlan"));
});

// ---- Snake-case and other variant detection -------------------------------

test("detects snake_case Staff fields", () => {
  const packet = { foo: { verify_command: "npm test" } };
  const result = validateNoStaffAuthorityBleed(packet);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.key === "verify_command"));
});

test("detects mixed-case file change instructions", () => {
  const packet = { tooling: { File_Change_Instructions: ["change x"] } };
  const result = validateNoStaffAuthorityBleed(packet);
  assert.equal(result.ok, false);
});

test("detects feature_puzzles array", () => {
  const packet = { feature_puzzles: [{ id: "fp_1" }] };
  const result = validateNoStaffAuthorityBleed(packet);
  assert.equal(result.ok, false);
});

// ---- Free-text content is allowed -----------------------------------------

test("allows mentions of Staff concepts inside free-text Semantix prose", () => {
  const packet = deepClone(updateReadyPacket);
  packet.requirements[0].text =
    "Do not edit the design doc; do not run a verify command outside CI.";
  packet.findings = [
    {
      id: "F-001",
      kind: "risk",
      sev: "concern",
      section: "scope",
      ref: "REQ-001",
      text: "There is a feature puzzle in the staff plan we should preserve.",
      resolved: false,
      raisedBy: "semantix",
    },
  ];
  const result = validateNoStaffAuthorityBleed(packet);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

// ---- Throwing variant ----------------------------------------------------

test("assertNoStaffAuthorityBleed throws on violations", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.staffPlan = { phase: "ship" };
  assert.throws(
    () => assertNoStaffAuthorityBleed(packet),
    (error) => error.name === "ValidationError",
  );
});

test("assertNoStaffAuthorityBleed succeeds on clean packets", () => {
  assert.doesNotThrow(() => assertNoStaffAuthorityBleed(greenfieldReadyPacket));
});

// ---- Composability: contract validator catches nested bleed --------------

test("validateSemantixAlignmentPacket also catches nested Staff bleed", () => {
  const packet = deepClone(updateReadyPacket);
  packet.requirements[0].implementationPlan = { steps: [] };
  const result = validateSemantixAlignmentPacket(packet);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((entry) => entry.code === "staff_owned_field_present"));
});

// ---- findStaffAuthorityBleed returns paths for inspection ----------------

test("findStaffAuthorityBleed returns dotted paths for every offender", () => {
  const packet = {
    nextTurn: { body: { designDoc: "x" } },
    requirements: [{ id: "REQ-1", featurePuzzle: { id: "fp" } }],
  };
  const findings = findStaffAuthorityBleed(packet);
  assert.equal(findings.length, 2);
  assert.ok(findings.some((f) => f.path === "$.nextTurn.body.designDoc"));
  assert.ok(findings.some((f) => f.path === "$.requirements[0].featurePuzzle"));
});

test("validateNoStaffAuthorityBleed accepts non-object inputs harmlessly", () => {
  assert.equal(validateNoStaffAuthorityBleed(null).ok, true);
  assert.equal(validateNoStaffAuthorityBleed(undefined).ok, true);
  assert.equal(validateNoStaffAuthorityBleed("plain string").ok, true);
  assert.equal(validateNoStaffAuthorityBleed(42).ok, true);
});
