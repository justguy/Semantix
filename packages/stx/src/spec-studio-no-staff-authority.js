/**
 * Deep-walking guard against Semantix emitting Staff-owned planning content.
 *
 * Semantix aligns user intent. Staff designs the plan, decomposes work,
 * picks files, and writes verify commands. The contract module already
 * blocks Staff-owned fields at the top level of an alignment packet, but
 * that is not enough on its own: Staff-owned content can hide inside
 * nextTurn bodies, requirement extras, finding payloads, event payloads,
 * or context-source/grounded-fact attachments.
 *
 * This module walks any candidate packet (or evaluate response) and
 * reports every path that contains a Staff-owned key, so the seam can
 * fail closed before the packet reaches Phalanx.
 *
 * Source: docs/phalanx-spec-studio-integration-contract.md:9 (boundary),
 * docs/phalanx-spec-studio-integration-contract.md:480 (lock authority),
 * docs/phalanx-spec-studio-integration-contract.md:1107 (degraded
 * envelope ownership) and the Phalanx-side guard mirrored in
 * Project-Phalanx/docs/references/SEMANTIX_SPEC_STUDIO_INTEGRATION_SPEC.md:178.
 */

import { ValidationError } from "@semantix/core/contracts";

/**
 * Top-level Staff-owned field names that the contract validator already
 * blocks before deep-walking the packet. Re-exported from
 * spec-studio-contracts.js for backwards compatibility.
 */
export const STAFF_OWNED_FIELDS = Object.freeze([
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
]);

/**
 * Forbidden Staff-owned key fragments. Matched case-insensitively as
 * substrings so we still catch variants like `staffPlan`, `staff_plan`,
 * `architectureDoc`, `verify_command`, `fileChangeInstructions`, etc.
 */
export const STAFF_OWNED_KEY_FRAGMENTS = Object.freeze([
  "featurepuzzle",
  "designdoc",
  "designdocument",
  "verifycommand",
  "implementationplan",
  "filechange",
  "staffplan",
  "architecturedoc",
  "decompositionplan",
  "executionplan",
]);

const SAFE_TEXT_FIELDS = new Set([
  // Free-text Semantix outputs that may legitimately mention these
  // concepts ("we should not modify the design doc", "verify command in
  // the existing repo", etc.) without carrying Staff authority. Walker
  // skips string content inside these field names.
  "text",
  "summary",
  "reason",
  "readinessReason",
  "rationale",
  "currentBehavior",
  "label",
  "name",
  "purpose",
  "description",
  "question",
  "ctx",
  "q",
  "originalUserRequest",
  "alignedRequirement",
  "acceptance",
  "evidenceRef",
  "query",
]);

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[_\-\s]+/g, "");
}

function isStaffOwnedKey(key) {
  if (typeof key !== "string") return false;
  if (STAFF_OWNED_FIELDS.includes(key)) return true;
  const normalized = normalizeKey(key);
  return STAFF_OWNED_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

function walkValue(value, path, parentKey, results) {
  if (value === null || value === undefined) return;

  if (Array.isArray(value)) {
    value.forEach((entry, index) => {
      walkValue(entry, `${path}[${index}]`, parentKey, results);
    });
    return;
  }

  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = `${path}.${key}`;
      if (isStaffOwnedKey(key)) {
        results.push({
          path: childPath,
          key,
          message: `"${key}" is Staff-owned planning content and must not appear in Semantix output.`,
        });
      }
      walkValue(child, childPath, key, results);
    }
    return;
  }

  // Primitive (string/number/boolean). Only flag if this primitive
  // sits directly under a Staff-owned key. Free-text Semantix prose
  // (e.g. text, summary, rationale) may mention the concepts.
  if (typeof value === "string" && parentKey && SAFE_TEXT_FIELDS.has(parentKey)) {
    return;
  }
}

/**
 * Find every Staff-owned key bleed inside a value (typically a
 * SemantixAlignmentPacket or SemantixEvaluateResponse).
 *
 * @param {unknown} value
 * @returns {Array<{ path: string, key: string, message: string }>}
 */
export function findStaffAuthorityBleed(value) {
  const results = [];
  walkValue(value, "$", null, results);
  return results;
}

/**
 * Validate that no Staff-owned field is present anywhere in the value.
 *
 * @param {unknown} value
 * @returns {{ ok: boolean, errors: Array<{ path: string, code: string, message: string, key: string }> }}
 */
export function validateNoStaffAuthorityBleed(value) {
  const findings = findStaffAuthorityBleed(value);
  return {
    ok: findings.length === 0,
    errors: findings.map((entry) => ({
      path: entry.path,
      code: "staff_owned_field_present",
      message: entry.message,
      key: entry.key,
    })),
  };
}

/**
 * Throw a ValidationError when Staff-owned content is detected.
 *
 * @param {unknown} value
 * @returns {void}
 */
export function assertNoStaffAuthorityBleed(value) {
  const result = validateNoStaffAuthorityBleed(value);
  if (!result.ok) {
    throw new ValidationError(
      "Semantix output contains Staff-owned planning content; that authority is post-lock and Phalanx-owned.",
      { violations: result.errors },
    );
  }
}
