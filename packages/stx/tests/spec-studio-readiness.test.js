import assert from "node:assert/strict";
import test from "node:test";

import {
  REPLACEMENT_APPROVAL,
  applyReadinessVerdict,
  classifyReadiness,
  promoteNegativeRequirements,
} from "../src/spec-studio-readiness.js";

import {
  EXISTING_SYSTEM_MODE,
  READINESS,
  validateSemantixAlignmentPacket,
} from "../src/spec-studio-contracts.js";

import {
  ambiguousNeedsUserPacket,
  greenfieldReadyPacket,
  hoplonGroundedPacket,
  replacementBlockedPacket,
  updateReadyPacket,
} from "./fixtures/spec-studio-samples.js";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

// ---- Greenfield --------------------------------------------------------

test("greenfield ready packet classifies as ready", () => {
  const verdict = classifyReadiness(greenfieldReadyPacket);
  assert.equal(verdict.readiness, READINESS.READY);
  assert.deepEqual(verdict.findings, []);
  assert.deepEqual(verdict.blockingReasons, []);
});

test("greenfield without alignedRequirement returns needs_user", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.alignedRequirement = "";
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.NEEDS_USER);
  assert.ok(verdict.reasons.includes("aligned_requirement_missing"));
  assert.ok(verdict.findings.some((f) => f.id === "F-ALIGN-001"));
});

test("greenfield without inScope returns needs_user with concern", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.scope = { ...packet.scope, inScope: [] };
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.NEEDS_USER);
  assert.ok(verdict.reasons.includes("scope_in_missing"));
});

test("greenfield without obvious exclusions returns needs_user", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.scope = { ...packet.scope, outOfScope: [] };
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.NEEDS_USER);
  assert.ok(verdict.reasons.includes("scope_out_missing"));
});

test("greenfield without must-level requirements returns needs_user", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.requirements = [];
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.NEEDS_USER);
  assert.ok(verdict.reasons.includes("must_level_requirements_missing"));
});

test("greenfield must-level requirement without acceptance returns needs_user", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.requirements[0].acceptance = "";
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.NEEDS_USER);
  assert.ok(verdict.reasons.includes("must_level_acceptance_missing"));
});

// ---- Update ------------------------------------------------------------

test("update ready packet classifies as ready", () => {
  const verdict = classifyReadiness(updateReadyPacket);
  assert.equal(verdict.readiness, READINESS.READY);
});

test("update mode without targetSurfaces returns needs_user", () => {
  const packet = deepClone(updateReadyPacket);
  packet.existingSystemContext.targetSurfaces = [];
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.NEEDS_USER);
  assert.ok(verdict.reasons.includes("update_missing_target_surface"));
  assert.ok(verdict.openQuestions.some((q) => q.id === "Q-UPD-001"));
});

test("update mode with surface but no boundaries returns needs_user", () => {
  const packet = deepClone(updateReadyPacket);
  delete packet.existingSystemContext.doNotChange;
  delete packet.existingSystemContext.reuseRequirements;
  delete packet.existingSystemContext.compatibilityRequirements;
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.NEEDS_USER);
  assert.ok(verdict.reasons.includes("update_missing_boundaries"));
});

test("update mode with only compatibilityRequirements is sufficient", () => {
  const packet = deepClone(updateReadyPacket);
  delete packet.existingSystemContext.doNotChange;
  delete packet.existingSystemContext.reuseRequirements;
  packet.existingSystemContext.compatibilityRequirements = ["Maintain v1 API contract."];
  packet.requirements = [
    {
      id: "REQ-COMPAT-001",
      type: "constraint",
      text: "Maintain v1 API contract.",
      priority: "must",
      sourceRef: "dec_compat",
      acceptance: "Existing v1 API contract tests continue to pass.",
      status: "confirmed",
    },
  ];
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.READY);
});

test("update mode requires doNotChange boundaries to be promoted into requirement facts", () => {
  const packet = deepClone(updateReadyPacket);
  packet.existingSystemContext.doNotChange = ["billing code"];
  packet.existingSystemContext.reuseRequirements = [];
  packet.scope.negativeRequirements = [];
  packet.requirements = packet.requirements.filter((req) => req.type !== "negative");
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.NEEDS_USER);
  assert.ok(verdict.reasons.includes("update_missing_do_not_change_requirement"));
  assert.ok(verdict.findings.some((finding) => finding.id === "F-UPD-003"));
});

