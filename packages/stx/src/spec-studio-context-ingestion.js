/**
 * Spec Studio context-response ingestion.
 *
 * Phalanx returns SemantixContextResponse objects after running the
 * brokered tool calls Semantix asked for. This module merges those
 * responses into a candidate packet:
 *
 * - Facts that arrive with an evidenceRef become first-class
 *   groundedFacts.
 * - The corresponding context request is recorded as a contextSource
 *   whose status reflects whether the underlying tool was used,
 *   skipped, or unavailable.
 * - Empty or errored responses never fabricate groundedFacts.
 *
 * Semantix interpretation of grounded facts (assumptions, risks,
 * findings, recommendations, requirement facts derived from facts)
 * goes into the appropriate slot via recordInterpretationsFromFacts -
 * never into groundedFacts.
 *
 * Source: docs/phalanx-spec-studio-integration-contract.md:230 (context
 * sources and grounded facts), :315 (context response shape), :1017
 * (Hoplon-grounded sample), :1102 (broker boundary).
 */

import { ValidationError } from "@semantix/core/contracts";

import {
  validateGroundedFact,
  validateSemantixContextResponse,
} from "./spec-studio-contracts.js";

const RESPONSE_TO_SOURCE_STATUS = Object.freeze({
  ok: "used",
  empty: "used",
  error: "unavailable",
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function indexById(items) {
  const map = new Map();
  if (!Array.isArray(items)) return map;
  for (const item of items) {
    if (item && typeof item.id === "string" && item.id.length > 0) {
      map.set(item.id, item);
    }
  }
  return map;
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function pickArray(value) {
  return Array.isArray(value) ? value : [];
}

function defaultSourceKindFor(request) {
  if (!isPlainObject(request)) return "phalanx";
  if (Array.isArray(request.requestedFrom) && request.requestedFrom.length > 0) {
    // Prefer the first non-phalanx entry so the source kind reflects
    // where the data actually came from (e.g. hoplon, repo). Fall back
    // to phalanx if the broker is the only listed source.
    const nonBroker = request.requestedFrom.find((kind) => kind !== "phalanx");
    return nonBroker ?? "phalanx";
  }
  return "phalanx";
}

function sourceKindForResponse({ request, response }) {
  if (Array.isArray(response?.facts) && response.facts.length > 0) {
    const factSources = response.facts
      .filter((fact) => isPlainObject(fact) && isNonEmptyString(fact.source))
      .map((fact) => fact.source);
    const unique = [...new Set(factSources)];
    if (unique.length === 1) {
      return unique[0];
    }
  }
  return defaultSourceKindFor(request);
}

function buildContextSource({ request, response, sourceIdPrefix }) {
  const fallbackId = `${sourceIdPrefix}${request?.id ?? response.requestId}`;
  const evidenceRefs = Array.isArray(response.facts)
    ? response.facts
        .filter((fact) => isPlainObject(fact) && isNonEmptyString(fact.evidenceRef))
        .map((fact) => fact.evidenceRef)
    : [];
  return {
    id: fallbackId,
    kind: sourceKindForResponse({ request, response }),
    status: RESPONSE_TO_SOURCE_STATUS[response.status] ?? "unavailable",
    query: isPlainObject(request) ? request.query : undefined,
    summary: typeof response.summary === "string" ? response.summary : "",
    evidenceRefs,
  };
}

/**
 * Merge a batch of context responses (and their originating requests)
 * into a candidate packet.
 *
 * @param {{
 *   packet: object,
 *   responses: Array<object>,
 *   requests?: Array<object>,
 *   sourceIdPrefix?: string,
 *   skippedRequests?: Array<{ requestId: string, summary?: string }>
 * }} args
 * @returns {{
 *   packet: object,
 *   addedFactIds: string[],
 *   addedSourceIds: string[],
 *   skippedFactsWithoutEvidence: Array<{ requestId: string, factId?: string, message: string }>
 * }}
 */
export function ingestContextResponses({
  packet,
  responses = [],
  requests = [],
  sourceIdPrefix = "SRC-",
  skippedRequests = [],
}) {
  if (!isPlainObject(packet)) {
    throw new ValidationError("ingestContextResponses requires a packet object.");
  }

  const next = deepClone(packet);
  next.contextSources = pickArray(next.contextSources);
  next.groundedFacts = pickArray(next.groundedFacts);

  const requestById = indexById(requests);
  const sourcesById = indexById(next.contextSources);
  const factsById = indexById(next.groundedFacts);

  const addedFactIds = [];
  const addedSourceIds = [];
  const skippedFactsWithoutEvidence = [];

  // Honor explicit skipped requests first so the contextSource log
  // accurately reflects user-driven omissions.
  for (const skip of skippedRequests) {
    if (!isPlainObject(skip) || !isNonEmptyString(skip.requestId)) continue;
    const request = requestById.get(skip.requestId);
    const sourceId = `${sourceIdPrefix}${skip.requestId}`;
    if (sourcesById.has(sourceId)) continue;
    const source = {
      id: sourceId,
      kind: defaultSourceKindFor(request),
      status: "skipped",
      query: isPlainObject(request) ? request.query : undefined,
      summary: typeof skip.summary === "string" ? skip.summary : "Context request skipped.",
      evidenceRefs: [],
    };
    next.contextSources.push(source);
    sourcesById.set(source.id, source);
    addedSourceIds.push(source.id);
  }

  for (const response of responses) {
    const validation = validateSemantixContextResponse(response);
    if (!validation.ok) {
      throw new ValidationError("Invalid SemantixContextResponse during ingestion.", {
        errors: validation.errors,
      });
    }
    const request = requestById.get(response.requestId);
    const source = buildContextSource({ request, response, sourceIdPrefix });
    if (!sourcesById.has(source.id)) {
      next.contextSources.push(source);
      sourcesById.set(source.id, source);
      addedSourceIds.push(source.id);
    }

    if (response.status === "error" || response.status === "empty") {
      // Honest non-fact responses; never fabricate groundedFacts here.
      continue;
    }

    for (const fact of pickArray(response.facts)) {
      if (!isPlainObject(fact) || !isNonEmptyString(fact.evidenceRef)) {
        skippedFactsWithoutEvidence.push({
          requestId: response.requestId,
          factId: isPlainObject(fact) ? fact.id : undefined,
          message: "Fact missing evidenceRef; refusing to ingest.",
        });
        continue;
      }
      const factResult = validateGroundedFact(fact);
      if (!factResult.ok) {
        skippedFactsWithoutEvidence.push({
          requestId: response.requestId,
          factId: fact.id,
          message: `Fact rejected by validator: ${factResult.errors.map((e) => e.code).join(", ")}.`,
        });
        continue;
      }
      if (factsById.has(fact.id)) {
        // Stable-id continuity is enforced elsewhere; preserve the
        // existing entry rather than overwriting in-place.
        continue;
      }
      next.groundedFacts.push({ ...fact });
      factsById.set(fact.id, fact);
      addedFactIds.push(fact.id);
    }
  }

  return {
    packet: next,
    addedFactIds,
    addedSourceIds,
    skippedFactsWithoutEvidence,
  };
}

/**
 * Record Semantix interpretations of grounded facts in the appropriate
 * non-grounded slots. Every interpretation must carry a sourceFactRef
 * so the link back to evidence stays auditable, and the helper refuses
 * to write into groundedFacts.
 *
 * @param {{
 *   packet: object,
 *   assumptions?: Array<object>,
 *   risks?: Array<object>,
 *   findings?: Array<object>,
 *   recommendations?: Array<object>,
 *   requirements?: Array<object>
 * }} args
 * @returns {object} a new packet with the interpretations merged in
 */
export function recordInterpretationsFromFacts({
  packet,
  assumptions = [],
  risks = [],
  findings = [],
  recommendations = [],
  requirements = [],
}) {
  if (!isPlainObject(packet)) {
    throw new ValidationError("recordInterpretationsFromFacts requires a packet object.");
  }

  const factIds = new Set(
    pickArray(packet.groundedFacts)
      .map((fact) => (isPlainObject(fact) ? fact.id : null))
      .filter((id) => typeof id === "string" && id.length > 0),
  );
  const collectIds = (entries) =>
    entries.map((entry) => {
      if (!isPlainObject(entry)) {
        throw new ValidationError(
          "Interpretation entries must be objects with sourceFactRef.",
        );
      }
      const ref = entry.sourceFactRef ?? entry.sourceFact ?? null;
      if (!isNonEmptyString(ref)) {
        throw new ValidationError(
          "Interpretation entry is missing sourceFactRef; interpretation must cite a grounded fact.",
        );
      }
      if (!factIds.has(ref)) {
        throw new ValidationError(
          `Interpretation references unknown grounded fact "${ref}".`,
        );
      }
      return ref;
    });

  collectIds(assumptions);
  collectIds(risks);
  collectIds(findings);
  collectIds(recommendations);
  collectIds(requirements);

  const next = deepClone(packet);
  next.assumptions = [...pickArray(next.assumptions), ...assumptions];
  next.risks = [...pickArray(next.risks), ...risks];
  next.findings = [...pickArray(next.findings), ...findings];
  next.recommendations = [...pickArray(next.recommendations), ...recommendations];
  next.requirements = [...pickArray(next.requirements), ...requirements];

  return next;
}
