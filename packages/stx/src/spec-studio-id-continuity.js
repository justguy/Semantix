/**
 * Stable-ID continuity guard for Spec Studio multi-turn evaluation.
 *
 * Phalanx replays prior packet, decisions, findings, and context responses
 * on every evaluation request so Semantix can preserve stable
 * requirement / finding / grounded-fact / context-request IDs across
 * turns. This module compares a prior packet against a candidate next
 * packet and reports violations: dropped IDs, silent same-ID mutations,
 * reuse after supersession, resolved findings that quietly disappear,
 * and reissued context-request IDs.
 *
 * Decision IDs remain Phalanx-owned; this module never mints canonical
 * audit decision IDs. It only flags Semantix-side reuse mistakes.
 *
 * Source: docs/phalanx-spec-studio-integration-contract.md:135 and
 * docs/phalanx-spec-studio-integration-contract.md:1098.
 */

import { ValidationError } from "@semantix/core/contracts";

export const ID_CONTINUITY_VIOLATION = Object.freeze({
  REQUIREMENT_DROPPED: "requirement_dropped",
  REQUIREMENT_MUTATED: "requirement_mutated",
  REQUIREMENT_REUSED_AFTER_SUPERSEDE: "requirement_reused_after_supersede",
  REQUIREMENT_SUPERSEDED_WITHOUT_REPLACEMENT: "requirement_superseded_without_replacement",
  FINDING_DROPPED: "finding_dropped",
  FINDING_MUTATED: "finding_mutated",
  FINDING_RESOLVED_REGRESSED: "finding_resolved_regressed",
  GROUNDED_FACT_DROPPED: "grounded_fact_dropped",
  GROUNDED_FACT_MUTATED: "grounded_fact_mutated",
  CONTEXT_REQUEST_REISSUED: "context_request_reissued",
});

const REQUIREMENT_IDENTITY_FIELDS = ["text", "type", "priority", "acceptance"];
const FINDING_IDENTITY_FIELDS = ["text", "kind", "sev", "section", "ref"];
const GROUNDED_FACT_IDENTITY_FIELDS = ["text", "source", "evidenceRef", "confidence"];

function indexById(items) {
  if (!Array.isArray(items)) return new Map();
  const map = new Map();
  for (const item of items) {
    if (item && typeof item.id === "string" && item.id.length > 0) {
      map.set(item.id, item);
    }
  }
  return map;
}

function fieldsEqual(a, b, fields) {
  for (const field of fields) {
    if (a[field] !== b[field]) return false;
  }
  return true;
}

function pushViolation(violations, kind, id, message, extra = {}) {
  violations.push({ kind, id, message, ...extra });
}

function compareRequirements(priorList, nextList, violations, summary) {
  const prior = indexById(priorList);
  const next = indexById(nextList);

  for (const [id, priorReq] of prior) {
    const nextReq = next.get(id);
    if (!nextReq) {
      if (priorReq.status === "superseded") {
        // Prior already superseded; safe to omit if it was replaced.
        // Track silently — supersedion happened in a prior turn.
        continue;
      }
      pushViolation(
        violations,
        ID_CONTINUITY_VIOLATION.REQUIREMENT_DROPPED,
        id,
        `Requirement "${id}" present in prior packet but missing from next packet. Supersede instead of dropping.`,
      );
      continue;
    }

    if (priorReq.status === "superseded" && nextReq.status !== "superseded") {
      pushViolation(
        violations,
        ID_CONTINUITY_VIOLATION.REQUIREMENT_REUSED_AFTER_SUPERSEDE,
        id,
        `Requirement "${id}" was superseded in the prior packet; it cannot be revived in a later turn.`,
        { priorStatus: priorReq.status, nextStatus: nextReq.status },
      );
      continue;
    }

    if (
      nextReq.status === "superseded" &&
      priorReq.status !== "superseded"
    ) {
      // Supersession transition; require supersededBy to be set and refer to
      // an id that exists in the next requirements list.
      if (!nextReq.supersededBy) {
        pushViolation(
          violations,
          ID_CONTINUITY_VIOLATION.REQUIREMENT_SUPERSEDED_WITHOUT_REPLACEMENT,
          id,
          `Requirement "${id}" became superseded but does not name a supersededBy replacement.`,
        );
      } else if (!next.has(nextReq.supersededBy)) {
        pushViolation(
          violations,
          ID_CONTINUITY_VIOLATION.REQUIREMENT_SUPERSEDED_WITHOUT_REPLACEMENT,
          id,
          `Requirement "${id}".supersededBy "${nextReq.supersededBy}" does not exist in the next packet.`,
          { supersededBy: nextReq.supersededBy },
        );
      } else {
        summary.supersededRequirements.push(id);
      }
      continue;
    }

    if (!fieldsEqual(priorReq, nextReq, REQUIREMENT_IDENTITY_FIELDS)) {
      pushViolation(
        violations,
        ID_CONTINUITY_VIOLATION.REQUIREMENT_MUTATED,
        id,
        `Requirement "${id}" mutated without supersedion. Mint a new id and supersede the prior one.`,
        { changedFields: REQUIREMENT_IDENTITY_FIELDS.filter((f) => priorReq[f] !== nextReq[f]) },
      );
      continue;
    }

    summary.preservedRequirements.push(id);
  }

  for (const [id] of next) {
    if (!prior.has(id)) {
      summary.newRequirements.push(id);
    }
  }
}