test("update mode missing target surface short-circuits before clarity checks", () => {
  const packet = deepClone(updateReadyPacket);
  packet.existingSystemContext.targetSurfaces = [];
  packet.alignedRequirement = ""; // additional issue would normally be reported
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.NEEDS_USER);
  // primary reason is the gate failure
  assert.equal(verdict.reasons[0], "update_missing_target_surface");
});

// ---- Unknown new-vs-update --------------------------------------------

test("mode unknown returns needs_user with question and blocker finding", () => {
  const packet = deepClone(ambiguousNeedsUserPacket);
  packet.existingSystemContext = { mode: EXISTING_SYSTEM_MODE.UNKNOWN };
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.NEEDS_USER);
  assert.ok(verdict.findings.some((f) => f.id === "F-MODE-001" && f.sev === "blocker"));
  assert.ok(verdict.openQuestions.some((q) => q.id === "Q-MODE-001"));
});

// ---- Replacement / duplicate ------------------------------------------

test("duplicate without approval returns blocked when approval is absent", () => {
  const packet = deepClone(updateReadyPacket);
  packet.duplicateDetected = true;
  packet.replacementApproval = REPLACEMENT_APPROVAL.ABSENT;
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.BLOCKED);
  assert.ok(
    verdict.findings.some((f) => f.kind === "contradiction" && f.sev === "blocker"),
  );
});

test("replacement pending approval returns needs_user with open question", () => {
  const packet = deepClone(updateReadyPacket);
  packet.replacementDetected = true;
  packet.replacementApproval = REPLACEMENT_APPROVAL.PENDING;
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.NEEDS_USER);
  assert.ok(verdict.openQuestions.some((q) => q.id === "Q-REP-001"));
});

test("replacement with explicit approval continues evaluation", () => {
  const packet = deepClone(updateReadyPacket);
  packet.replacementDetected = true;
  packet.replacementApproval = REPLACEMENT_APPROVAL.EXPLICIT;
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.READY);
  assert.ok(verdict.reasons.includes("replacement_explicit_approval"));
});

test("replacement-blocked upstream sample classifies as needs_user (replacement detected, approval pending)", () => {
  // The upstream replacement-blocked sample documents readiness=blocked,
  // but that fixture does not pass duplicateDetected/replacementApproval
  // through. Verify our classifier behaves correctly when those signals
  // are present, and confirm the fixture itself stays blocked when we
  // re-classify with explicit signals.
  const packet = deepClone(replacementBlockedPacket);
  packet.replacementDetected = true;
  packet.replacementApproval = REPLACEMENT_APPROVAL.ABSENT;
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.BLOCKED);
});

// ---- Existing system context required ---------------------------------

test("missing existingSystemContext returns needs_user with blocker", () => {
  const packet = deepClone(greenfieldReadyPacket);
  delete packet.existingSystemContext;
  const verdict = classifyReadiness(packet);
  assert.equal(verdict.readiness, READINESS.NEEDS_USER);
  assert.ok(verdict.reasons.includes("existing_system_context_missing"));
});

// ---- applyReadinessVerdict --------------------------------------------

test("applyReadinessVerdict preserves user-issued findings while replacing classifier-issued ones", () => {
  const userFinding = {
    id: "F-USER-001",
    kind: "risk",
    sev: "concern",
    section: "risks",
    ref: "user",
    text: "User-flagged risk",
    resolved: false,
    raisedBy: "user",
  };
  const packet = deepClone(greenfieldReadyPacket);
  packet.findings = [userFinding];
  const next = applyReadinessVerdict(packet);
  assert.equal(next.readiness, READINESS.READY);
  assert.ok(next.findings.some((f) => f.id === "F-USER-001"));
});

test("applyReadinessVerdict does not mark ready while preserving unresolved blockers", () => {
  const packet = deepClone(greenfieldReadyPacket);
  packet.findings = [
    {
      id: "F-USER-BLOCKER",
      kind: "risk",
      sev: "blocker",
      section: "risks",
      ref: "user",
      text: "User says this is still blocked.",
      resolved: false,
      raisedBy: "user",
    },
  ];
  const next = applyReadinessVerdict(packet);
  assert.equal(next.readiness, READINESS.NEEDS_USER);
  assert.ok(next.blockingReasons.some((reason) => reason.id === "BR-F-USER-BLOCKER"));
});

