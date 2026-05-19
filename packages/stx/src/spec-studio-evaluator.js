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
  normalizeSemantixAlignmentPacketForContract,
  validateFinding,
  validateSemantixAlignmentPacket,
  validateSemantixContextRequest,
  validateSemantixContextResponse,
} from "./spec-studio-contracts.js";

export const EVALUATOR_MODE = Object.freeze({
  PROBE: "probe",
  LLM: "llm",
});

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
  "batch",
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
 *   contextRequests: Array<import("./spec-studio-contracts.js").SemantixContextRequest>,
 *   turnLogEntry?: SemantixTurnLogEntry
 * }} SemantixEvaluateResponse
 */

/**
 * @typedef {{
 *   value: number | null,
 *   label?: string | null
 * }} SemantixTurnLogScore
 */

/**
 * @typedef {{
 *   confidence: SemantixTurnLogScore,
 *   alignment: SemantixTurnLogScore,
 *   effort: SemantixTurnLogScore
 * }} SemantixTurnLogScores
 */

/**
 * @typedef {{
 *   id: string,
 *   sessionId: string,
 *   iteration: number | null,
 *   turnNumber: number | null,
 *   trigger: string | null,
 *   at: string,
 *   readiness: string | null,
 *   readinessReason: string,
 *   done: boolean,
 *   statusMessage: string,
 *   beginningScores: SemantixTurnLogScores,
 *   afterTurnScores: SemantixTurnLogScores,
 *   answersSubmitted: Array<{ id: string, question: string, answer: string }>,
 *   questionsNowOpen: Array<{ id: string, question: string, options?: Array<{ id: string, label: string }> }>,
 *   decisionsRecorded: Array<{ id: string, question: string, answer: string, section?: string }>,
 *   learnings: string[],
 *   diagnostics: {
 *     degraded: boolean,
 *     stalledNeedsUser: boolean,
 *     llmAttemptCount: number,
 *     correctiveRetryCount: number,
 *     retryReasons: string[],
 *     discrepancy: null | { kind: string, message: string }
 *   }
 * }} SemantixTurnLogEntry
 */

// ---- Internal helpers ------------------------------------------------------

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function textOf(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isPlainObject(value)) {
    for (const key of ["text", "question", "q", "label", "summary", "name", "description", "reason"]) {
      if (typeof value[key] === "string" && value[key].trim().length > 0) {
        return value[key].trim();
      }
    }
  }
  return "";
}

function optionText(option) {
  if (typeof option === "string") return option.trim();
  if (!isPlainObject(option)) return "";
  return textOf(option.label ?? option.text ?? option.description ?? option.id);
}

function optionId(option, index) {
  if (isPlainObject(option) && isNonEmptyString(option.id)) return option.id;
  return `OPT-${index + 1}`;
}

function turnLogQuestionFromBatchItem(question, index) {
  const questionText = textOf(question?.q ?? question?.question ?? question);
  if (!questionText) return null;
  return {
    id: isPlainObject(question) && isNonEmptyString(question.id) ? question.id : `Q-${index + 1}`,
    question: questionText,
    options: asArray(question?.options)
      .map((option, optionIndex) => ({
        id: optionId(option, optionIndex),
        label: optionText(option),
      }))
      .filter((option) => option.label),
  };
}

function turnLogQuestions(packet) {
  const body = packet?.nextTurn?.body;
  if (!isPlainObject(body)) return [];
  if (body.kind === "batch") {
    return asArray(body.questions)
      .map(turnLogQuestionFromBatchItem)
      .filter(Boolean);
  }
  if (body.kind === "question") {
    const questionText = textOf(body.q ?? body.question);
    if (!questionText) return [];
    return [
      {
        id: isNonEmptyString(packet?.nextTurn?.id) ? packet.nextTurn.id : "question",
        question: questionText,
        options: asArray(body.options)
          .map((option, optionIndex) => ({
            id: optionId(option, optionIndex),
            label: optionText(option),
          }))
          .filter((option) => option.label),
      },
    ];
  }
  return [];
}

