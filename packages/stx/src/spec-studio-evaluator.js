/**
 * Semantix-side evaluator seam for the Phalanx Spec Studio loop.
 *
 * This module defines the call boundary that Phalanx (or a test harness)
 * uses to drive Semantix alignment turns: a typed
 * SemantixEvaluateRequest goes in, and a typed SemantixEvaluateResponse
 * with the next alignment packet, structured spec events, and any
 * context requests comes back. Implementations are injected via
 * createSemantixEvaluator(impl) so tests can drive the seam without
 * starting a long-running service.
 *
 * Source: docs/phalanx-spec-studio-integration-contract.md:600
 */

import { ValidationError } from "@semantix/core/contracts";

import {
  validateFinding,
  validateSemantixAlignmentPacket,
  validateSemantixContextRequest,
  validateSemantixContextResponse,
} from "./spec-studio-contracts.js";

export const EVALUATE_TRIGGER = Object.freeze({
  INITIAL: "initial",
  USER_TURN: "user_turn",
  RECONSIDER: "reconsider",
  CONTEXT_RESPONSE: "context_response",
  DECIDE_ALL: "decide_all",
  SKIP: "skip",
});

export const EVALUATE_TRIGGER_VALUES = Object.freeze([
  EVALUATE_TRIGGER.INITIAL,
  EVALUATE_TRIGGER.USER_TURN,
  EVALUATE_TRIGGER.RECONSIDER,
  EVALUATE_TRIGGER.CONTEXT_RESPONSE,
  EVALUATE_TRIGGER.DECIDE_ALL,
  EVALUATE_TRIGGER.SKIP,
]);

export const USER_TURN_BODY_KIND_VALUES = Object.freeze([
  "text",
  "free",
  "choice",
  "skip",
  "delegate",
  "reconsider",
]);

/**
 * @typedef {"initial" | "user_turn" | "reconsider" | "context_response" | "decide_all" | "skip"} EvaluateTrigger
 */

/**
 * @typedef {{
 *   id: string,
 *   body:
 *     | { kind: "text", text: string }
 *     | { kind: "free", text: string }
 *     | { kind: "choice", picked: string, label: string, questionTurnId?: string }
 *     | { kind: "skip", questionTurnId: string, reason?: string }
 *     | { kind: "delegate", questionTurnId: string, note?: string }
 *     | { kind: "reconsider", priorTurnId: string }
 * }} UserTurnInput
 */

/**
 * @typedef {{
 *   sessionId: string,
 *   trigger: EvaluateTrigger,
 *   userTurn?: UserTurnInput,
 *   currentPacket?: import("./spec-studio-contracts.js").SemantixAlignmentPacket,
 *   decisions: Array<unknown>,
 *   findings: Array<unknown>,
 *   contextResponses: Array<import("./spec-studio-contracts.js").SemantixContextResponse>
 * }} SemantixEvaluateRequest
 */

/**
 * @typedef {{
 *   id: string,
 *   kind: string,
 *   at?: string,
 *   sessionId?: string,
 *   payload?: unknown
 * }} SpecEvent
 */

/**
 * @typedef {{
 *   packet: import("./spec-studio-contracts.js").SemantixAlignmentPacket,
 *   events: SpecEvent[],
 *   contextRequests: Array<import("./spec-studio-contracts.js").SemantixContextRequest>
 * }} SemantixEvaluateResponse
 */

// ---- Internal helpers ------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function pushError(errors, path, code, message) {
  errors.push({ path, code, message });
}

function normalizeContextResponse(response) {
  if (
    isPlainObject(response) &&
    isPlainObject(response.response) &&
    isNonEmptyString(response.requestId)
  ) {
    return {
      ...response.response,
      requestId:
        isNonEmptyString(response.response.requestId)
          ? response.response.requestId
          : response.requestId,
      ...(typeof response.iteration === "number" ? { iteration: response.iteration } : {}),
    };
  }
  return response;
}