function compareFindings(priorList, nextList, violations, summary) {
  const prior = indexById(priorList);
  const next = indexById(nextList);

  for (const [id, priorFinding] of prior) {
    const nextFinding = next.get(id);
    if (!nextFinding) {
      pushViolation(
        violations,
        ID_CONTINUITY_VIOLATION.FINDING_DROPPED,
        id,
        `Finding "${id}" present in prior packet but missing from next packet. Resolved findings must remain visible.`,
        { priorResolved: Boolean(priorFinding.resolved) },
      );
      continue;
    }

    if (priorFinding.resolved === true && nextFinding.resolved !== true) {
      pushViolation(
        violations,
        ID_CONTINUITY_VIOLATION.FINDING_RESOLVED_REGRESSED,
        id,
        `Finding "${id}" was resolved in the prior packet but is unresolved in the next packet without an audit reason.`,
      );
    }

    if (!fieldsEqual(priorFinding, nextFinding, FINDING_IDENTITY_FIELDS)) {
      pushViolation(
        violations,
        ID_CONTINUITY_VIOLATION.FINDING_MUTATED,
        id,
        `Finding "${id}" identity fields mutated. Findings must remain stable; raise a new finding instead.`,
        { changedFields: FINDING_IDENTITY_FIELDS.filter((f) => priorFinding[f] !== nextFinding[f]) },
      );
      continue;
    }

    summary.preservedFindings.push(id);
    if (nextFinding.resolved === true) {
      summary.resolvedFindings.push(id);
    }
  }

  for (const [id] of next) {
    if (!prior.has(id)) {
      summary.newFindings.push(id);
    }
  }
}

function compareGroundedFacts(priorList, nextList, violations, summary) {
  const prior = indexById(priorList);
  const next = indexById(nextList);

  for (const [id, priorFact] of prior) {
    const nextFact = next.get(id);
    if (!nextFact) {
      pushViolation(
        violations,
        ID_CONTINUITY_VIOLATION.GROUNDED_FACT_DROPPED,
        id,
        `Grounded fact "${id}" present in prior packet but missing from next packet.`,
      );
      continue;
    }
    if (!fieldsEqual(priorFact, nextFact, GROUNDED_FACT_IDENTITY_FIELDS)) {
      pushViolation(
        violations,
        ID_CONTINUITY_VIOLATION.GROUNDED_FACT_MUTATED,
        id,
        `Grounded fact "${id}" mutated. Mint a new fact id when evidence changes; do not mutate existing facts.`,
        { changedFields: GROUNDED_FACT_IDENTITY_FIELDS.filter((f) => priorFact[f] !== nextFact[f]) },
      );
      continue;
    }
    summary.preservedGroundedFacts.push(id);
  }

  for (const [id] of next) {
    if (!prior.has(id)) {
      summary.newGroundedFacts.push(id);
    }
  }
}

function compareContextRequests(priorList, nextList, violations, summary) {
  const prior = indexById(priorList);
  const next = indexById(nextList);

  for (const [id] of next) {
    if (prior.has(id)) {
      pushViolation(
        violations,
        ID_CONTINUITY_VIOLATION.CONTEXT_REQUEST_REISSUED,
        id,
        `Context request "${id}" was already issued in a prior turn; mint a new id for follow-up requests.`,
      );
      continue;
    }
    summary.newContextRequests.push(id);
  }
}

/**
 * Check stable-ID continuity between a prior packet and a next packet.
 *
 * @param {{
 *   priorPacket: object,
 *   nextPacket: object,
 *   priorContextRequests?: Array<{ id: string }>,
 *   nextContextRequests?: Array<{ id: string }>
 * }} args
 * @returns {{
 *   ok: boolean,
 *   violations: Array<{ kind: string, id: string, message: string, [k: string]: unknown }>,
 *   summary: {
 *     preservedRequirements: string[],
 *     newRequirements: string[],
 *     supersededRequirements: string[],
 *     preservedFindings: string[],
 *     newFindings: string[],
 *     resolvedFindings: string[],
 *     preservedGroundedFacts: string[],
 *     newGroundedFacts: string[],
 *     newContextRequests: string[]
 *   }
 * }}
 */
export function checkIdContinuity({
  priorPacket,
  nextPacket,
  priorContextRequests = [],
  nextContextRequests = [],
}) {
  const violations = [];
  const summary = {
    preservedRequirements: [],
    newRequirements: [],
    supersededRequirements: [],
    preservedFindings: [],
    newFindings: [],
    resolvedFindings: [],
    preservedGroundedFacts: [],
    newGroundedFacts: [],
    newContextRequests: [],
  };

  if (priorPacket && typeof priorPacket === "object" && nextPacket && typeof nextPacket === "object") {
    compareRequirements(priorPacket.requirements, nextPacket.requirements, violations, summary);
    compareFindings(priorPacket.findings, nextPacket.findings, violations, summary);
    compareGroundedFacts(priorPacket.groundedFacts, nextPacket.groundedFacts, violations, summary);
  }

  compareContextRequests(priorContextRequests, nextContextRequests, violations, summary);

  return { ok: violations.length === 0, violations, summary };
}

/**
 * Throw a ValidationError when continuity is violated.
 *
 * @param {Parameters<typeof checkIdContinuity>[0]} args
 * @returns {ReturnType<typeof checkIdContinuity>}
 */
export function assertIdContinuity(args) {
  const result = checkIdContinuity(args);
  if (!result.ok) {
    throw new ValidationError("Stable ID continuity violation across Spec Studio turns.", {
      violations: result.violations,
    });
  }
  return result;
}