function openQuestionMap(packet) {
  const map = new Map();
  for (const question of [
    ...turnLogQuestions(packet),
    ...asArray(packet?.openQuestions).map(turnLogQuestionFromBatchItem).filter(Boolean),
  ]) {
    if (!map.has(question.id)) map.set(question.id, question);
  }
  return map;
}

function selectedAnswerText(answer, question) {
  if (!isPlainObject(answer)) return textOf(answer);
  if (typeof answer.text === "string" && answer.text.trim().length > 0) {
    return answer.text.trim();
  }
  if (typeof answer.label === "string" && answer.label.trim().length > 0) {
    return answer.label.trim();
  }
  const picked = answer.picked ?? answer.optId ?? answer.optionId;
  if (picked) {
    const option = asArray(question?.options).find((candidate) => candidate.id === picked);
    return option?.label || String(picked);
  }
  return "";
}

function turnLogSubmittedAnswers(request) {
  const body = request?.userTurn?.body;
  if (!isPlainObject(body)) return [];
  if (body.kind === "text") {
    return [{
      id: "initial-request",
      question: "Initial request",
      answer: typeof body.text === "string" ? body.text : "",
    }];
  }
  const priorQuestions = openQuestionMap(request?.currentPacket);
  if (body.kind === "batch") {
    return asArray(body.answers).map((answer, index) => {
      const questionId = answer?.questionId ?? answer?.questionRef ?? `answer-${index + 1}`;
      const question = priorQuestions.get(questionId);
      return {
        id: questionId,
        question: question?.question || questionId,
        answer: selectedAnswerText(answer, question) || "No answer submitted",
      };
    });
  }
  if (body.kind === "choice" || body.kind === "free") {
    const questionId =
      body.questionTurnId ??
      body.questionId ??
      body.questionRef ??
      request?.currentPacket?.nextTurn?.id ??
      [...priorQuestions.keys()][0] ??
      "answer";
    const question = priorQuestions.get(questionId);
    return [{
      id: questionId,
      question: question?.question || questionId,
      answer: selectedAnswerText(body, question) || "No answer submitted",
    }];
  }
  if (body.kind === "skip" || body.kind === "delegate" || body.kind === "reconsider") {
    return [{
      id: body.questionTurnId ?? body.priorTurnId ?? request?.userTurn?.id ?? "turn",
      question: body.questionTurnId ?? body.priorTurnId ?? body.kind,
      answer: body.reason ?? body.note ?? body.kind,
    }];
  }
  return [];
}

function answerFromDecision(decision) {
  const answer = decision?.answer;
  if (!isPlainObject(answer)) return textOf(answer);
  return textOf(answer.text ?? answer.label ?? answer.optId ?? answer.optionId ?? answer);
}

function turnLogDecisions(request, response) {
  const priorIds = new Set(asArray(request?.currentPacket?.userDecisions)
    .map((decision) => decision?.id)
    .filter(isNonEmptyString));
  return asArray(response?.packet?.userDecisions)
    .filter((decision) => isPlainObject(decision) && isNonEmptyString(decision.id) && !priorIds.has(decision.id))
    .map((decision) => ({
      id: decision.id,
      question: textOf(decision.question ?? decision.questionRef ?? decision),
      answer: answerFromDecision(decision),
      ...(isNonEmptyString(decision.section) ? { section: decision.section } : {}),
    }));
}

function alignmentScore(packet) {
  const parsed = Number(packet?.coverage?.alignmentPct);
  return clampPercent(parsed);
}

function unresolvedFindings(packet) {
  return asArray(packet?.findings).filter((finding) => isPlainObject(finding) && finding.resolved !== true);
}

