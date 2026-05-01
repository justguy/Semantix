/**
 * Semantix-side capability handshake adapter for Phalanx Spec Studio.
 *
 * Phalanx (or any caller) can import this adapter to exercise Semantix
 * packet generation, malformed-output handling, unavailable behavior,
 * and prior-state ID preservation from tests, without standing up a
 * long-running Semantix service. The adapter wraps the existing
 * evaluator seam, the degradation fallback, and the stable-id
 * continuity guard so the handshake stays honest end-to-end.
 *
 * This module never queries Hoplon, never starts a server, and never
 * hardcodes a host repo path - the goal is a small callable adapter
 * Phalanx tests can `import` directly via the package exports.
 *
 * Source: Phalanx-side counterpart task `rm-semantix-capability-handshake`.
 */

import { ValidationError } from "@semantix/core/contracts";

import {
  CONTEXT_REQUEST_PURPOSE_VALUES,
  CONTEXT_SOURCE_KIND_VALUES,
  CONTRACT_VERSION,
  EXISTING_SYSTEM_MODE_VALUES,
  FINDING_KIND_VALUES,
  FINDING_SEVERITY_VALUES,
  READINESS_VALUES,
  SOURCE_PHALANX_DEGRADED,
  SOURCE_SEMANTIX,
  validateSemantixAlignmentPacket,
} from "./spec-studio-contracts.js";
import {
  EVALUATE_TRIGGER,
  EVALUATE_TRIGGER_VALUES,
  USER_TURN_BODY_KIND_VALUES,
  normalizeSemantixEvaluateRequest,
  validateSemantixEvaluateRequest,
  validateSemantixEvaluateResponse,
} from "./spec-studio-evaluator.js";
import {
  createDegradedPacket,
  isPacketLockable,
  withDegradationFallback,
} from "./spec-studio-degraded.js";
import {
  checkIdContinuity,
} from "./spec-studio-id-continuity.js";

/**
 * Static description of what the Semantix Spec Studio adapter supports.
 * Phalanx callers read this during capability handshake.
 *
 * @returns {object}
 */
export function describeSemantixCapabilities() {
  return {
    contractVersion: CONTRACT_VERSION,
    sources: [SOURCE_SEMANTIX, SOURCE_PHALANX_DEGRADED],
    triggers: [...EVALUATE_TRIGGER_VALUES],
    userTurnBodyKinds: [...USER_TURN_BODY_KIND_VALUES],
    contextRequestPurposes: [...CONTEXT_REQUEST_PURPOSE_VALUES],
    contextSourceKinds: [...CONTEXT_SOURCE_KIND_VALUES],
    findingKinds: [...FINDING_KIND_VALUES],
    findingSeverities: [...FINDING_SEVERITY_VALUES],
    readinessValues: [...READINESS_VALUES],
    existingSystemModes: [...EXISTING_SYSTEM_MODE_VALUES],
    capabilities: {
      stableIdContinuity: true,
      negativeRequirementsAreFirstClass: true,
      degradedReporting: "semantix-side; phalanx-degraded fallback is Phalanx-owned",
      hoplonAccess: "via phalanx broker only",
      lockAuthority: "phalanx",
      coverageAuthority: "phalanx",
      decisionIdAuthority: "phalanx",
    },
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function fixtureLookup(fixtureResponses, request) {
  if (!fixtureResponses) return null;
  if (typeof fixtureResponses === "function") {
    return fixtureResponses(request);
  }
  if (isPlainObject(fixtureResponses)) {
    if (fixtureResponses[request.trigger]) {
      return fixtureResponses[request.trigger];
    }
    if (fixtureResponses.default) {
      return fixtureResponses.default;
    }
  }
  return null;
}

function buildUnavailableResponse(request, reason) {
  const sessionId = isPlainObject(request) && isNonEmptyString(request.sessionId)
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
    reason,
    priorPacket,
    staleSafe: false,
  });
  return {
    packet,
    events: [
      {
        id: `evt_handshake_unavailable_${sessionId}_${Date.now()}`,
        kind: "semantix.unavailable",
        sessionId,
        payload: { reason },
      },
    ],
    contextRequests: [],
  };
}

/**
 * Build a Semantix handshake adapter. Phalanx imports the resulting
 * `{ describe, evaluate, isAvailable }` and uses it during capability
 * verification or fixture-mode integration tests.
 *
 * @param {{
 *   evaluator?: (request: object) => Promise<object> | object,
 *   fixtureResponses?: object | ((request: object) => object | null),
 *   unavailable?: boolean,
 *   unavailableReason?: string,
 *   strictContinuity?: boolean,
 *   onContinuityViolation?: (violations: Array<object>) => void
 * }} [options]
 * @returns {{
 *   describe: () => object,
 *   evaluate: (request: object) => Promise<object>,
 *   isAvailable: () => boolean
 * }}
 */