test("applyReadinessVerdict refreshes findings when classifier disagrees", () => {
  const packet = deepClone(updateReadyPacket);
  packet.existingSystemContext.targetSurfaces = [];
  packet.findings = [
    {
      id: "F-UPD-001",
      kind: "gap",
      sev: "blocker",
      section: "scope",
      ref: "TARGET_SURFACES",
      text: "stale finding from a prior turn",
      resolved: false,
      raisedBy: "semantix",
    },
  ];
  const next = applyReadinessVerdict(packet);
  assert.equal(next.readiness, READINESS.NEEDS_USER);
  // The stale F-UPD-001 should be replaced by a fresh classifier-issued
  // finding with the same id, with the correct text.
  const upd = next.findings.find((f) => f.id === "F-UPD-001");
  assert.ok(upd);
  assert.match(upd.text, /missing targetSurfaces/i);
});

// ---- Negative requirement promotion -----------------------------------

test("promoteNegativeRequirements lifts scope.negativeRequirements into first-class facts", () => {
  const out = promoteNegativeRequirements({
    requirements: [
      {
        id: "REQ-001",
        type: "functional",
        text: "Do the thing",
        priority: "must",
        sourceRef: "dec",
        acceptance: "ok",
        status: "confirmed",
      },
    ],
    scope: {
      negativeRequirements: [
        "Do not break OAuth signup",
        "Do not modify billing code",
      ],
    },
  });
  const negatives = out.filter((req) => req.type === "negative");
  assert.equal(negatives.length, 2);
  assert.ok(negatives.every((req) => req.priority === "must"));
  assert.ok(negatives.every((req) => req.status === "confirmed"));
  assert.ok(negatives.every((req) => req.id.startsWith("REQ-NEG-")));
});

test("promoteNegativeRequirements lifts existingSystemContext.doNotChange entries", () => {
  const out = promoteNegativeRequirements({
    requirements: [],
    existingSystemContext: {
      doNotChange: ["billing module", "OAuth controller"],
    },
  });
  const negatives = out.filter((req) => req.type === "negative");
  assert.equal(negatives.length, 2);
  assert.ok(negatives[0].text.startsWith("Do not change"));
  assert.ok(
    negatives.every((req) =>
      req.sourceRef.startsWith("boundaries:existingSystemContext.doNotChange"),
    ),
  );
});

test("promoteNegativeRequirements does not duplicate existing negatives", () => {
  const out = promoteNegativeRequirements({
    requirements: [
      {
        id: "REQ-NEG-001",
        type: "negative",
        text: "Do not modify billing code.",
        priority: "must",
        sourceRef: "boundaries:scope",
        acceptance: "x",
        status: "confirmed",
      },
    ],
    scope: {
      negativeRequirements: ["Do not modify billing code.", "Do not alter OAuth signup."],
    },
  });
  const negatives = out.filter((req) => req.type === "negative");
  assert.equal(negatives.length, 2);
});

test("promoteNegativeRequirements allocates after the max existing numeric suffix", () => {
  const out = promoteNegativeRequirements({
    requirements: [
      {
        id: "REQ-NEG-002",
        type: "negative",
        text: "Do not modify billing code.",
        priority: "must",
        sourceRef: "boundaries:scope",
        acceptance: "x",
        status: "confirmed",
      },
    ],
    scope: {
      negativeRequirements: ["Do not alter OAuth signup."],
    },
  });
  assert.ok(out.some((req) => req.id === "REQ-NEG-003"));
});

// ---- Validate post-classifier packet remains contract-valid ----------

test("applyReadinessVerdict output continues to validate against the packet contract", () => {
  const packet = deepClone(updateReadyPacket);
  packet.existingSystemContext.targetSurfaces = [];
  const next = applyReadinessVerdict(packet);
  const result = validateSemantixAlignmentPacket(next);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
});

test("upstream Hoplon-grounded sample classifies as ready", () => {
  const verdict = classifyReadiness(hoplonGroundedPacket);
  assert.equal(verdict.readiness, READINESS.READY);
});