function turnLogIsDegraded(response) {
  if (asArray(response?.events).some((event) => /degraded/i.test(event?.kind ?? ""))) return true;
  if (/degraded/i.test(response?.packet?.readinessReason ?? "")) return true;
  return asArray(response?.packet?.findings).some((finding) => /DEGRADED/i.test(finding?.id ?? ""));
}

function effortScore(packet, response = null) {
  if (!isPlainObject(packet)) return { value: null, label: null };
  const findings = unresolvedFindings(packet);
  const blockers = Number.isFinite(Number(packet.coverage?.openBlockers))
    ? Number(packet.coverage.openBlockers)
    : findings.filter((finding) => finding.sev === "blocker").length;
  const concerns = Number.isFinite(Number(packet.coverage?.openConcerns))
    ? Number(packet.coverage.openConcerns)
    : findings.filter((finding) => finding.sev === "concern").length;
  const attempts = asArray(response?.llmResponses).length;
  const value = clampPercent(
    18 +
    (turnLogQuestions(packet).length * 7) +
    (blockers * 12) +
    (concerns * 5) +
    (Math.max(0, attempts - 1) * 8) +
    (response && turnLogIsDegraded(response) ? 18 : 0),
  );
  const label = value == null ? null : value >= 70 ? "high" : value >= 36 ? "medium" : "low";
  return { value, label };
}

function turnLogScores(packet, response = null) {
  const effort = effortScore(packet, response);
  return {
    confidence: { value: null, label: null },
    alignment: { value: alignmentScore(packet), label: null },
    effort: { value: effort.value, label: effort.label },
  };
}

