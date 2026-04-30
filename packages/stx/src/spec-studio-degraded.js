/**
 * Honest degraded / unavailable Semantix packet behavior.
 *
 * When Semantix can produce a packet but the alignment review is
 * incomplete - model unavailable, malformed model output, partial
 * service failure, etc. - the adapter must emit a packet that:
 *
 * - keeps `source: "semantix"`
 * - sets `readiness: "needs_user"`
 * - carries at least one blocker finding explaining the degradation
 * - sets `coverage.alignmentPct` to 0 unless a prior packet is
 *   explicitly marked stale-safe by the caller
 * - introduces no new ungrounded requirement facts; prior requirements
 *   carry forward unchanged when a prior packet exists, otherwise the
 *   requirement list stays empty
 * - sets `nextTurn` to null or to a clarifying turn explaining the
 *   degradation
 *
 * If Semantix is fully unreachable, Phalanx must build the
 * `source: "phalanx-degraded"` envelope itself; that fallback path is
 * intentionally NOT minted by this module.
 *
 * Source: docs/phalanx-spec-studio-integration-contract.md:630 (degraded
 * and unavailable behavior) and the upstream degraded sample at
 * docs/phalanx-spec-studio-integration-contract.md:644.
 */

import { ValidationError } from "@semantix/core/contracts";

import {
  CONTRACT_VERSION,
  EXISTING_SYSTEM_MODE,
  READINESS,
  SOURCE_PHALANX_DEGRADED,
  SOURCE_SEMANTIX,
} from "./spec-studio-contracts.js";

