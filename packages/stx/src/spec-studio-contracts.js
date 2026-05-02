/**
 * Semantix-side packet contract module for the Phalanx Spec Studio integration.
 *
 * Mirrors the agreed Phalanx contract documented at
 * docs/phalanx-spec-studio-integration-contract.md and accepts the upstream
 * sample packet semantics (greenfield ready, update ready, ambiguous
 * needs_user, replacement/duplicate blocked, Hoplon-grounded update,
 * and degraded packets).
 *
 * This module owns shape, not behavior. It does not launch Spec Studio runs
 * and does not modify Phalanx runtime code from the Semantix repo.
 */

import { ValidationError } from "@semantix/core/contracts";

import {
  STAFF_OWNED_FIELDS,
  findStaffAuthorityBleed,
} from "./spec-studio-no-staff-authority.js";

export { STAFF_OWNED_FIELDS } from "./spec-studio-no-staff-authority.js";

export const CONTRACT_VERSION = "semantix.phalanx.spec-studio.v1";

export const SOURCE_SEMANTIX = "semantix";
export const SOURCE_PHALANX_DEGRADED = "phalanx-degraded";

export const READINESS = Object.freeze({
  READY: "ready",
  NEEDS_USER: "needs_user",
  BLOCKED: "blocked",
});

export const READINESS_VALUES = Object.freeze([
  READINESS.READY,
  READINESS.NEEDS_USER,
  READINESS.BLOCKED,
]);

export const EXISTING_SYSTEM_MODE = Object.freeze({
  NEW: "new",
  UPDATE: "update",
  UNKNOWN: "unknown",
});

export const EXISTING_SYSTEM_MODE_VALUES = Object.freeze([
  EXISTING_SYSTEM_MODE.NEW,
  EXISTING_SYSTEM_MODE.UPDATE,
  EXISTING_SYSTEM_MODE.UNKNOWN,
]);

export const CONTEXT_SOURCE_KIND_VALUES = Object.freeze([
  "user",
  "html",
  "spec",
  "phalanx",
  "hoplon",
  "repo",
  "trace",
  "upload",
]);

export const CONTEXT_SOURCE_STATUS_VALUES = Object.freeze([
  "used",
  "unavailable",
  "skipped",
]);

export const FINDING_KIND_VALUES = Object.freeze([
  "gap",
  "contradiction",
  "assumption",
  "risk",
  "drift",
]);

export const FINDING_SEVERITY_VALUES = Object.freeze([
  "blocker",
  "concern",
  "fyi",
]);

export const TURN_PHASE_VALUES = Object.freeze([
  "crisp",
  "socratic",
  "adversarial",
  "locked",
]);

export const SECTION_ID_VALUES = Object.freeze([
  "intent",
  "scope",
  "boundaries",
  "success",
  "constraints",
  "assumptions",
  "stakeholders",
  "risks",
  "failure",
  "nfr",
]);

export const REQUIREMENT_TYPE_VALUES = Object.freeze([
  "functional",
  "nonfunctional",
  "negative",
  "constraint",
  "acceptance",
  "integration",
]);

export const REQUIREMENT_PRIORITY_VALUES = Object.freeze([
  "must",
  "should",
  "could",
]);

export const REQUIREMENT_STATUS_VALUES = Object.freeze([
  "proposed",
  "confirmed",
  "contested",
  "superseded",
]);

export const FINDING_RAISED_BY_VALUES = Object.freeze([
  "semantix",
  "user",
  "lint",
  "phalanx",
  "hoplon",
]);

export const CONTEXT_REQUEST_PURPOSE_VALUES = Object.freeze([
  "identify_target_surface",
  "summarize_current_behavior",
  "find_existing_flow",
  "find_reusable_component",
  "find_constraints",
  "collect_hoplon_evidence",
  "inspect_reference_artifact",
]);

export const CONTEXT_REQUEST_SOURCE_VALUES = Object.freeze([
  "phalanx",
  "hoplon",
  "repo",
  "upload",
  "trace",
]);

export const CONTEXT_RESPONSE_STATUS_VALUES = Object.freeze([
  "ok",
  "empty",
  "error",
]);

// Top-level Staff-owned field names live in spec-studio-no-staff-authority.js
// so the deep-walking guard and the packet validator share a single source
// of truth. STAFF_OWNED_FIELDS is re-exported above for backwards
// compatibility with tests and external consumers.

/**
 * @typedef {"ready" | "needs_user" | "blocked"} Readiness
 */

/**
 * @typedef {"new" | "update" | "unknown"} ExistingSystemMode
 */

