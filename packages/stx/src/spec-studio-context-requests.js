/**
 * Phalanx-brokered context request generator.
 *
 * Semantix never queries Hoplon directly. When existing-system facts
 * materially affect readiness or acceptance clarity, Semantix emits a
 * SemantixContextRequest and lets Phalanx broker the actual fetch
 * through Hoplon, the repo index, uploads, or trace storage. This
 * module builds well-formed context requests for every supported
 * purpose and exposes a gap-driven planner that decides which requests
 * to emit for a candidate packet.
 *
 * Source: docs/phalanx-spec-studio-integration-contract.md:264 (Tool
 * Context Requested From Phalanx) and the upstream
 * SEMANTIX_SPEC_STUDIO_INTEGRATION_SPEC.md context-request protocol
 * around line 132.
 */

import { ValidationError } from "@semantix/core/contracts";

import {
  CONTEXT_REQUEST_PURPOSE_VALUES,
  CONTEXT_REQUEST_SOURCE_VALUES,
  EXISTING_SYSTEM_MODE,
  validateSemantixContextRequest,
} from "./spec-studio-contracts.js";

export const CONTEXT_REQUEST_PURPOSE = Object.freeze({
  IDENTIFY_TARGET_SURFACE: "identify_target_surface",
  SUMMARIZE_CURRENT_BEHAVIOR: "summarize_current_behavior",
  FIND_EXISTING_FLOW: "find_existing_flow",
  FIND_REUSABLE_COMPONENT: "find_reusable_component",
  FIND_CONSTRAINTS: "find_constraints",
  COLLECT_HOPLON_EVIDENCE: "collect_hoplon_evidence",
  INSPECT_REFERENCE_ARTIFACT: "inspect_reference_artifact",
});