function uniqueTexts(values) {
  return [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
}

function isMissingQuestionReason(reason) {
  return /visible clarifying question|next_turn_question_missing_text|next_turn_batch_missing_questions|missing_next_turn|next_turn_missing_body/i.test(
    reason ?? "",
  );
}

function turnLogDiagnostics(response) {
  const retryEvents = asArray(response?.events).filter((event) => event?.kind === "llm.evaluator.corrective_retry");
  const retryReasons = uniqueTexts([
    ...retryEvents.map((event) => event?.payload?.reason),
    ...asArray(response?.llmResponses).map((trace) => trace?.retryReason),
  ]);
  const degraded = turnLogIsDegraded(response);
  const stalledNeedsUser =
    response?.packet?.readiness === "needs_user" && turnLogQuestions(response.packet).length === 0;
  const discrepancy = (!degraded && stalledNeedsUser) || retryReasons.some(isMissingQuestionReason)
    ? {
        kind: "needs_user_without_answerable_question",
        message:
          "Semantix needs user input, but one evaluator attempt did not provide an answerable next question.",
      }
    : null;
  return {
    degraded,
    stalledNeedsUser,
    llmAttemptCount: asArray(response?.llmResponses).length,
    correctiveRetryCount: retryEvents.length,
    retryReasons,
    discrepancy,
  };
}

function turnLogLearnings(response, diagnostics) {
  const packet = response?.packet;
  const items = [];
  if (isNonEmptyString(packet?.readinessReason)) {
    items.push(`Readiness: ${packet.readinessReason}`);
  }
  if (diagnostics.discrepancy) {
    items.push(`Discrepancy: ${diagnostics.discrepancy.message}`);
  }
  for (const reason of asArray(packet?.blockingReasons)) {
    const text = textOf(reason);
    if (text) items.push(`Blocking: ${text}`);
  }
  for (const finding of unresolvedFindings(packet)) {
    const text = textOf(finding);
    if (text) items.push(`${finding.sev ?? "finding"}: ${text}`);
  }
  for (const assumption of asArray(packet?.assumptions)) {
    const text = textOf(assumption);
    if (text) items.push(`Assumption: ${text}`);
  }
  for (const risk of asArray(packet?.risks)) {
    const text = textOf(risk);
    if (text) items.push(`Risk: ${text}`);
  }
  for (const reason of diagnostics.retryReasons) {
    items.push(`Retry: ${reason}`);
  }
  return uniqueTexts(items).slice(0, 12);
}

function turnLogStatusMessage(packet, diagnostics) {
  if (packet?.readiness === "ready") {
    return "Done: alignment is ready and compile is available.";
  }
  if (diagnostics.degraded) {
    return "Not done: evaluator degraded and needs another alignment attempt.";
  }
  if (diagnostics.stalledNeedsUser) {
    return "Not done: blockers remain, but no usable next question was returned.";
  }
  if (packet?.readiness === "blocked") {
    return "Not done: alignment is blocked.";
  }
  return "Not done: alignment still needs user input.";
}

/**
 * Build a compact, user-facing turn-log entry from a Semantix evaluation.
 *
 * The API stays stateless: callers append this entry to their persisted
 * session log to render the full chronological Turn log.
 *
 * @param {SemantixEvaluateRequest} request
 * @param {SemantixEvaluateResponse} response
 * @returns {SemantixTurnLogEntry}
 */
export function buildSemantixTurnLogEntry(request, response) {
  const packet = response?.packet ?? {};
  const diagnostics = turnLogDiagnostics(response);
  const iteration = Number.isFinite(Number(packet.iteration)) ? Number(packet.iteration) : null;
  const sessionId = isNonEmptyString(packet.sessionId)
    ? packet.sessionId
    : isNonEmptyString(request?.sessionId)
      ? request.sessionId
      : "spec_unknown_session";
  return {
    id: `turnlog:${sessionId}:${request?.trigger ?? "unknown"}:${iteration ?? "unknown"}`,
    sessionId,
    iteration,
    turnNumber: iteration == null ? null : iteration + 1,
    trigger: isNonEmptyString(request?.trigger) ? request.trigger : null,
    at: new Date().toISOString(),
    readiness: isNonEmptyString(packet.readiness) ? packet.readiness : null,
    readinessReason: isNonEmptyString(packet.readinessReason) ? packet.readinessReason : "",
    done: packet.readiness === "ready",
    statusMessage: turnLogStatusMessage(packet, diagnostics),
    beginningScores: turnLogScores(request?.currentPacket ?? null),
    afterTurnScores: turnLogScores(packet, response),
    answersSubmitted: turnLogSubmittedAnswers(request),
    questionsNowOpen: turnLogQuestions(packet),
    decisionsRecorded: turnLogDecisions(request, response),
    learnings: turnLogLearnings(response, diagnostics),
    diagnostics,
  };
}

/**
 * Attach the per-response turn-log entry without changing the canonical
 * packet/events/contextRequests contract.
 *
 * @param {SemantixEvaluateRequest} request
 * @param {SemantixEvaluateResponse} response
 * @returns {SemantixEvaluateResponse}
 */
export function withSemantixTurnLogEntry(request, response) {
  if (!isPlainObject(response)) return response;
  return {
    ...response,
    turnLogEntry: buildSemantixTurnLogEntry(request, response),
  };
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
    currentPacket: isPlainObject(request.currentPacket)
      ? normalizeSemantixAlignmentPacketForContract(request.currentPacket)
      : request.currentPacket,
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
  } else if (userTurn.body.kind === "batch") {
    if (!Array.isArray(userTurn.body.answers) || userTurn.body.answers.length === 0) {
      pushError(
        errors,
        "$.userTurn.body.answers",
        "user_turn_batch_missing_answers",
        "userTurn body of kind batch requires a non-empty answers array.",
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
    const normalizedResponse = isPlainObject(response) && isPlainObject(response.packet)
      ? {
          ...response,
          packet: normalizeSemantixAlignmentPacketForContract(response.packet),
        }
      : response;
    assertSemantixEvaluateResponse(normalizedResponse);
    return withSemantixTurnLogEntry(normalizedRequest, normalizedResponse);
  };
}