/**
 * @typedef {"user" | "html" | "spec" | "phalanx" | "hoplon" | "repo" | "trace" | "upload"} ContextSourceKind
 */

/**
 * @typedef {{
 *   id: string,
 *   kind: ContextSourceKind,
 *   status: "used" | "unavailable" | "skipped",
 *   query?: string,
 *   summary: string,
 *   evidenceRefs: string[]
 * }} ContextSource
 */

/**
 * @typedef {{
 *   id: string,
 *   source: ContextSourceKind,
 *   text: string,
 *   confidence: "high" | "medium" | "low",
 *   evidenceRef: string
 * }} GroundedFact
 */

/**
 * @typedef {{
 *   id: string,
 *   kind: "gap" | "contradiction" | "assumption" | "risk" | "drift",
 *   sev: "blocker" | "concern" | "fyi",
 *   section: string,
 *   ref: string,
 *   text: string,
 *   resolved: boolean,
 *   resolvedAt?: string,
 *   active?: boolean,
 *   raisedBy: "semantix" | "user" | "lint" | "phalanx" | "hoplon",
 *   trigger?: { type: string, refId: string },
 *   resolutionDecisionId?: string
 * }} Finding
 */

/**
 * @typedef {{
 *   id: string,
 *   side: "semantix",
 *   at: string,
 *   phase: "crisp" | "socratic" | "adversarial" | "locked",
 *   target: string,
 *   live?: boolean,
 *   findingRef?: string,
 *   body: object
 * }} SemantixTurn
 */

/**
 * @typedef {{
 *   mode: ExistingSystemMode,
 *   systemName?: string,
 *   currentBehavior?: string,
 *   targetSurfaces?: Array<{ id: string, kind: string, name: string }>,
 *   knownFiles?: Array<unknown>,
 *   existingFlows?: Array<unknown>,
 *   existingConstraints?: string[],
 *   doNotChange?: string[],
 *   reuseRequirements?: string[],
 *   compatibilityRequirements?: string[],
 *   migrationConcerns?: string[],
 *   observedProblems?: string[],
 *   referenceArtifacts?: Array<unknown>
 * }} ExistingSystemContext
 */

/**
 * @typedef {{
 *   contractVersion: string | number,
 *   source: "semantix" | "phalanx-degraded",
 *   sessionId: string,
 *   iteration: number,
 *   readiness: Readiness,
 *   readinessReason?: string,
 *   blockingReasons?: Array<{ id: string, text: string }>,
 *   approvalRequired?: boolean,
 *   originalUserRequest: string,
 *   alignedRequirement: string,
 *   requirements: Array<unknown>,
 *   flow?: object,
 *   inScope?: string[],
 *   outOfScope?: string[],
 *   scope?: { inScope: string[], outOfScope: string[], negativeRequirements: string[] },
 *   assumptions?: Array<unknown>,
 *   openQuestions?: Array<unknown>,
 *   risks?: Array<unknown>,
 *   userDecisions?: Array<unknown>,
 *   acceptanceSummary?: string[],
 *   existingSystemContext: ExistingSystemContext,
 *   contextSources?: ContextSource[],
 *   groundedFacts?: GroundedFact[],
 *   findings: Finding[],
 *   coverage: object,
 *   nextTurn: SemantixTurn | null
 * }} SemantixAlignmentPacket
 */

/**
 * @typedef {{
 *   id: string,
 *   sessionId: string,
 *   iteration: number,
 *   purpose: string,
 *   query: string,
 *   requestedFrom: string[],
 *   constraints: object,
 *   reason: string
 * }} SemantixContextRequest
 */

/**
 * @typedef {{
 *   requestId: string,
 *   status: "ok" | "empty" | "error",
 *   facts: GroundedFact[],
 *   artifacts: Array<unknown>,
 *   summary: string,
 *   error?: string
 * }} SemantixContextResponse
 */

// ---- Type guards -----------------------------------------------------------

export function isReadiness(value) {
  return typeof value === "string" && READINESS_VALUES.includes(value);
}

export function isExistingSystemMode(value) {
  return (
    typeof value === "string" && EXISTING_SYSTEM_MODE_VALUES.includes(value)
  );
}

export function isContextSourceKind(value) {
  return (
    typeof value === "string" && CONTEXT_SOURCE_KIND_VALUES.includes(value)
  );
}

export function isFindingKind(value) {
  return typeof value === "string" && FINDING_KIND_VALUES.includes(value);
}

export function isFindingSeverity(value) {
  return typeof value === "string" && FINDING_SEVERITY_VALUES.includes(value);
}