/**
 * Normalize known Phalanx request envelope conveniences into the canonical
 * Semantix evaluate request shape before validation or evaluator dispatch.
 *
 * @param {unknown} request
 * @returns {unknown}
 */
export function normalizeSemantixEvaluateRequest(request) {
  if (!isPlainObject(request)) return request;
  const isInitial = request.trigger === EVALUATE_TRIGGER.INITIAL;
  return {
    ...request,
    decisions:
      request.decisions === undefined && isInitial
        ? []
        : request.decisions,
    findings:
      request.findings === undefined && isInitial
        ? []
        : request.findings,
    contextResponses:
      request.contextResponses === undefined && isInitial
        ? []
        : Array.isArray(request.contextResponses)
          ? request.contextResponses.map(normalizeContextResponse)
          : request.contextResponses,
  };
}

function validateUserTurn(userTurn, errors) {
  if (!isPlainObject(userTurn)) {
    pushError(errors, "$.userTurn", "user_turn_not_object", "userTurn must be an object when present.");
    return;
  }
  if (!isNonEmptyString(userTurn.id)) {
    pushError(errors, "$.userTurn.id", "user_turn_missing_id", "userTurn requires an id.");
  }
  if (!isPlainObject(userTurn.body)) {
    pushError(errors, "$.userTurn.body", "user_turn_missing_body", "userTurn requires a body object.");
    return;
  }
  if (!USER_TURN_BODY_KIND_VALUES.includes(userTurn.body.kind)) {
    pushError(
      errors,
      "$.userTurn.body.kind",
      "user_turn_invalid_body_kind",
      `userTurn.body.kind must be one of ${USER_TURN_BODY_KIND_VALUES.join(", ")}.`,
    );
    return;
  }
  if (userTurn.body.kind === "text" || userTurn.body.kind === "free") {
    if (typeof userTurn.body.text !== "string") {
      pushError(
        errors,
        "$.userTurn.body.text",
        "user_turn_missing_text",
        "userTurn body of kind text/free requires a text string.",
      );
    }
  } else if (userTurn.body.kind === "choice") {
    if (!isNonEmptyString(userTurn.body.picked)) {
      pushError(
        errors,
        "$.userTurn.body.picked",
        "user_turn_missing_picked",
        "userTurn body of kind choice requires a picked id.",
      );
    }
    if (typeof userTurn.body.label !== "string") {
      pushError(
        errors,
        "$.userTurn.body.label",
        "user_turn_missing_label",
        "userTurn body of kind choice requires a label string.",
      );
    }
  } else if (userTurn.body.kind === "skip" || userTurn.body.kind === "delegate") {
    if (!isNonEmptyString(userTurn.body.questionTurnId)) {
      pushError(
        errors,
        "$.userTurn.body.questionTurnId",
        "user_turn_missing_question_turn_id",
        `userTurn body of kind ${userTurn.body.kind} requires a questionTurnId.`,
      );
    }
  } else if (userTurn.body.kind === "reconsider") {
    if (!isNonEmptyString(userTurn.body.priorTurnId)) {
      pushError(
        errors,
        "$.userTurn.body.priorTurnId",
        "user_turn_missing_prior_turn_id",
        "userTurn body of kind reconsider requires a priorTurnId.",
      );
    }
  }
}

function validateSpecEvent(event, path, errors) {
  if (!isPlainObject(event)) {
    pushError(errors, path, "spec_event_not_object", "Spec event must be an object.");
    return;
  }
  if (!isNonEmptyString(event.id)) {
    pushError(errors, `${path}.id`, "spec_event_missing_id", "Spec event requires an id.");
  }
  if (!isNonEmptyString(event.kind)) {
    pushError(errors, `${path}.kind`, "spec_event_missing_kind", "Spec event requires a kind.");
  }
}