const DEFAULT_BLOCKER = Object.freeze({
  id: "F-DEGRADED-001",
  kind: "risk",
  sev: "blocker",
  section: "intent",
  ref: "SEMANTIX",
  text:
    "Alignment review did not complete. Phalanx should not lock or start Staff planning from this packet.",
  resolved: false,
  raisedBy: "semantix",
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safePriorRequirements(priorPacket) {
  if (!isPlainObject(priorPacket)) return [];
  if (!Array.isArray(priorPacket.requirements)) return [];
  return priorPacket.requirements.map((req) => ({ ...req }));
}

function safeFlow(priorPacket) {
  if (
    isPlainObject(priorPacket) &&
    isPlainObject(priorPacket.flow) &&
    Array.isArray(priorPacket.flow.pages)
  ) {
    return JSON.parse(JSON.stringify(priorPacket.flow));
  }
  return { pages: [], states: [], transitions: [], dataNeeded: [] };
}

function safeExistingSystemContext(priorPacket) {
  if (
    isPlainObject(priorPacket) &&
    isPlainObject(priorPacket.existingSystemContext)
  ) {
    return JSON.parse(JSON.stringify(priorPacket.existingSystemContext));
  }
  return { mode: EXISTING_SYSTEM_MODE.UNKNOWN };
}

function safeScope(priorPacket) {
  if (isPlainObject(priorPacket) && isPlainObject(priorPacket.scope)) {
    return JSON.parse(JSON.stringify(priorPacket.scope));
  }
  return { inScope: [], outOfScope: [], negativeRequirements: [] };
}

/**
 * Build an honest Semantix-side degraded packet.
 *
 * @param {{
 *   sessionId: string,
 *   iteration?: number,
 *   originalUserRequest?: string,
 *   alignedRequirement?: string,
 *   reason: string,
 *   blockerId?: string,
 *   priorPacket?: object | null,
 *   staleSafe?: boolean
 * }} options
 * @returns {object} a SemantixAlignmentPacket with degraded semantics
 */
export function createDegradedPacket({
  sessionId,
  iteration,
  originalUserRequest,
  alignedRequirement,
  reason,
  blockerId,
  priorPacket = null,
  staleSafe = false,
}) {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new ValidationError("createDegradedPacket requires a non-empty sessionId.");
  }
  if (typeof reason !== "string" || reason.length === 0) {
    throw new ValidationError("createDegradedPacket requires a non-empty reason.");
  }

  const priorAvailable = isPlainObject(priorPacket);
  const resolvedIteration =
    typeof iteration === "number" && Number.isFinite(iteration)
      ? iteration
      : priorAvailable && typeof priorPacket.iteration === "number"
        ? priorPacket.iteration + 1
        : 0;

  const resolvedOriginal =
    typeof originalUserRequest === "string"
      ? originalUserRequest
      : priorAvailable && typeof priorPacket.originalUserRequest === "string"
        ? priorPacket.originalUserRequest
        : "";

  const resolvedAligned =
    typeof alignedRequirement === "string"
      ? alignedRequirement
      : priorAvailable &&
          staleSafe &&
          typeof priorPacket.alignedRequirement === "string"
        ? priorPacket.alignedRequirement
        : "";

  const requirements = staleSafe ? safePriorRequirements(priorPacket) : [];

  const alignmentPct =
    staleSafe &&
    priorAvailable &&
    isPlainObject(priorPacket.coverage) &&
    typeof priorPacket.coverage.alignmentPct === "number"
      ? priorPacket.coverage.alignmentPct
      : 0;

  const finding = {
    ...DEFAULT_BLOCKER,
    id: blockerId ?? DEFAULT_BLOCKER.id,
    text: reason,
  };

  return {
    contractVersion: CONTRACT_VERSION,
    source: SOURCE_SEMANTIX,
    sessionId,
    iteration: resolvedIteration,
    readiness: READINESS.NEEDS_USER,
    readinessReason:
      "Semantix alignment is degraded; lock cannot be trusted on this packet.",
    blockingReasons: [{ id: "BR-DEGRADED-001", text: reason }],
    approvalRequired: true,
    originalUserRequest: resolvedOriginal,
    alignedRequirement: resolvedAligned,
    requirements,
    flow: priorAvailable && staleSafe ? safeFlow(priorPacket) : { pages: [], states: [], transitions: [], dataNeeded: [] },
    scope: priorAvailable && staleSafe ? safeScope(priorPacket) : { inScope: [], outOfScope: [], negativeRequirements: [] },
    assumptions: [],
    openQuestions: [],
    risks: [],
    userDecisions: [],
    acceptanceSummary: [],
    existingSystemContext: safeExistingSystemContext(priorPacket),
    contextSources: [],
    groundedFacts: [],
    findings: [finding],
    coverage: {
      alignmentPct,
      sections: [],
      openBlockers: 1,
      openConcerns: 0,
      openFYI: 0,
    },
    nextTurn: null,
  };
}

/**
 * Predicate: is this packet eligible to be locked by Phalanx?
 *
 * Semantix readiness is advisory; Phalanx is the lock authority. This
 * predicate matches Phalanx's lock criteria so callers can short-circuit
 * UI affordances and tests can assert that degraded packets are not
 * lockable.
 *
 * @param {object} packet
 * @returns {boolean}
 */
export function isPacketLockable(packet) {
  if (!isPlainObject(packet)) return false;
  if (packet.source !== SOURCE_SEMANTIX) return false;
  if (packet.readiness !== READINESS.READY) return false;
  if (!isPlainObject(packet.coverage)) return false;
  if (packet.coverage.alignmentPct !== 100) return false;
  if (typeof packet.coverage.openBlockers === "number" && packet.coverage.openBlockers !== 0) {
    return false;
  }
  if (Array.isArray(packet.findings)) {
    if (packet.findings.some((finding) => finding && finding.sev === "blocker" && !finding.resolved)) {
      return false;
    }
  }
  return true;
}

/**
 * Predicate: is this packet a degraded Semantix packet?
 *
 * @param {object} packet
 * @returns {boolean}
 */
export function isDegradedPacket(packet) {
  if (!isPlainObject(packet)) return false;
  if (packet.source === SOURCE_PHALANX_DEGRADED) return true;
  if (packet.source !== SOURCE_SEMANTIX) return false;
  if (packet.readiness === READINESS.READY) return false;
  if (!Array.isArray(packet.findings)) return false;
  return packet.findings.some(
    (finding) =>
      finding &&
      finding.sev === "blocker" &&
      typeof finding.id === "string" &&
      /DEGRADED/i.test(finding.id),
  );
}

/**
 * Wrap an evaluator implementation so any thrown error or malformed
 * response degrades honestly into a needs_user packet with a blocker
 * finding instead of bubbling up as a hard failure. The wrapper still
 * never marks a degraded outcome ready.
 *
 * @param {(request: object) => Promise<object> | object} evaluator
 * @param {{ buildEvent?: (degradation: { request: object, error: Error }) => object }} [options]
 * @returns {(request: object) => Promise<object>}
 */
export function withDegradationFallback(evaluator, options = {}) {
  if (typeof evaluator !== "function") {
    throw new ValidationError(
      "withDegradationFallback requires an evaluator function (request => response).",
    );
  }
  const buildEvent = typeof options.buildEvent === "function" ? options.buildEvent : null;

  return async function evaluateWithFallback(request) {
    let response;
    let raisedError = null;
    try {
      response = await evaluator(request);
    } catch (error) {
      raisedError = error instanceof Error ? error : new Error(String(error));
    }

    if (!raisedError && (!isPlainObject(response) || !isPlainObject(response.packet))) {
      raisedError = new Error(
        "Evaluator returned a malformed response (missing packet); degrading honestly.",
      );
    }

    if (raisedError) {
      const sessionId =
        isPlainObject(request) && typeof request.sessionId === "string"
          ? request.sessionId
          : "spec_unknown_session";
      const priorPacket =
        isPlainObject(request) && isPlainObject(request.currentPacket)
          ? request.currentPacket
          : null;
      const packet = createDegradedPacket({
        sessionId,
        iteration:
          priorPacket && typeof priorPacket.iteration === "number"
            ? priorPacket.iteration + 1
            : 0,
        originalUserRequest: priorPacket?.originalUserRequest,
        reason: raisedError.message,
        priorPacket,
        staleSafe: false,
      });
      const event = buildEvent
        ? buildEvent({ request, error: raisedError })
        : {
            id: `evt_degraded_${sessionId}_${Date.now()}`,
            kind: "evaluator.degraded",
            sessionId,
            payload: { reason: raisedError.message },
          };
      return {
        packet,
        events: [event],
        contextRequests: [],
      };
    }

    if (response.packet.readiness === READINESS.READY && !isPacketLockable(response.packet)) {
      // Defensive: caller said ready but coverage/findings disagree.
      // Demote to a degraded packet so we never silently leak ready.
      const sessionId =
        typeof response.packet.sessionId === "string"
          ? response.packet.sessionId
          : "spec_unknown_session";
      const packet = createDegradedPacket({
        sessionId,
        iteration: response.packet.iteration ?? 0,
        originalUserRequest: response.packet.originalUserRequest,
        reason:
          "Evaluator marked readiness=\"ready\" but coverage or blocker findings disagree.",
        priorPacket: response.packet,
        staleSafe: false,
      });
      return {
        packet,
        events: [
          ...(Array.isArray(response.events) ? response.events : []),
          {
            id: `evt_degraded_demote_${sessionId}_${Date.now()}`,
            kind: "evaluator.degraded.demoted",
            sessionId,
            payload: { reason: "ready_demoted_to_needs_user" },
          },
        ],
        contextRequests: Array.isArray(response.contextRequests)
          ? response.contextRequests
          : [],
      };
    }

    return response;
  };
}