// ---- Internal helpers ------------------------------------------------------

function isPlainObject(value) {
  return (
    value !== null && typeof value === "object" && !Array.isArray(value)
  );
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isString(value) {
  return typeof value === "string";
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function pushError(errors, path, code, message) {
  errors.push({ path, code, message });
}

function validateUniqueIds(items, path, errors, code) {
  const seen = new Set();
  items.forEach((item, index) => {
    if (!isPlainObject(item) || !isNonEmptyString(item.id)) return;
    if (seen.has(item.id)) {
      pushError(
        errors,
        `${path}[${index}].id`,
        code,
        `Duplicate id "${item.id}" is not allowed in ${path}.`,
      );
      return;
    }
    seen.add(item.id);
  });
}

function isAcceptedContractVersion(value) {
  if (typeof value === "number" && value === 1) return true;
  if (typeof value === "string") {
    return value === CONTRACT_VERSION || /^semantix\.phalanx\.spec-studio\.v\d+$/.test(value);
  }
  return false;
}

function validateGroundedFactInternal(fact, path, errors) {
  if (!isPlainObject(fact)) {
    pushError(errors, path, "grounded_fact_not_object", "Grounded fact must be an object.");
    return;
  }
  if (!isNonEmptyString(fact.id)) {
    pushError(errors, `${path}.id`, "grounded_fact_missing_id", "Grounded fact requires a stable id.");
  }
  if (!isContextSourceKind(fact.source)) {
    pushError(
      errors,
      `${path}.source`,
      "grounded_fact_invalid_source",
      `Grounded fact source must be one of ${CONTEXT_SOURCE_KIND_VALUES.join(", ")}.`,
    );
  }
  if (!isNonEmptyString(fact.text)) {
    pushError(errors, `${path}.text`, "grounded_fact_missing_text", "Grounded fact requires text.");
  }
  if (fact.confidence !== undefined && !["high", "medium", "low"].includes(fact.confidence)) {
    pushError(
      errors,
      `${path}.confidence`,
      "grounded_fact_invalid_confidence",
      "Grounded fact confidence must be high, medium, or low.",
    );
  }
  if (!isNonEmptyString(fact.evidenceRef)) {
    pushError(
      errors,
      `${path}.evidenceRef`,
      "grounded_fact_missing_evidence_ref",
      "Grounded fact requires a non-empty evidenceRef.",
    );
  }
}

function validateRequirementInternal(requirement, path, errors) {
  if (!isPlainObject(requirement)) {
    pushError(errors, path, "requirement_not_object", "Requirement must be an object.");
    return;
  }
  if (!isNonEmptyString(requirement.id)) {
    pushError(errors, `${path}.id`, "requirement_missing_id", "Requirement requires a stable id.");
  }
  if (!REQUIREMENT_TYPE_VALUES.includes(requirement.type)) {
    pushError(
      errors,
      `${path}.type`,
      "requirement_invalid_type",
      `Requirement type must be one of ${REQUIREMENT_TYPE_VALUES.join(", ")}.`,
    );
  }
  if (!isNonEmptyString(requirement.text)) {
    pushError(errors, `${path}.text`, "requirement_missing_text", "Requirement requires text.");
  }
  if (!REQUIREMENT_PRIORITY_VALUES.includes(requirement.priority)) {
    pushError(
      errors,
      `${path}.priority`,
      "requirement_invalid_priority",
      `Requirement priority must be one of ${REQUIREMENT_PRIORITY_VALUES.join(", ")}.`,
    );
  }
  if (!isNonEmptyString(requirement.sourceRef)) {
    pushError(errors, `${path}.sourceRef`, "requirement_missing_source_ref", "Requirement requires sourceRef.");
  }
  if (!isNonEmptyString(requirement.acceptance)) {
    pushError(errors, `${path}.acceptance`, "requirement_missing_acceptance", "Requirement requires acceptance.");
  }
  if (!REQUIREMENT_STATUS_VALUES.includes(requirement.status)) {
    pushError(
      errors,
      `${path}.status`,
      "requirement_invalid_status",
      `Requirement status must be one of ${REQUIREMENT_STATUS_VALUES.join(", ")}.`,
    );
  }
  if (
    requirement.status === "superseded" &&
    !isNonEmptyString(requirement.supersededBy)
  ) {
    pushError(
      errors,
      `${path}.supersededBy`,
      "requirement_missing_superseded_by",
      "Superseded requirements must name supersededBy.",
    );
  }
}

function validateContextSourceInternal(source, path, errors) {
  if (!isPlainObject(source)) {
    pushError(errors, path, "context_source_not_object", "Context source must be an object.");
    return;
  }
  if (!isNonEmptyString(source.id)) {
    pushError(errors, `${path}.id`, "context_source_missing_id", "Context source requires an id.");
  }
  if (!isContextSourceKind(source.kind)) {
    pushError(
      errors,
      `${path}.kind`,
      "context_source_invalid_kind",
      `Context source kind must be one of ${CONTEXT_SOURCE_KIND_VALUES.join(", ")}.`,
    );
  }
  if (!CONTEXT_SOURCE_STATUS_VALUES.includes(source.status)) {
    pushError(
      errors,
      `${path}.status`,
      "context_source_invalid_status",
      `Context source status must be one of ${CONTEXT_SOURCE_STATUS_VALUES.join(", ")}.`,
    );
  }
  if (!isString(source.summary)) {
    pushError(
      errors,
      `${path}.summary`,
      "context_source_missing_summary",
      "Context source requires a summary string.",
    );
  }
  if (source.evidenceRefs !== undefined && !isStringArray(source.evidenceRefs)) {
    pushError(
      errors,
      `${path}.evidenceRefs`,
      "context_source_invalid_evidence_refs",
      "Context source evidenceRefs must be an array of strings.",
    );
  }
}

function validateFindingInternal(finding, path, errors) {
  if (!isPlainObject(finding)) {
    pushError(errors, path, "finding_not_object", "Finding must be an object.");
    return;
  }
  if (!isNonEmptyString(finding.id)) {
    pushError(errors, `${path}.id`, "finding_missing_id", "Finding requires a stable id.");
  }
  if (!isFindingKind(finding.kind)) {
    pushError(
      errors,
      `${path}.kind`,
      "finding_invalid_kind",
      `Finding kind must be one of ${FINDING_KIND_VALUES.join(", ")}.`,
    );
  }
  if (!isFindingSeverity(finding.sev)) {
    pushError(
      errors,
      `${path}.sev`,
      "finding_invalid_severity",
      `Finding severity must be one of ${FINDING_SEVERITY_VALUES.join(", ")}.`,
    );
  }
  if (!SECTION_ID_VALUES.includes(finding.section)) {
    pushError(
      errors,
      `${path}.section`,
      "finding_invalid_section",
      `Finding section must be one of ${SECTION_ID_VALUES.join(", ")}.`,
    );
  }
  if (!isNonEmptyString(finding.ref)) {
    pushError(errors, `${path}.ref`, "finding_missing_ref", "Finding requires a ref.");
  }
  if (!isString(finding.text)) {
    pushError(errors, `${path}.text`, "finding_missing_text", "Finding requires a text body.");
  }
  if (typeof finding.resolved !== "boolean") {
    pushError(
      errors,
      `${path}.resolved`,
      "finding_invalid_resolved",
      "Finding.resolved must be a boolean.",
    );
  }
  if (!FINDING_RAISED_BY_VALUES.includes(finding.raisedBy)) {
    pushError(
      errors,
      `${path}.raisedBy`,
      "finding_invalid_raised_by",
      `Finding raisedBy must be one of ${FINDING_RAISED_BY_VALUES.join(", ")}.`,
    );
  }
}

function validateTurnOptions(options, path, errors) {
  if (options === undefined) return;
  if (!Array.isArray(options) || options.length === 0) {
    pushError(
      errors,
      path,
      "next_turn_options_missing",
      "nextTurn question options must be a non-empty array when provided.",
    );
    return;
  }
  if (options.length > 5) {
    pushError(
      errors,
      path,
      "next_turn_options_too_many",
      "nextTurn question options allow at most 5 options.",
    );
  }
  options.forEach((option, index) => {
    const optionPath = `${path}[${index}]`;
    if (!isPlainObject(option)) {
      pushError(
        errors,
        optionPath,
        "next_turn_option_not_object",
        "nextTurn question options must be objects.",
      );
      return;
    }
    if (!isNonEmptyString(option.id)) {
      pushError(
        errors,
        `${optionPath}.id`,
        "next_turn_option_missing_id",
        "nextTurn question option requires an id.",
      );
    }
    if (!isNonEmptyString(option.label)) {
      pushError(
        errors,
        `${optionPath}.label`,
        "next_turn_option_missing_label",
        "nextTurn question option requires a label.",
      );
    }
  });
}

function validateSemantixTurnInternal(turn, path, errors) {
  if (turn === null) return;
  if (!isPlainObject(turn)) {
    pushError(errors, path, "next_turn_not_object", "nextTurn must be an object or null.");
    return;
  }
  if (!isNonEmptyString(turn.id)) {
    pushError(errors, `${path}.id`, "next_turn_missing_id", "nextTurn requires an id.");
  }
  if (turn.side !== "semantix") {
    pushError(
      errors,
      `${path}.side`,
      "next_turn_invalid_side",
      "nextTurn.side must equal \"semantix\".",
    );
  }
  if (turn.phase !== undefined && !TURN_PHASE_VALUES.includes(turn.phase)) {
    pushError(
      errors,
      `${path}.phase`,
      "next_turn_invalid_phase",
      `nextTurn.phase must be one of ${TURN_PHASE_VALUES.join(", ")}.`,
    );
  }
  if (!isNonEmptyString(turn.at)) {
    pushError(errors, `${path}.at`, "next_turn_missing_at", "nextTurn requires an ISO timestamp string.");
  }
  if (!isNonEmptyString(turn.target)) {
    pushError(errors, `${path}.target`, "next_turn_missing_target", "nextTurn requires a target.");
  }
  if (turn.body === undefined || turn.body === null) {
    pushError(errors, `${path}.body`, "next_turn_missing_body", "nextTurn requires a body.");
  } else if (!isPlainObject(turn.body)) {
    pushError(errors, `${path}.body`, "next_turn_invalid_body", "nextTurn.body must be an object.");
  } else if (turn.body.kind && !["question", "finding", "batch"].includes(turn.body.kind)) {
    pushError(
      errors,
      `${path}.body.kind`,
      "next_turn_invalid_body_kind",
      "nextTurn.body.kind must be \"question\", \"finding\", or \"batch\".",
    );
  } else if (turn.body.kind === "question") {
    if (!isNonEmptyString(turn.body.q)) {
      pushError(
        errors,
        `${path}.body.q`,
        "next_turn_question_missing_text",
        "nextTurn question bodies require q.",
      );
    }
    validateTurnOptions(turn.body.options, `${path}.body.options`, errors);
  } else if (turn.body.kind === "batch") {
    if (!Array.isArray(turn.body.questions) || turn.body.questions.length === 0) {
      pushError(
        errors,
        `${path}.body.questions`,
        "next_turn_batch_missing_questions",
        "nextTurn batch bodies require a non-empty questions array.",
      );
    }
  } else if (turn.body.kind === "finding" && !isNonEmptyString(turn.findingRef)) {
    pushError(
      errors,
      `${path}.findingRef`,
      "next_turn_finding_missing_ref",
      "nextTurn finding bodies require findingRef.",
    );
  }
}

function validateExistingSystemContextInternal(esc, path, errors, packetReadiness) {
  if (esc === undefined || esc === null) {
    pushError(
      errors,
      path,
      "existing_system_context_missing",
      "Packet must include existingSystemContext.",
    );
    return;
  }
  if (!isPlainObject(esc)) {
    pushError(
      errors,
      path,
      "existing_system_context_not_object",
      "existingSystemContext must be an object.",
    );
    return;
  }
  if (!isExistingSystemMode(esc.mode)) {
    pushError(
      errors,
      `${path}.mode`,
      "existing_system_context_invalid_mode",
      `existingSystemContext.mode must be one of ${EXISTING_SYSTEM_MODE_VALUES.join(", ")}.`,
    );
    return;
  }

  if (packetReadiness === READINESS.READY) {
    if (esc.mode === EXISTING_SYSTEM_MODE.UNKNOWN) {
      pushError(
        errors,
        `${path}.mode`,
        "ready_with_unknown_mode",
        "readiness=\"ready\" is incompatible with existingSystemContext.mode=\"unknown\".",
      );
    }
    if (esc.mode === EXISTING_SYSTEM_MODE.UPDATE) {
      if (!nonEmptyArray(esc.targetSurfaces)) {
        pushError(
          errors,
          `${path}.targetSurfaces`,
          "ready_update_missing_target_surfaces",
          "readiness=\"ready\" with mode=\"update\" requires at least one targetSurface.",
        );
      }
      const hasNonChange = nonEmptyArray(esc.doNotChange);
      const hasReuse = nonEmptyArray(esc.reuseRequirements);
      const hasCompatibility = nonEmptyArray(esc.compatibilityRequirements);
      if (!hasNonChange && !hasReuse && !hasCompatibility) {
        pushError(
          errors,
          `${path}`,
          "ready_update_missing_boundaries",
          "readiness=\"ready\" with mode=\"update\" requires at least one of doNotChange, reuseRequirements, or compatibilityRequirements.",
        );
      }
    }
  }
}

// ---- Public validators -----------------------------------------------------

/**
 * Validate a Semantix Spec Studio alignment packet.
 *
 * @param {unknown} packet
 * @returns {{ ok: boolean, errors: Array<{ path: string, code: string, message: string }> }}
 */
export function validateSemantixAlignmentPacket(packet) {
  const errors = [];

  if (!isPlainObject(packet)) {
    pushError(errors, "$", "packet_not_object", "Packet must be an object.");
    return { ok: false, errors };
  }

  for (const bleed of findStaffAuthorityBleed(packet)) {
    pushError(errors, bleed.path, "staff_owned_field_present", bleed.message);
  }

  if (!isAcceptedContractVersion(packet.contractVersion)) {
    pushError(
      errors,
      "$.contractVersion",
      "invalid_contract_version",
      `contractVersion must equal ${CONTRACT_VERSION} (or 1).`,
    );
  }

  if (
    packet.source !== SOURCE_SEMANTIX &&
    packet.source !== SOURCE_PHALANX_DEGRADED
  ) {
    pushError(
      errors,
      "$.source",
      "invalid_source",
      `source must equal "${SOURCE_SEMANTIX}" or "${SOURCE_PHALANX_DEGRADED}".`,
    );
  }

  if (!isNonEmptyString(packet.sessionId)) {
    pushError(errors, "$.sessionId", "missing_session_id", "sessionId is required.");
  }

  if (typeof packet.iteration !== "number" || !Number.isFinite(packet.iteration)) {
    pushError(errors, "$.iteration", "invalid_iteration", "iteration must be a finite number.");
  }

  if (!isReadiness(packet.readiness)) {
    pushError(
      errors,
      "$.readiness",
      "invalid_readiness",
      `readiness must be one of ${READINESS_VALUES.join(", ")}.`,
    );
  }

  if (packet.source === SOURCE_PHALANX_DEGRADED && packet.readiness === READINESS.READY) {
    pushError(
      errors,
      "$.readiness",
      "phalanx_degraded_cannot_be_ready",
      "source=\"phalanx-degraded\" packets cannot be readiness=\"ready\".",
    );
  }

  if (typeof packet.originalUserRequest !== "string") {
    pushError(
      errors,
      "$.originalUserRequest",
      "missing_original_user_request",
      "originalUserRequest must be a string (preserve raw user wording).",
    );
  }

  if (typeof packet.alignedRequirement !== "string") {
    pushError(
      errors,
      "$.alignedRequirement",
      "missing_aligned_requirement",
      "alignedRequirement must be a string.",
    );
  }

  if (!Array.isArray(packet.requirements)) {
    pushError(
      errors,
      "$.requirements",
      "missing_requirements_array",
      "requirements must be an array.",
    );
  } else {
    validateUniqueIds(packet.requirements, "$.requirements", errors, "duplicate_requirement_id");
    packet.requirements.forEach((requirement, index) => {
      validateRequirementInternal(requirement, `$.requirements[${index}]`, errors);
    });
  }

  validateExistingSystemContextInternal(
    packet.existingSystemContext,
    "$.existingSystemContext",
    errors,
    packet.readiness,
  );

  if (packet.flow !== undefined && !isPlainObject(packet.flow)) {
    pushError(errors, "$.flow", "invalid_flow", "flow must be an object when present.");
  }

  if (Array.isArray(packet.contextSources)) {
    validateUniqueIds(packet.contextSources, "$.contextSources", errors, "duplicate_context_source_id");
    packet.contextSources.forEach((source, index) => {
      validateContextSourceInternal(source, `$.contextSources[${index}]`, errors);
    });
  } else if (packet.contextSources !== undefined || packet.readiness === READINESS.READY) {
    pushError(
      errors,
      "$.contextSources",
      "invalid_context_sources",
      "contextSources must be an array.",
    );
  }

  if (Array.isArray(packet.groundedFacts)) {
    validateUniqueIds(packet.groundedFacts, "$.groundedFacts", errors, "duplicate_grounded_fact_id");
    packet.groundedFacts.forEach((fact, index) => {
      validateGroundedFactInternal(fact, `$.groundedFacts[${index}]`, errors);
    });
  } else if (packet.groundedFacts !== undefined || packet.readiness === READINESS.READY) {
    pushError(
      errors,
      "$.groundedFacts",
      "invalid_grounded_facts",
      "groundedFacts must be an array.",
    );
  }

  if (Array.isArray(packet.findings)) {
    validateUniqueIds(packet.findings, "$.findings", errors, "duplicate_finding_id");
    packet.findings.forEach((finding, index) => {
      validateFindingInternal(finding, `$.findings[${index}]`, errors);
    });
  } else {
    pushError(errors, "$.findings", "invalid_findings", "findings must be an array.");
  }

  if (!isPlainObject(packet.coverage)) {
    pushError(errors, "$.coverage", "invalid_coverage", "coverage must be an object.");
  } else {
    if (typeof packet.coverage.alignmentPct !== "number") {
      pushError(
        errors,
        "$.coverage.alignmentPct",
        "invalid_coverage_alignment_pct",
        "coverage.alignmentPct must be a number.",
      );
    }
    if (!Array.isArray(packet.coverage.sections)) {
      pushError(
        errors,
        "$.coverage.sections",
        "invalid_coverage_sections",
        "coverage.sections must be an array.",
      );
    }
  }

  if (!Object.prototype.hasOwnProperty.call(packet, "nextTurn")) {
    pushError(errors, "$.nextTurn", "missing_next_turn", "nextTurn is required (use null when none).");
  } else {
    validateSemantixTurnInternal(packet.nextTurn, "$.nextTurn", errors);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Throw a ValidationError when the packet is invalid.
 *
 * @param {unknown} packet
 * @returns {void}
 */
export function assertSemantixAlignmentPacket(packet) {
  const result = validateSemantixAlignmentPacket(packet);
  if (!result.ok) {
    throw new ValidationError("Invalid Semantix alignment packet.", { errors: result.errors });
  }
}

/**
 * Validate a Semantix context request emitted to Phalanx.
 *
 * @param {unknown} request
 * @returns {{ ok: boolean, errors: Array<{ path: string, code: string, message: string }> }}
 */
export function validateSemantixContextRequest(request) {
  const errors = [];

  if (!isPlainObject(request)) {
    pushError(errors, "$", "request_not_object", "Context request must be an object.");
    return { ok: false, errors };
  }

  if (!isNonEmptyString(request.id)) {
    pushError(errors, "$.id", "missing_id", "Context request requires an id.");
  }
  if (!isNonEmptyString(request.sessionId)) {
    pushError(errors, "$.sessionId", "missing_session_id", "Context request requires a sessionId.");
  }
  if (typeof request.iteration !== "number" || !Number.isFinite(request.iteration)) {
    pushError(errors, "$.iteration", "invalid_iteration", "iteration must be a finite number.");
  }
  if (
    typeof request.purpose !== "string" ||
    !CONTEXT_REQUEST_PURPOSE_VALUES.includes(request.purpose)
  ) {
    pushError(
      errors,
      "$.purpose",
      "invalid_purpose",
      `purpose must be one of ${CONTEXT_REQUEST_PURPOSE_VALUES.join(", ")}.`,
    );
  }
  if (!isNonEmptyString(request.query)) {
    pushError(errors, "$.query", "missing_query", "Context request requires a non-empty query.");
  }
  if (
    !Array.isArray(request.requestedFrom) ||
    request.requestedFrom.length === 0 ||
    !request.requestedFrom.every((source) => CONTEXT_REQUEST_SOURCE_VALUES.includes(source))
  ) {
    pushError(
      errors,
      "$.requestedFrom",
      "invalid_requested_from",
      `requestedFrom must be a non-empty array of ${CONTEXT_REQUEST_SOURCE_VALUES.join(", ")}.`,
    );
  }
  if (request.constraints === undefined || !isPlainObject(request.constraints)) {
    pushError(
      errors,
      "$.constraints",
      "invalid_constraints",
      "constraints must be an object (may be empty).",
    );
  } else {
    const c = request.constraints;
    if (c.maxResults !== undefined && (typeof c.maxResults !== "number" || c.maxResults < 0)) {
      pushError(errors, "$.constraints.maxResults", "invalid_max_results", "maxResults must be a non-negative number.");
    }
    if (c.targetRepo !== undefined && typeof c.targetRepo !== "string") {
      pushError(errors, "$.constraints.targetRepo", "invalid_target_repo", "targetRepo must be a string.");
    }
    if (c.targetPaths !== undefined && !isStringArray(c.targetPaths)) {
      pushError(errors, "$.constraints.targetPaths", "invalid_target_paths", "targetPaths must be an array of strings.");
    }
    if (
      c.allowedSources !== undefined &&
      (!Array.isArray(c.allowedSources) ||
        !c.allowedSources.every((source) => CONTEXT_REQUEST_SOURCE_VALUES.includes(source)))
    ) {
      pushError(
        errors,
        "$.constraints.allowedSources",
        "invalid_allowed_sources",
        `allowedSources must use values in ${CONTEXT_REQUEST_SOURCE_VALUES.join(", ")}.`,
      );
    }
    if (
      c.mustReturnEvidenceRefs !== undefined &&
      typeof c.mustReturnEvidenceRefs !== "boolean"
    ) {
      pushError(
        errors,
        "$.constraints.mustReturnEvidenceRefs",
        "invalid_must_return_evidence_refs",
        "mustReturnEvidenceRefs must be a boolean.",
      );
    }
  }
  if (!isNonEmptyString(request.reason)) {
    pushError(errors, "$.reason", "missing_reason", "reason must be a non-empty string.");
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Throw a ValidationError when the context request is invalid.
 *
 * @param {unknown} request
 * @returns {void}
 */
export function assertSemantixContextRequest(request) {
  const result = validateSemantixContextRequest(request);
  if (!result.ok) {
    throw new ValidationError("Invalid Semantix context request.", { errors: result.errors });
  }
}

/**
 * Validate a Phalanx-supplied context response.
 *
 * @param {unknown} response
 * @returns {{ ok: boolean, errors: Array<{ path: string, code: string, message: string }> }}
 */
export function validateSemantixContextResponse(response) {
  const errors = [];

  if (!isPlainObject(response)) {
    pushError(errors, "$", "response_not_object", "Context response must be an object.");
    return { ok: false, errors };
  }

  if (!isNonEmptyString(response.requestId)) {
    pushError(errors, "$.requestId", "missing_request_id", "Context response requires a requestId.");
  }
  if (!CONTEXT_RESPONSE_STATUS_VALUES.includes(response.status)) {
    pushError(
      errors,
      "$.status",
      "invalid_status",
      `status must be one of ${CONTEXT_RESPONSE_STATUS_VALUES.join(", ")}.`,
    );
  }
  if (!Array.isArray(response.facts)) {
    pushError(errors, "$.facts", "invalid_facts", "facts must be an array.");
  } else {
    response.facts.forEach((fact, index) => {
      validateGroundedFactInternal(fact, `$.facts[${index}]`, errors);
    });
  }
  if (response.artifacts !== undefined && !Array.isArray(response.artifacts)) {
    pushError(errors, "$.artifacts", "invalid_artifacts", "artifacts must be an array when present.");
  }
  if (typeof response.summary !== "string") {
    pushError(errors, "$.summary", "missing_summary", "summary must be a string.");
  }
  if (response.status === "error" && !isNonEmptyString(response.error)) {
    pushError(
      errors,
      "$.error",
      "missing_error_detail",
      "error responses require a non-empty error detail.",
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Throw a ValidationError when the context response is invalid.
 *
 * @param {unknown} response
 * @returns {void}
 */
export function assertSemantixContextResponse(response) {
  const result = validateSemantixContextResponse(response);
  if (!result.ok) {
    throw new ValidationError("Invalid Semantix context response.", { errors: result.errors });
  }
}

/**
 * Validate a single grounded fact in isolation.
 *
 * @param {unknown} fact
 * @returns {{ ok: boolean, errors: Array<{ path: string, code: string, message: string }> }}
 */
export function validateGroundedFact(fact) {
  const errors = [];
  validateGroundedFactInternal(fact, "$", errors);
  return { ok: errors.length === 0, errors };
}

/**
 * Validate a single context source in isolation.
 *
 * @param {unknown} source
 * @returns {{ ok: boolean, errors: Array<{ path: string, code: string, message: string }> }}
 */
export function validateContextSource(source) {
  const errors = [];
  validateContextSourceInternal(source, "$", errors);
  return { ok: errors.length === 0, errors };
}

/**
 * Validate a single finding in isolation.
 *
 * @param {unknown} finding
 * @returns {{ ok: boolean, errors: Array<{ path: string, code: string, message: string }> }}
 */
export function validateFinding(finding) {
  const errors = [];
  validateFindingInternal(finding, "$", errors);
  return { ok: errors.length === 0, errors };
}

/**
 * Validate the optional nextTurn payload (null is allowed).
 *
 * @param {unknown} turn
 * @returns {{ ok: boolean, errors: Array<{ path: string, code: string, message: string }> }}
 */
export function validateSemantixTurn(turn) {
  const errors = [];
  validateSemantixTurnInternal(turn, "$", errors);
  return { ok: errors.length === 0, errors };
}