function validateDecisionEntry(decision, path, errors) {
  if (!isPlainObject(decision)) {
    pushError(errors, path, "decision_not_object", "Decision entries must be objects.");
    return;
  }
  if (!isNonEmptyString(decision.id)) {
    pushError(errors, `${path}.id`, "decision_missing_id", "Decision entries require an id.");
  }
  if (!isNonEmptyString(decision.kind)) {
    pushError(errors, `${path}.kind`, "decision_missing_kind", "Decision entries require a kind.");
  }
  if (decision.answer !== undefined && !isPlainObject(decision.answer)) {
    pushError(errors, `${path}.answer`, "decision_invalid_answer", "Decision answer must be an object when present.");
  }
}

// ---- Public validators -----------------------------------------------------

/**
 * Validate a SemantixEvaluateRequest.
 *
 * @param {unknown} request
 * @returns {{ ok: boolean, errors: Array<{ path: string, code: string, message: string }> }}
 */
export function validateSemantixEvaluateRequest(request) {
  const errors = [];

  if (!isPlainObject(request)) {
    pushError(errors, "$", "request_not_object", "Evaluate request must be an object.");
    return { ok: false, errors };
  }
  const normalizedRequest = normalizeSemantixEvaluateRequest(request);

  if (!isNonEmptyString(normalizedRequest.sessionId)) {
    pushError(errors, "$.sessionId", "missing_session_id", "sessionId is required.");
  }

  if (!EVALUATE_TRIGGER_VALUES.includes(normalizedRequest.trigger)) {
    pushError(
      errors,
      "$.trigger",
      "invalid_trigger",
      `trigger must be one of ${EVALUATE_TRIGGER_VALUES.join(", ")}.`,
    );
  }

  if (normalizedRequest.userTurn !== undefined) {
    validateUserTurn(normalizedRequest.userTurn, errors);
  } else if (
    normalizedRequest.trigger === EVALUATE_TRIGGER.USER_TURN ||
    normalizedRequest.trigger === EVALUATE_TRIGGER.RECONSIDER
  ) {
    pushError(
      errors,
      "$.userTurn",
      "missing_user_turn",
      `trigger="${normalizedRequest.trigger}" requires a userTurn payload.`,
    );
  }

  if (!Array.isArray(normalizedRequest.decisions)) {
    pushError(errors, "$.decisions", "missing_decisions_array", "decisions must be an array.");
  } else {
    normalizedRequest.decisions.forEach((decision, index) => {
      validateDecisionEntry(decision, `$.decisions[${index}]`, errors);
    });
  }
  if (!Array.isArray(normalizedRequest.findings)) {
    pushError(errors, "$.findings", "missing_findings_array", "findings must be an array.");
  } else {
    normalizedRequest.findings.forEach((finding, index) => {
      const findingValidation = validateFinding(finding);
      if (!findingValidation.ok) {
        for (const subError of findingValidation.errors) {
          errors.push({
            path: `$.findings[${index}]${subError.path === "$" ? "" : subError.path.slice(1)}`,
            code: subError.code,
            message: subError.message,
          });
        }
      }
    });
  }
  if (!Array.isArray(normalizedRequest.contextResponses)) {
    pushError(
      errors,
      "$.contextResponses",
      "missing_context_responses_array",
      "contextResponses must be an array.",
    );
  } else {
    normalizedRequest.contextResponses.forEach((response, index) => {
      const responseValidation = validateSemantixContextResponse(response);
      if (!responseValidation.ok) {
        for (const subError of responseValidation.errors) {
          errors.push({
            path: `$.contextResponses[${index}]${subError.path === "$" ? "" : subError.path.slice(1)}`,
            code: subError.code,
            message: subError.message,
          });
        }
      }
    });
  }

  if (normalizedRequest.trigger && normalizedRequest.trigger !== EVALUATE_TRIGGER.INITIAL) {
    if (!isPlainObject(normalizedRequest.currentPacket)) {
      pushError(
        errors,
        "$.currentPacket",
        "missing_current_packet",
        `Non-initial trigger "${normalizedRequest.trigger}" requires currentPacket so stable IDs can be preserved.`,
      );
    } else {
      const packetValidation = validateSemantixAlignmentPacket(normalizedRequest.currentPacket);
      if (!packetValidation.ok) {
        for (const subError of packetValidation.errors) {
          errors.push({
            path: `$.currentPacket${subError.path === "$" ? "" : subError.path.slice(1)}`,
            code: subError.code,
            message: subError.message,
          });
        }
      }
    }
  } else if (normalizedRequest.currentPacket !== undefined && !isPlainObject(normalizedRequest.currentPacket)) {
    pushError(
      errors,
      "$.currentPacket",
      "invalid_current_packet",
      "currentPacket must be an object when present.",
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Throw a ValidationError when the evaluate request is invalid.
 *
 * @param {unknown} request
 * @returns {void}
 */
export function assertSemantixEvaluateRequest(request) {
  const result = validateSemantixEvaluateRequest(request);
  if (!result.ok) {
    throw new ValidationError("Invalid SemantixEvaluateRequest.", { errors: result.errors });
  }
}

/**
 * Validate a SemantixEvaluateResponse.
 *
 * @param {unknown} response
 * @returns {{ ok: boolean, errors: Array<{ path: string, code: string, message: string }> }}
 */
export function validateSemantixEvaluateResponse(response) {
  const errors = [];

  if (!isPlainObject(response)) {
    pushError(errors, "$", "response_not_object", "Evaluate response must be an object.");
    return { ok: false, errors };
  }

  if (!isPlainObject(response.packet)) {
    pushError(errors, "$.packet", "missing_packet", "Evaluate response requires a packet object.");
  } else {
    const packetValidation = validateSemantixAlignmentPacket(response.packet);
    if (!packetValidation.ok) {
      for (const subError of packetValidation.errors) {
        errors.push({
          path: `$.packet${subError.path === "$" ? "" : subError.path.slice(1)}`,
          code: subError.code,
          message: subError.message,
        });
      }
    }
  }

  if (!Array.isArray(response.events)) {
    pushError(errors, "$.events", "missing_events_array", "events must be an array.");
  } else {
    response.events.forEach((event, index) => {
      validateSpecEvent(event, `$.events[${index}]`, errors);
    });
  }

  if (!Array.isArray(response.contextRequests)) {
    pushError(
      errors,
      "$.contextRequests",
      "missing_context_requests_array",
      "contextRequests must be an array.",
    );
  } else {
    response.contextRequests.forEach((req, index) => {
      const reqValidation = validateSemantixContextRequest(req);
      if (!reqValidation.ok) {
        for (const subError of reqValidation.errors) {
          errors.push({
            path: `$.contextRequests[${index}]${subError.path === "$" ? "" : subError.path.slice(1)}`,
            code: subError.code,
            message: subError.message,
          });
        }
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Throw a ValidationError when the evaluate response is invalid.
 *
 * @param {unknown} response
 * @returns {void}
 */
export function assertSemantixEvaluateResponse(response) {
  const result = validateSemantixEvaluateResponse(response);
  if (!result.ok) {
    throw new ValidationError("Invalid SemantixEvaluateResponse.", { errors: result.errors });
  }
}

/**
 * Build an evaluator function that runs requests and responses through the
 * Spec Studio contract validators around an injected implementation.
 *
 * The evaluator does not start a server, does not query Hoplon, and does
 * not assume a particular host repo path. It simply enforces the
 * Semantix-side request/response contract on top of any
 * caller-supplied compute (LLM-backed in production, deterministic in
 * tests).
 *
 * @param {(request: SemantixEvaluateRequest) => SemantixEvaluateResponse | Promise<SemantixEvaluateResponse>} impl
 * @returns {(request: SemantixEvaluateRequest) => Promise<SemantixEvaluateResponse>}
 */
export function createSemantixEvaluator(impl) {
  if (typeof impl !== "function") {
    throw new ValidationError(
      "createSemantixEvaluator requires an impl function (request => response).",
    );
  }

  return async function evaluate(request) {
    const normalizedRequest = normalizeSemantixEvaluateRequest(request);
    assertSemantixEvaluateRequest(normalizedRequest);
    const response = await impl(normalizedRequest);
    assertSemantixEvaluateResponse(response);
    return response;
  };
}