const PURPOSE_DEFAULT_SOURCES = Object.freeze({
  identify_target_surface: ["phalanx", "hoplon", "repo"],
  summarize_current_behavior: ["phalanx", "hoplon", "trace"],
  find_existing_flow: ["phalanx", "repo"],
  find_reusable_component: ["phalanx", "repo"],
  find_constraints: ["phalanx", "repo", "hoplon"],
  collect_hoplon_evidence: ["phalanx", "hoplon"],
  inspect_reference_artifact: ["phalanx", "upload"],
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueIntersect(values, allowed) {
  const allowedSet = new Set(allowed);
  return Array.from(new Set(values.filter((value) => allowedSet.has(value))));
}

function defaultRequestedFrom(purpose) {
  const defaults = PURPOSE_DEFAULT_SOURCES[purpose];
  return defaults ? [...defaults] : ["phalanx"];
}

function nextSequenceId(sequencer) {
  sequencer.counter += 1;
  return `${sequencer.prefix}${String(sequencer.counter).padStart(3, "0")}`;
}

/**
 * Build a structured SemantixContextRequest. Pass an explicit `id` to
 * pin the request id; otherwise the caller is responsible for choosing
 * a stable id (or use createContextRequestSequencer to mint them).
 *
 * @param {{
 *   id: string,
 *   sessionId: string,
 *   iteration: number,
 *   purpose: string,
 *   query: string,
 *   requestedFrom?: string[],
 *   constraints?: object,
 *   reason: string
 * }} input
 * @returns {object}
 */
export function createContextRequest(input) {
  if (!isPlainObject(input)) {
    throw new ValidationError("createContextRequest requires an input object.");
  }

  const {
    id,
    sessionId,
    iteration,
    purpose,
    query,
    requestedFrom,
    constraints = {},
    reason,
  } = input;

  if (!isNonEmptyString(id)) {
    throw new ValidationError("Context request requires a stable non-empty id.");
  }
  if (!isNonEmptyString(sessionId)) {
    throw new ValidationError("Context request requires a sessionId.");
  }
  if (typeof iteration !== "number" || !Number.isFinite(iteration)) {
    throw new ValidationError("Context request requires a numeric iteration.");
  }
  if (!CONTEXT_REQUEST_PURPOSE_VALUES.includes(purpose)) {
    throw new ValidationError(
      `Context request purpose must be one of ${CONTEXT_REQUEST_PURPOSE_VALUES.join(", ")}.`,
    );
  }
  if (!isNonEmptyString(query)) {
    throw new ValidationError("Context request requires a non-empty query.");
  }
  if (!isNonEmptyString(reason)) {
    throw new ValidationError("Context request requires a non-empty reason.");
  }

  const baseSources = Array.isArray(requestedFrom) && requestedFrom.length > 0
    ? requestedFrom
    : defaultRequestedFrom(purpose);
  const sanitizedRequestedFrom = uniqueIntersect(baseSources, CONTEXT_REQUEST_SOURCE_VALUES);
  if (sanitizedRequestedFrom.length === 0) {
    sanitizedRequestedFrom.push("phalanx");
  }
  if (!sanitizedRequestedFrom.includes("phalanx")) {
    sanitizedRequestedFrom.unshift("phalanx");
  }

  const sanitizedConstraints = isPlainObject(constraints) ? { ...constraints } : {};
  if (Array.isArray(sanitizedConstraints.allowedSources)) {
    sanitizedConstraints.allowedSources = uniqueIntersect(
      sanitizedConstraints.allowedSources,
      CONTEXT_REQUEST_SOURCE_VALUES,
    );
    if (sanitizedConstraints.allowedSources.length === 0) {
      delete sanitizedConstraints.allowedSources;
    }
  }
  if (sanitizedConstraints.mustReturnEvidenceRefs === undefined && shouldRequireEvidence(purpose)) {
    sanitizedConstraints.mustReturnEvidenceRefs = true;
  }

  const request = {
    id,
    sessionId,
    iteration,
    purpose,
    query: query.trim(),
    requestedFrom: sanitizedRequestedFrom,
    constraints: sanitizedConstraints,
    reason: reason.trim(),
  };

  const validation = validateSemantixContextRequest(request);
  if (!validation.ok) {
    throw new ValidationError("createContextRequest produced an invalid request.", {
      errors: validation.errors,
    });
  }
  return request;
}

function shouldRequireEvidence(purpose) {
  return (
    purpose === CONTEXT_REQUEST_PURPOSE.COLLECT_HOPLON_EVIDENCE ||
    purpose === CONTEXT_REQUEST_PURPOSE.SUMMARIZE_CURRENT_BEHAVIOR ||
    purpose === CONTEXT_REQUEST_PURPOSE.FIND_REUSABLE_COMPONENT
  );
}

/**
 * Mint a stable id sequencer so multiple context requests within a
 * single Semantix turn don't collide. Sequencer is per-session.
 *
 * @param {{ sessionId: string, iteration?: number, prefix?: string, start?: number }} input
 * @returns {{ counter: number, prefix: string, sessionId: string, iteration: number, next(): string }}
 */
export function createContextRequestSequencer({
  sessionId,
  iteration = 0,
  prefix = "CTX-",
  start = 0,
}) {
  if (!isNonEmptyString(sessionId)) {
    throw new ValidationError("createContextRequestSequencer requires a sessionId.");
  }
  const sequencer = {
    counter: typeof start === "number" ? start : 0,
    prefix,
    sessionId,
    iteration,
    next() {
      return nextSequenceId(sequencer);
    },
  };
  return sequencer;
}

// ---- Per-purpose helpers ---------------------------------------------------

function buildHelper(purpose) {
  return function helper({
    sessionId,
    iteration = 0,
    id,
    sequencer,
    query,
    constraints = {},
    requestedFrom,
    reason,
    targetRepo,
    targetPaths,
    maxResults,
  } = {}) {
    const resolvedId =
      id ?? (sequencer ? sequencer.next() : null);
    if (!resolvedId) {
      throw new ValidationError(
        `${purpose} helper requires an explicit id or a sequencer.`,
      );
    }
    const finalConstraints = { ...constraints };
    if (typeof targetRepo === "string") finalConstraints.targetRepo = targetRepo;
    if (Array.isArray(targetPaths)) finalConstraints.targetPaths = targetPaths;
    if (typeof maxResults === "number") finalConstraints.maxResults = maxResults;

    return createContextRequest({
      id: resolvedId,
      sessionId: sessionId ?? sequencer?.sessionId,
      iteration: iteration ?? sequencer?.iteration ?? 0,
      purpose,
      query,
      requestedFrom,
      constraints: finalConstraints,
      reason,
    });
  };
}

export const requestIdentifyTargetSurface = buildHelper(
  CONTEXT_REQUEST_PURPOSE.IDENTIFY_TARGET_SURFACE,
);
export const requestSummarizeCurrentBehavior = buildHelper(
  CONTEXT_REQUEST_PURPOSE.SUMMARIZE_CURRENT_BEHAVIOR,
);
export const requestFindExistingFlow = buildHelper(
  CONTEXT_REQUEST_PURPOSE.FIND_EXISTING_FLOW,
);
export const requestFindReusableComponent = buildHelper(
  CONTEXT_REQUEST_PURPOSE.FIND_REUSABLE_COMPONENT,
);
export const requestFindConstraints = buildHelper(
  CONTEXT_REQUEST_PURPOSE.FIND_CONSTRAINTS,
);
export const requestCollectHoplonEvidence = buildHelper(
  CONTEXT_REQUEST_PURPOSE.COLLECT_HOPLON_EVIDENCE,
);
export const requestInspectReferenceArtifact = buildHelper(
  CONTEXT_REQUEST_PURPOSE.INSPECT_REFERENCE_ARTIFACT,
);

// ---- Gap-driven planner ----------------------------------------------------

function packetIsAmbiguousMode(packet) {
  return (
    isPlainObject(packet) &&
    isPlainObject(packet.existingSystemContext) &&
    packet.existingSystemContext.mode === EXISTING_SYSTEM_MODE.UNKNOWN
  );
}

function packetIsUpdateMissingTargetSurface(packet) {
  if (!isPlainObject(packet)) return false;
  const esc = packet.existingSystemContext;
  if (!isPlainObject(esc)) return false;
  if (esc.mode !== EXISTING_SYSTEM_MODE.UPDATE) return false;
  return !Array.isArray(esc.targetSurfaces) || esc.targetSurfaces.length === 0;
}

function packetIsUpdateMissingBoundaries(packet) {
  if (!isPlainObject(packet)) return false;
  const esc = packet.existingSystemContext;
  if (!isPlainObject(esc)) return false;
  if (esc.mode !== EXISTING_SYSTEM_MODE.UPDATE) return false;
  return (
    (!Array.isArray(esc.doNotChange) || esc.doNotChange.length === 0) &&
    (!Array.isArray(esc.reuseRequirements) || esc.reuseRequirements.length === 0) &&
    (!Array.isArray(esc.compatibilityRequirements) ||
      esc.compatibilityRequirements.length === 0)
  );
}

function packetReferencesArtifacts(packet) {
  if (!isPlainObject(packet)) return false;
  const esc = packet.existingSystemContext;
  if (!isPlainObject(esc)) return false;
  return Array.isArray(esc.referenceArtifacts) && esc.referenceArtifacts.length > 0;
}

/**
 * Plan the set of context requests Semantix should emit for a packet
 * based on which existing-system facts are still missing. Only emits
 * requests when the missing context materially affects readiness.
 *
 * @param {{
 *   packet: object,
 *   sessionId?: string,
 *   iteration?: number,
 *   sequencer?: ReturnType<typeof createContextRequestSequencer>
 * }} args
 * @returns {Array<object>}
 */
export function planContextRequests({ packet, sessionId, iteration, sequencer }) {
  if (!isPlainObject(packet)) return [];

  const sid = sessionId ?? packet.sessionId ?? sequencer?.sessionId;
  const iter =
    typeof iteration === "number"
      ? iteration
      : typeof packet.iteration === "number"
        ? packet.iteration
        : (sequencer?.iteration ?? 0);
  const seq = sequencer ?? createContextRequestSequencer({ sessionId: sid, iteration: iter });

  const requests = [];

  if (packetIsAmbiguousMode(packet)) {
    requests.push(
      requestIdentifyTargetSurface({
        sequencer: seq,
        sessionId: sid,
        iteration: iter,
        query:
          "Determine whether the requested work updates an existing surface or introduces a new one. " +
          (packet.originalUserRequest
            ? `Source request: "${packet.originalUserRequest}".`
            : ""),
        reason:
          "existingSystemContext.mode is unknown; readiness cannot be classified without target-surface clarity.",
      }),
    );
    return requests;
  }

  if (packetIsUpdateMissingTargetSurface(packet)) {
    requests.push(
      requestIdentifyTargetSurface({
        sequencer: seq,
        sessionId: sid,
        iteration: iter,
        query:
          packet.originalUserRequest
            ? `Identify the existing surface impacted by: "${packet.originalUserRequest}".`
            : "Identify the existing surface impacted by the current request.",
        reason:
          "Update mode without targetSurfaces; lock cannot be granted until the target surface is known.",
      }),
    );
  }

  if (packetIsUpdateMissingBoundaries(packet)) {
    requests.push(
      requestSummarizeCurrentBehavior({
        sequencer: seq,
        sessionId: sid,
        iteration: iter,
        query:
          "Summarize the current behavior of the target surface so reuse and non-change boundaries can be identified.",
        reason:
          "Update mode lacks doNotChange / reuseRequirements / compatibilityRequirements; current behavior is required to draft them.",
      }),
    );
    requests.push(
      requestFindReusableComponent({
        sequencer: seq,
        sessionId: sid,
        iteration: iter,
        query:
          "Find existing components, modules, or services that can be reused instead of rebuilt for this update.",
        reason:
          "Need to enumerate reusable components before locking an update plan.",
      }),
    );
    requests.push(
      requestFindConstraints({
        sequencer: seq,
        sessionId: sid,
        iteration: iter,
        query:
          "Surface compatibility, migration, or non-change constraints documented in the project.",
        reason:
          "Update flow requires explicit boundaries; constraints in repo or Phalanx records may already document them.",
      }),
    );
  }

  if (packetReferencesArtifacts(packet)) {
    for (const artifact of packet.existingSystemContext.referenceArtifacts) {
      requests.push(
        requestInspectReferenceArtifact({
          sequencer: seq,
          sessionId: sid,
          iteration: iter,
          query: `Inspect reference artifact ${
            isPlainObject(artifact) && typeof artifact.id === "string" ? artifact.id : "(unknown)"
          } to extract grounded facts.`,
          reason:
            "User attached reference artifacts; their content materially affects acceptance and reuse boundaries.",
        }),
      );
    }
  }

  return requests;
}