export function createSemantixHandshakeAdapter(options = {}) {
  const {
    evaluator,
    fixtureResponses,
    unavailable = false,
    unavailableReason = "Semantix evaluator is currently unavailable.",
    strictContinuity = false,
    onContinuityViolation,
  } = options;

  if (
    !unavailable &&
    typeof evaluator !== "function" &&
    !fixtureResponses
  ) {
    throw new ValidationError(
      "createSemantixHandshakeAdapter requires either an evaluator function, fixtureResponses, or unavailable=true.",
    );
  }

  const baseImpl = async (request) => {
    if (unavailable) {
      return buildUnavailableResponse(request, unavailableReason);
    }

    const fixture = fixtureLookup(fixtureResponses, request);
    if (fixture) {
      return fixture;
    }

    if (typeof evaluator === "function") {
      return evaluator(request);
    }

    return buildUnavailableResponse(
      request,
      "No fixture matched and no evaluator was supplied; degrading honestly.",
    );
  };

  const wrappedEvaluator = withDegradationFallback(baseImpl, {
    buildEvent: ({ request, error }) => ({
      id: `evt_handshake_degraded_${request?.sessionId ?? "unknown"}_${Date.now()}`,
      kind: "semantix.degraded",
      sessionId: request?.sessionId,
      payload: { reason: error.message },
    }),
  });

  async function evaluate(request) {
    const normalizedRequest = normalizeSemantixEvaluateRequest(request);
    const requestValidation = validateSemantixEvaluateRequest(normalizedRequest);
    if (!requestValidation.ok) {
      throw new ValidationError("Invalid SemantixEvaluateRequest at handshake adapter.", {
        errors: requestValidation.errors,
      });
    }

    const response = await wrappedEvaluator(normalizedRequest);

    const responseValidation = validateSemantixEvaluateResponse(response);
    if (!responseValidation.ok) {
      // wrappedEvaluator already demotes malformed packets to degraded
      // ones, so a residual validation failure indicates a deeper bug.
      throw new ValidationError(
        "Handshake evaluator returned an invalid response that the degradation wrapper could not repair.",
        { errors: responseValidation.errors },
      );
    }

    if (
      isPlainObject(request) &&
      isPlainObject(normalizedRequest.currentPacket) &&
      isPlainObject(response.packet)
    ) {
      const continuity = checkIdContinuity({
        priorPacket: normalizedRequest.currentPacket,
        nextPacket: response.packet,
      });
      if (!continuity.ok) {
        if (typeof onContinuityViolation === "function") {
          try {
            onContinuityViolation(continuity.violations);
          } catch {
            // intentional swallow - the callback is observational only
          }
        }
        if (strictContinuity) {
          throw new ValidationError(
            "Handshake adapter detected stable-ID continuity violations across turns.",
            { violations: continuity.violations },
          );
        }
      }
    }

    if (isPlainObject(response) && Array.isArray(response.contextRequests)) {
      const priorContextRequests = Array.isArray(normalizedRequest.contextResponses)
        ? normalizedRequest.contextResponses
            .filter((contextResponse) => isPlainObject(contextResponse) && isNonEmptyString(contextResponse.requestId))
            .map((contextResponse) => ({ id: contextResponse.requestId }))
        : [];
      const continuity = checkIdContinuity({
        priorPacket: null,
        nextPacket: null,
        priorContextRequests,
        nextContextRequests: response.contextRequests,
      });
      if (!continuity.ok) {
        if (typeof onContinuityViolation === "function") {
          try {
            onContinuityViolation(continuity.violations);
          } catch {
            // intentional swallow - the callback is observational only
          }
        }
        if (strictContinuity) {
          throw new ValidationError(
            "Handshake adapter detected context-request ID continuity violations.",
            { violations: continuity.violations },
          );
        }
      }
    }

    return response;
  }

  return {
    describe: describeSemantixCapabilities,
    evaluate,
    isAvailable: () => !unavailable,
    evaluatorMode: typeof evaluator === "function" && evaluator.evaluatorMode ? evaluator.evaluatorMode : "probe",
    capabilities: describeSemantixCapabilities(),
  };
}

/**
 * Convenience predicate Phalanx can call with a packet to confirm that
 * Semantix-side lockability mirrors what Phalanx will compute. Phalanx
 * remains the canonical lock authority.
 *
 * @param {object} packet
 * @returns {boolean}
 */
export function isHandshakePacketLockable(packet) {
  return isPacketLockable(packet);
}

export const HANDSHAKE_TRIGGERS = Object.freeze(EVALUATE_TRIGGER);
