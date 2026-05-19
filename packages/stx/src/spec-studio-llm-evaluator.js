/**
 * LLM-backed Spec Studio evaluator for the Semantix alignment loop.
 *
 * Covers ss-llm-002 (contract design), ss-llm-003 (implementation),
 * and ss-llm-004 (degraded output handling).
 *
 * The connector.execute() call mirrors the pattern used in
 * codex-semantix-layer.js createLlmClassificationProvider().
 */

import { randomUUID } from "node:crypto";

import {
  CONTEXT_SOURCE_KIND_VALUES,
  CONTRACT_VERSION,
  EXISTING_SYSTEM_MODE,
  FINDING_KIND_VALUES,
  FINDING_RAISED_BY_VALUES,
  FINDING_SEVERITY_VALUES,
  normalizeGroundedFactConfidence,
  normalizeSemantixAlignmentPacketForContract,
  READINESS,
  READINESS_VALUES,
  REQUIREMENT_PRIORITY_VALUES,
  REQUIREMENT_STATUS_VALUES,
  REQUIREMENT_TYPE_VALUES,
  SECTION_ID_VALUES,
  SOURCE_SEMANTIX,
  TURN_PHASE_VALUES,
  validateSemantixAlignmentPacket,
} from "./spec-studio-contracts.js";
import { withDegradationFallback } from "./spec-studio-degraded.js";
import { withSemantixTurnLogEntry } from "./spec-studio-evaluator.js";
import { checkIdContinuity } from "./spec-studio-id-continuity.js";
import {
  applyUserBatchTurn,
  applyUserChoiceTurn,
} from "./spec-studio-user-turn-loop.js";

// ---- ss-llm-002: contract design -------------------------------------------

/**
 * Build the system prompt that instructs the LLM to act as a Spec Studio
 * alignment evaluator and produce a SemantixAlignmentPacket JSON object.
 *
 * @returns {string}
 */
export function buildEvaluatorSystemPrompt() {
  return [
    "You are the Semantix Spec Studio alignment evaluator.",
    "Your job is to analyze a user's feature or change request and produce a structured alignment packet.",
    "",
    "Rules:",
    "- Return exactly ONE JSON object and nothing else (no markdown, no explanation).",
    "- The JSON must conform to the SemantixAlignmentPacket schema.",
    "- Do not invent facts about the codebase or project that were not provided.",
    "- Ask clarifying questions when the request is ambiguous: use nextTurn.body.kind=\"question\" for one blocking gap, or nextTurn.body.kind=\"batch\" for 2-5 independent gaps the user can answer together.",
    "- Use documentation-grill discipline: challenge terms that conflict with glossary, context docs, ADRs, grounded facts, or currentPacket decisions.",
    "- When a term is vague or overloaded, ask one focused question, recommend the canonical answer, and include option.description rationale for each discrete answer.",
    "- Clarifying questions must be concrete and specific to the user's request. Do not ask broad meta-questions that merely ask what should be clarified.",
    "- Never emit schema placeholders, angle-bracket placeholder tokens, TBD text, or placeholder labels.",
    "- If the request names a product/domain, each question should name a real unresolved decision for that product/domain.",
    "- When a creation request is extremely underspecified, do not spend the whole turn only asking new-vs-update. If no current/existing surface is referenced, record a low-confidence assumption that this is a new surface and ask a batch for purpose, audience, core behavior, target surface, constraints, and success criteria.",
    "- If repo/docs context can answer the question, request or use that context instead of asking the user to restate it.",
    "- Preserve resolved terminology in requirements, findings, userDecisions, groundedFacts, and existingSystemContext boundaries; do not mutate CONTEXT.md or ADR files from this evaluator.",
    "- Offer an ADR only for decisions that are hard to reverse, surprising without context, and the result of a real trade-off.",
    "- For a small set of discrete answers, keep nextTurn.body.kind=\"question\" and include body.options with 2-5 options, each with a unique id and a short label. The user may still answer in free text — options are suggestions only.",
    "- For a batch turn, set nextTurn.body.kind=\"batch\" and include body.questions with 2-5 objects. Each object needs id and q, and may include options with Phalanx-style id/label/description/tag.",
    "- Only set readiness=ready when scope, boundaries, and key requirements are fully resolved.",
    "- Never set readiness=ready if there are unresolved blocker findings.",
    "- When readiness=ready: set coverage.alignmentPct=100, coverage.openBlockers=0, and mark every prior blocker finding as resolved=true.",
    "- When readiness=ready AND existingSystemContext.mode=update, you MUST include at least one targetSurfaces entry AND at least one of doNotChange, reuseRequirements, or compatibilityRequirements.",
    "- Preserve all stable IDs from currentPacket when provided: requirements, findings, groundedFacts, contextSources, and userDecisions. If a user answer resolves a finding, keep the same finding id and mark it resolved; do not drop it.",
    "",
    "Required JSON object contract:",
    `- contractVersion must equal ${CONTRACT_VERSION}.`,
    `- source must equal ${SOURCE_SEMANTIX}.`,
    "- Include these top-level keys: sessionId, iteration, readiness, readinessReason, blockingReasons, approvalRequired, originalUserRequest, alignedRequirement, requirements, flow, scope, assumptions, openQuestions, risks, userDecisions, acceptanceSummary, existingSystemContext, contextSources, groundedFacts, findings, coverage, nextTurn.",
    `- readiness values: ${READINESS_VALUES.join(", ")}.`,
    `- requirement.type values: ${REQUIREMENT_TYPE_VALUES.join(", ")}.`,
    `- requirement.priority values: ${REQUIREMENT_PRIORITY_VALUES.join(", ")}.`,
    `- requirement.status values: ${REQUIREMENT_STATUS_VALUES.join(", ")}.`,
    "- Every requirement must include sourceRef and acceptance.",
    `- finding.kind values: ${FINDING_KIND_VALUES.join(", ")}.`,
    `- finding.sev values: ${FINDING_SEVERITY_VALUES.join(", ")}.`,
    `- finding.raisedBy values: ${FINDING_RAISED_BY_VALUES.join(", ")}.`,
    `- section values: ${SECTION_ID_VALUES.join(", ")}.`,
    `- existingSystemContext.mode values: ${Object.values(EXISTING_SYSTEM_MODE).join(", ")}.`,
    `- contextSources[].kind values: ${CONTEXT_SOURCE_KIND_VALUES.join(", ")}; include contextSources[].evidenceRefs when evidence is available.`,
    "- groundedFacts[].confidence values: high, medium, low.",
    `- nextTurn.phase values: ${TURN_PHASE_VALUES.join(", ")}.`,
    "- nextTurn.body may be a question with q/options, or a batch with questions. It must never be a user choice body.",
    "- Use IDs that are stable and descriptive. Use the currentPacket IDs when updating existing items.",
    "- All user-visible text must be derived from the current request, currentPacket, user answers, and provided context.",
    "",
    "Set nextTurn to null when readiness=ready or readiness=blocked.",
  ].join("\n");
}

/**
 * Transform a SemantixEvaluateRequest into a user-turn prompt string for the LLM.
 *
 * @param {object} request - normalized SemantixEvaluateRequest
 * @returns {string}
 */
export function synthesizeEvaluatorInput(request) {
  const lines = [];
  lines.push(`trigger: ${request.trigger}`);
  lines.push(`sessionId: ${request.sessionId}`);

  if (typeof request.originalUserRequest === "string") {
    lines.push(`originalUserRequest: ${request.originalUserRequest}`);
  }

  if (request.userTurn) {
    lines.push(`userTurn: ${JSON.stringify(request.userTurn)}`);
  }

  if (request.currentPacket) {
    const p = request.currentPacket;
    lines.push(`currentPacket.iteration: ${p.iteration}`);
    lines.push(`currentPacket.readiness: ${p.readiness}`);
    lines.push(`currentPacket.originalUserRequest: ${p.originalUserRequest}`);
    lines.push(`currentPacket.alignedRequirement: ${p.alignedRequirement}`);
    if (Array.isArray(p.requirements) && p.requirements.length > 0) {
      lines.push(`currentPacket.requirements: ${JSON.stringify(p.requirements)}`);
    }
    if (Array.isArray(p.findings) && p.findings.length > 0) {
      lines.push(`currentPacket.findings: ${JSON.stringify(p.findings)}`);
    }
    if (Array.isArray(p.groundedFacts) && p.groundedFacts.length > 0) {
      lines.push(`currentPacket.groundedFacts: ${JSON.stringify(p.groundedFacts)}`);
    }
    if (Array.isArray(p.contextSources) && p.contextSources.length > 0) {
      lines.push(`currentPacket.contextSources: ${JSON.stringify(p.contextSources)}`);
    }
    if (Array.isArray(p.userDecisions) && p.userDecisions.length > 0) {
      lines.push(`currentPacket.userDecisions: ${JSON.stringify(p.userDecisions)}`);
    }
    if (p.nextTurn) {
      lines.push(`currentPacket.nextTurn: ${JSON.stringify(p.nextTurn)}`);
    }
  }

  if (Array.isArray(request.decisions) && request.decisions.length > 0) {
    lines.push(`decisions: ${JSON.stringify(request.decisions)}`);
  }

  if (Array.isArray(request.findings) && request.findings.length > 0) {
    lines.push(`findings: ${JSON.stringify(request.findings)}`);
  }

  if (Array.isArray(request.contextResponses) && request.contextResponses.length > 0) {
    lines.push(`contextResponses: ${JSON.stringify(request.contextResponses)}`);
  }

  lines.push("");
  lines.push("Respond with the next SemantixAlignmentPacket JSON only.");
  return lines.join("\n");
}

// ---- ss-llm-004: output repair and degraded handling -----------------------

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function looksLikeAlignmentPacket(value) {
  if (!isPlainObject(value)) return false;
  const semanticSignals = [
    value.readiness != null,
    value.alignedRequirement != null,
    value.originalUserRequest != null,
    value.nextTurn !== undefined,
    Array.isArray(value.requirements),
    Array.isArray(value.findings),
    Array.isArray(value.openQuestions),
    Array.isArray(value.contextSources),
    isPlainObject(value.flow),
    isPlainObject(value.scope),
    isPlainObject(value.coverage),
  ];
  const signalCount = semanticSignals.filter(Boolean).length;
  if (signalCount >= 2) return true;
  if (value.readiness != null && (value.contractVersion === CONTRACT_VERSION || value.sessionId != null)) {
    return true;
  }
  return value.contractVersion === CONTRACT_VERSION && signalCount >= 1;
}

function findJsonObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) return index;
      if (depth < 0) return -1;
    }
  }

  return -1;
}

function parseJsonObjectCandidates(text) {
  const candidates = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== "{") continue;
    const end = findJsonObjectEnd(text, index);
    if (end <= index) continue;
    const parsed = tryParseJson(text.slice(index, end + 1));
    if (parsed && typeof parsed === "object") {
      candidates.push(parsed);
    }
    index = end;
  }
  return candidates;
}

function stringifyLlmOutputCandidate(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? "");
  }
}

function stripLeadingJsonFence(text) {
  return text.replace(/^```(?:json)?\s*/i, "").trimStart();
}

function stripSurroundingJsonFence(text) {
  return stripLeadingJsonFence(text).replace(/\s*```\s*$/i, "").trim();
}

function looksLikeJsonOutput(rawText) {
  const text = stripLeadingJsonFence(String(rawText ?? "").trim());
  return /^[{\[]/.test(text) || /"contractVersion"\s*:/.test(text);
}

function parsesAsCompleteJsonDocument(rawText) {
  const text = String(rawText ?? "").trim();
  if (!text) return false;
  return tryParseJson(text) !== null || tryParseJson(stripSurroundingJsonFence(text)) !== null;
}

function buildExtractionFailureMessage(rawText) {
  const text = String(rawText ?? "");
  const reason = text.trim().length === 0
    ? "LLM evaluator returned empty output"
    : looksLikeJsonOutput(text)
      ? "LLM evaluator returned malformed JSON output"
      : "LLM evaluator returned non-JSON output";
  return `${reason} (${text.slice(0, 120)}…).`;
}

function shouldTreatAsMalformedJsonOutput(rawText, parsed) {
  return (
    looksLikeJsonOutput(rawText) &&
    !parsesAsCompleteJsonDocument(rawText) &&
    !looksLikeAlignmentPacket(parsed)
  );
}

function normalizeLlmConnectorResult(result) {
  if (typeof result === "string") {
    return { exitCode: 0, stdout: result, stderr: "" };
  }

  if (!isPlainObject(result)) {
    return { exitCode: 0, stdout: String(result ?? ""), stderr: "" };
  }

  const looksLikeExecutionResult =
    Object.prototype.hasOwnProperty.call(result, "exitCode") ||
    Object.prototype.hasOwnProperty.call(result, "stdout") ||
    Object.prototype.hasOwnProperty.call(result, "stderr") ||
    Object.prototype.hasOwnProperty.call(result, "finalJsonObject");

  if (!looksLikeExecutionResult) {
    return { exitCode: 0, stdout: "", stderr: "", finalJsonObject: result };
  }

  return {
    ...result,
    exitCode: result.exitCode ?? 0,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : String(result.stderr ?? ""),
  };
}

function collectLlmOutputCandidates(result) {
  const candidates = [];
  const append = (value) => {
    if (value === undefined || value === null) return;
    const text = stringifyLlmOutputCandidate(value);
    if (text.trim().length > 0) {
      candidates.push(text);
    }
  };

  append(result.finalJsonObject);
  append(result.finalJson);
  append(result.outputJson);
  append(result.outputText);
  append(result.output_text);
  append(result.output);
  append(result.packet);
  append(result.data);
  append(result.payload);
  append(result.response);
  append(result.responseText);
  append(result.response_text);
  append(result.message);
  append(result.content);
  append(result.text);
  append(result.result);
  append(result.value);

  if (Array.isArray(result.jsonMessages)) {
    for (const message of result.jsonMessages.slice().reverse()) {
      append(message);
    }
  }

  append(result.stdout);
  append(result.stderr);

  return candidates;
}

function isEmptyLlmOutputError(error) {
  return /LLM evaluator returned empty output/i.test(error?.message ?? "");
}

function bytesOf(value) {
  return Buffer.byteLength(String(value ?? ""), "utf8");
}

function describeEmptyConnectorResult(result, { model } = {}) {
  const details = [
    `model=${model ?? "codex-default"}`,
    `exitCode=${result?.exitCode ?? "unknown"}`,
    `stdoutBytes=${bytesOf(result?.stdout)}`,
    `stderrBytes=${bytesOf(result?.stderr)}`,
    `jsonMessages=${Array.isArray(result?.jsonMessages) ? result.jsonMessages.length : 0}`,
  ];
  if (typeof result?.command === "string" && result.command.length > 0) {
    details.push(`command=${result.command}`);
  }
  return `LLM evaluator returned empty output (${details.join(", ")}).`;
}

function collectClarificationQuestionTexts(packet) {
  const body = packet?.nextTurn?.body;
  if (!isPlainObject(body)) return [];
  if (body.kind === "question") return [body.q].map(textOf).filter(Boolean);
  if (body.kind === "batch") {
    return asArray(body.questions)
      .map((question) => textOf(question?.q ?? question?.question ?? question))
      .filter(Boolean);
  }
  return [];
}

function isLowQualityClarificationQuestion(text) {
  const normalized = String(text ?? "").trim().toLowerCase();
  if (!normalized) return true;
  return [
    /^what\s+(scope|behavior|behaviour|constraints?)\b/,
    /clarified\s+before\s+locking/,
    /^what\s+feature,\s*change,\s*or\s*outcome\s+should\s+semantix\s+align/,
    /^what\s+additional\s+information\s+is\s+needed/,
    /^what\s+should\s+be\s+clarified/,
    /^please\s+clarify\b/,
    /^can\s+you\s+provide\s+more\s+details/,
    /^could\s+you\s+provide\s+more\s+details/,
  ].some((pattern) => pattern.test(normalized));
}

function validateClarificationQuality(packet, request) {
  if (packet?.readiness !== READINESS.NEEDS_USER) {
    return { ok: true };
  }
  const questions = collectClarificationQuestionTexts(packet);
  if (questions.length === 0) {
    return {
      ok: false,
      reason: "needs_user packet did not include a visible clarifying question",
    };
  }
  const genericQuestion = questions.find(isLowQualityClarificationQuestion);
  if (genericQuestion) {
    return {
      ok: false,
      reason: `needs_user packet used a generic clarification question: ${genericQuestion}`,
    };
  }
  const requestText = initialUserText(request, packet);
  if (isGenericWebsiteCreationRequest(requestText) && packetReducedToModeOnlyQuestion(packet)) {
    return {
      ok: false,
      reason: "needs_user packet only asked whether an underspecified website request is new or existing",
    };
  }
  return { ok: true };
}

function isNeedsUserQuestionRetryReason(reason) {
  return /visible clarifying question|next_turn_question_missing_text|next_turn_batch_missing_questions|missing_next_turn|next_turn_missing_body/i.test(
    reason ?? "",
  );
}

function summarizeRejectedPacketGaps(rawText) {
  const packet = extractJsonFromLlmOutput(rawText);
  if (!isPlainObject(packet)) return [];
  return [
    ...asArray(packet.blockingReasons).map((reason) => `Blocking reason: ${textOf(reason)}`),
    ...asArray(packet.findings)
      .filter((finding) => isPlainObject(finding) && finding.resolved !== true)
      .map((finding) => `Finding (${finding.sev ?? "unknown"}): ${textOf(finding)}`),
  ].filter((line) => line.trim().length > 0).slice(0, 8);
}

function correctiveRetryGuidance({ reason, rawText }) {
  if (!isNeedsUserQuestionRetryReason(reason)) return [];
  const gaps = summarizeRejectedPacketGaps(rawText);
  return [
    "Discrepancy detected: the packet still needs user input, but it did not provide an answerable next question.",
    "If blockers or unresolved findings remain, readiness must stay needs_user and nextTurn must contain a concrete question or batch.",
    "If no user input is needed, readiness must be ready, nextTurn must be null, blocker findings must be resolved, and coverage.alignmentPct must be 100.",
    "Ask questions that directly resolve the remaining blockers or findings; do not repeat a stale question that was just answered.",
    gaps.length ? "Remaining unresolved items to convert into next questions:" : "",
    ...gaps.map((gap) => `- ${gap}`),
  ].filter(Boolean);
}

function buildCorrectiveRetryPrompt({ systemPrompt, userMessage, reason, rawText }) {
  const guidance = correctiveRetryGuidance({ reason, rawText });
  return [
    systemPrompt,
    "",
    "---",
    "",
    userMessage,
    "",
    "Your previous output was rejected.",
    `Rejection reason: ${reason}`,
    "",
    "Return a corrected SemantixAlignmentPacket JSON object now.",
    "The corrected packet must include concrete, user-facing clarifying questions specific to the original request.",
    "Do not use generic meta-questions, schema placeholders, angle-bracket placeholders, or TBD text.",
    "If readiness is needs_user, nextTurn.body must be kind=\"question\" or kind=\"batch\" with concrete q text and useful option labels.",
    ...guidance,
    "",
    "Respond with corrected JSON only.",
  ].join("\n");
}

function shouldRetryEvaluatorError(error) {
  return /invalid packet|malformed JSON|non-JSON|next_turn|missing_|placeholder|empty output/i.test(
    error?.message ?? "",
  );
}

function correctiveRetryEvent(request, attempt, reason) {
  return {
    id: `evt_llm_corrective_retry_${request?.sessionId ?? "unknown"}_${attempt}_${Date.now()}`,
    kind: "llm.evaluator.corrective_retry",
    sessionId: request?.sessionId,
    payload: { attempt, reason },
  };
}

function cloneJsonSafe(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function buildLlmResponseTrace({
  attempt,
  model,
  result,
  rawOutputs,
  rawText,
  retryReason,
}) {
  return {
    attempt,
    model: model ?? null,
    exitCode: result?.exitCode ?? null,
    stdout: typeof result?.stdout === "string" ? result.stdout : "",
    stderr: typeof result?.stderr === "string" ? result.stderr : "",
    jsonMessages: Array.isArray(result?.jsonMessages) ? cloneJsonSafe(result.jsonMessages) : [],
    finalJsonObject: cloneJsonSafe(result?.finalJsonObject ?? null),
    rawOutputs: asArray(rawOutputs).map((output) => String(output ?? "")),
    rawText: String(rawText ?? ""),
    ...(retryReason ? { retryReason } : {}),
  };
}

function attachLlmResponsesToError(error, llmResponses) {
  if (Array.isArray(llmResponses)) {
    error.llmResponses = llmResponses;
  }
  return error;
}

function extractPacketFromParsedValue(value, depth = 0) {
  if (depth > 8) return null;

  if (typeof value === "string") {
    return extractJsonFromText(value, depth + 1);
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractPacketFromParsedValue(item, depth + 1);
      if (extracted) return extracted;
    }
    return null;
  }

  if (!isPlainObject(value)) return null;
  if (looksLikeAlignmentPacket(value)) return value;

  const preferredKeys = [
    "packet",
    "finalJsonObject",
    "result",
    "message",
    "content",
    "text",
    "output_text",
    "stdout",
  ];
  for (const key of preferredKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const extracted = extractPacketFromParsedValue(value[key], depth + 1);
    if (extracted) return extracted;
  }

  for (const candidate of Object.values(value)) {
    const extracted = extractPacketFromParsedValue(candidate, depth + 1);
    if (extracted) return extracted;
  }

  return null;
}

function extractJsonFromText(rawText, depth = 0) {
  if (depth > 8 || typeof rawText !== "string") return null;
  const text = rawText.trim();
  if (!text) return null;

  const direct = tryParseJson(text);
  if (direct && typeof direct === "object") {
    const extracted = extractPacketFromParsedValue(direct, depth + 1);
    if (extracted) return extracted;
    if (!Array.isArray(direct)) return direct;
  } else if (typeof direct === "string") {
    const extracted = extractJsonFromText(direct, depth + 1);
    if (extracted) return extracted;
  }

  for (const fenceMatch of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)) {
    const extracted = extractJsonFromText(fenceMatch[1], depth + 1);
    if (extracted) return extracted;
  }

  const candidates = parseJsonObjectCandidates(text);
  for (const candidate of candidates) {
    const extracted = extractPacketFromParsedValue(candidate, depth + 1);
    if (extracted) return extracted;
  }

  return candidates.find(isPlainObject) ?? null;
}

/**
 * Extract a JSON object from raw LLM text output, handling markdown code
 * blocks, Codex JSONL wrappers, and surrounding prose.
 *
 * @param {string} rawText
 * @returns {object | null}
 */
export function extractJsonFromLlmOutput(rawText) {
  return extractJsonFromText(rawText);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0 && !isPlaceholderLiteral(value);
}

function isPlaceholderLiteral(value) {
  return typeof value === "string" && /^<[^>\n]{1,80}>$/.test(value.trim());
}

function initialRequestText(request) {
  if (request?.trigger !== "initial") return "";
  const body = request?.userTurn?.body;
  if ((body?.kind === "text" || body?.kind === "free") && typeof body.text === "string") {
    return body.text.trim();
  }
  return typeof request?.originalUserRequest === "string"
    ? request.originalUserRequest.trim()
    : "";
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function textOf(value) {
  if (typeof value === "string") return isPlaceholderLiteral(value) ? "" : value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isPlainObject(value)) {
    for (const key of ["text", "question", "q", "label", "summary", "name", "description", "reason"]) {
      if (isNonEmptyString(value[key])) return value[key].trim();
    }
  }
  return "";
}

function stripPlaceholderLiterals(value) {
  if (isPlaceholderLiteral(value)) return undefined;
  if (Array.isArray(value)) {
    return value
      .map(stripPlaceholderLiterals)
      .filter((item) => item !== undefined);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, stripPlaceholderLiterals(item)])
        .filter(([, item]) => item !== undefined),
    );
  }
  return value;
}

function slug(value) {
  const text = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return text || "item";
}

function numberedId(prefix, index) {
  return `${prefix}-${String(index + 1).padStart(3, "0")}`;
}

function normalizeEnumValue(value, allowed, fallback, aliases = {}) {
  if (typeof value === "string" && allowed.includes(value)) return value;
  const normalized = slug(value);
  if (allowed.includes(normalized)) return normalized;
  return aliases[normalized] ?? fallback;
}

function normalizeReadiness(value) {
  return normalizeEnumValue(value, READINESS_VALUES, READINESS.NEEDS_USER, {
    needsuser: READINESS.NEEDS_USER,
    needs_user_input: READINESS.NEEDS_USER,
    needs_clarification: READINESS.NEEDS_USER,
    clarification_needed: READINESS.NEEDS_USER,
    waiting_for_user: READINESS.NEEDS_USER,
    locked: READINESS.READY,
    complete: READINESS.READY,
    done: READINESS.READY,
    fail: READINESS.BLOCKED,
    failed: READINESS.BLOCKED,
  });
}

function normalizeRequirementType(value) {
  return normalizeEnumValue(value, REQUIREMENT_TYPE_VALUES, "functional", {
    feature: "functional",
    behavior: "functional",
    user_story: "functional",
    ui: "functional",
    ux: "functional",
    performance: "nonfunctional",
    security: "nonfunctional",
    accessibility: "nonfunctional",
    quality: "nonfunctional",
    boundary: "constraint",
    dependency: "constraint",
    limitation: "constraint",
    validation: "acceptance",
    success: "acceptance",
    criterion: "acceptance",
    criteria: "acceptance",
    prohibition: "negative",
    out_of_scope: "negative",
  });
}

function normalizeRequirementPriority(value) {
  return normalizeEnumValue(value, REQUIREMENT_PRIORITY_VALUES, "must", {
    required: "must",
    critical: "must",
    high: "must",
    p0: "must",
    p1: "must",
    medium: "should",
    recommended: "should",
    normal: "should",
    p2: "should",
    low: "could",
    optional: "could",
    nice_to_have: "could",
    p3: "could",
  });
}

function normalizeRequirementStatus(value, readiness) {
  return normalizeEnumValue(
    value,
    REQUIREMENT_STATUS_VALUES,
    readiness === READINESS.READY ? "confirmed" : "proposed",
    {
      open: "proposed",
      draft: "proposed",
      new: "proposed",
      pending: "proposed",
      unresolved: "proposed",
      accepted: "confirmed",
      approved: "confirmed",
      locked: "confirmed",
      done: "confirmed",
      resolved: "confirmed",
      conflict: "contested",
      disputed: "contested",
      rejected: "contested",
      replaced: "superseded",
    },
  );
}

function fallbackRequirementAcceptance(text, readiness) {
  if (readiness === READINESS.READY) {
    return `Verified acceptance for this requirement: ${text}`;
  }
  return `Acceptance remains pending until this proposed requirement is confirmed: ${text}`;
}

function normalizeRequirements(value, request, readiness) {
  return asArray(value)
    .map((item, index) => {
      const sourceRef = fallbackEvidenceRef(request);
      if (isPlainObject(item)) {
        const text = textOf(item);
        if (!text) return null;
        return {
          ...item,
          id: isNonEmptyString(item.id) ? item.id : numberedId("REQ-LLM", index),
          type: normalizeRequirementType(item.type ?? item.kind ?? item.category),
          text,
          priority: normalizeRequirementPriority(item.priority ?? item.importance),
          sourceRef: isNonEmptyString(item.sourceRef) ? item.sourceRef : sourceRef,
          acceptance: isNonEmptyString(item.acceptance)
            ? item.acceptance
            : isNonEmptyString(item.acceptanceCriteria)
              ? item.acceptanceCriteria
              : fallbackRequirementAcceptance(text, readiness),
          status: normalizeRequirementStatus(item.status, readiness),
        };
      }
      const text = textOf(item);
      if (!text) return null;
      return {
        id: numberedId("REQ-LLM", index),
        type: "functional",
        text,
        priority: "must",
        sourceRef,
        acceptance: fallbackRequirementAcceptance(text, readiness),
        status: readiness === READINESS.READY ? "confirmed" : "proposed",
      };
    })
    .filter(Boolean);
}

function normalizeFindingKind(value) {
  return normalizeEnumValue(value, FINDING_KIND_VALUES, "gap", {
    issue: "gap",
    missing: "gap",
    question: "gap",
    ambiguity: "gap",
    ambiguous: "gap",
    conflict: "contradiction",
    concern: "risk",
    warning: "risk",
    uncertainty: "assumption",
  });
}

function normalizeFindingSeverity(value) {
  return normalizeEnumValue(value, FINDING_SEVERITY_VALUES, "concern", {
    critical: "blocker",
    high: "blocker",
    error: "blocker",
    blocking: "blocker",
    medium: "concern",
    warning: "concern",
    warn: "concern",
    low: "fyi",
    info: "fyi",
    informational: "fyi",
  });
}

function normalizeFindingRaisedBy(value) {
  return normalizeEnumValue(value, FINDING_RAISED_BY_VALUES, "semantix");
}

function normalizeResolved(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = slug(value);
    if (["true", "yes", "resolved", "closed", "done"].includes(normalized)) return true;
    if (["false", "no", "open", "unresolved", "pending"].includes(normalized)) return false;
  }
  return false;
}

function normalizeFindings(value) {
  return asArray(value)
    .map((item, index) => {
      if (isPlainObject(item)) {
        const text = textOf(item);
        if (!text) return null;
        const {
          severity: _severity,
          level: _level,
          type: _type,
          target: _target,
          area: _area,
          sourceRef: _sourceRef,
          ...finding
        } = item;
        return {
          ...finding,
          id: isNonEmptyString(item.id) ? item.id : numberedId("F-LLM", index),
          kind: normalizeFindingKind(item.kind ?? item.type),
          sev: normalizeFindingSeverity(item.sev ?? item.severity ?? item.level),
          section: normalizeSectionId(item.section ?? item.target ?? item.area, "intent"),
          ref: isNonEmptyString(item.ref) ? item.ref : isNonEmptyString(item.sourceRef) ? item.sourceRef : "llm",
          text,
          resolved: normalizeResolved(item.resolved),
          raisedBy: normalizeFindingRaisedBy(item.raisedBy),
        };
      }
      const text = textOf(item);
      if (!text) return null;
      return {
        id: numberedId("F-LLM", index),
        kind: "gap",
        sev: "concern",
        section: "intent",
        ref: "llm",
        text,
        resolved: false,
        raisedBy: "semantix",
      };
    })
    .filter(Boolean);
}

function normalizeSectionId(value, fallback = "intent") {
  if (typeof value !== "string") return fallback;
  const normalized = slug(value);
  return SECTION_ID_VALUES.includes(normalized) ? normalized : fallback;
}

function normalizeTextRecord(value, index, prefix, textKey = "text", extra = {}) {
  if (isPlainObject(value)) {
    const text = textOf(value);
    if (!text) return null;
    return {
      ...value,
      id: isNonEmptyString(value.id) ? value.id : numberedId(prefix, index),
      [textKey]: text,
      ...extra,
    };
  }
  const text = textOf(value);
  if (!text) return null;
  return {
    id: numberedId(prefix, index),
    [textKey]: text,
    ...extra,
  };
}

function normalizeStringOptions(options) {
  return asArray(options)
    .map((option) => textOf(option))
    .filter(Boolean);
}

function normalizeTurnOption(option, index) {
  const label = textOf(option);
  if (!label) return null;
  if (isPlainObject(option)) {
    const {
      text: _text,
      question: _question,
      q: _q,
      name: _name,
      reason: _reason,
      ...cleanOption
    } = stripPlaceholderLiterals(option);
    return {
      ...cleanOption,
      id: isNonEmptyString(option.id) ? option.id : numberedId("OPT", index),
      label,
      ...(isNonEmptyString(option.description) ? { description: option.description.trim() } : {}),
    };
  }
  return {
    id: numberedId("OPT", index),
    label,
  };
}

function normalizeTurnOptions(options) {
  return asArray(options).map(normalizeTurnOption).filter(Boolean);
}

function normalizeBlockingReasons(value) {
  return asArray(value)
    .map((item, index) => normalizeTextRecord(item, index, "BR-LLM"))
    .filter((item) => item && isNonEmptyString(item.text));
}

function normalizeOpenQuestions(value) {
  return asArray(value)
    .map((item, index) => {
      const question = normalizeTextRecord(item, index, "Q-LLM", "question", {
        section: normalizeSectionId(item?.section ?? item?.target ?? item?.ref, "scope"),
      });
      if (!question) return null;
      if (Array.isArray(item?.options)) question.options = item.options;
      question.options = normalizeStringOptions(question.options);
      return question;
    })
    .filter((item) => item && isNonEmptyString(item.question));
}

function normalizeInterpretations(value, prefix, defaultSection) {
  return asArray(value)
    .map((item, index) => normalizeTextRecord(item, index, prefix, "text", {
      section: normalizeSectionId(item?.section, defaultSection),
      sourceRef: isNonEmptyString(item?.sourceRef) ? item.sourceRef : "llm",
    }))
    .filter((item) => item && isNonEmptyString(item.text));
}

function normalizeFlowItems(value, prefix, buildFromText, fillObject) {
  return asArray(value)
    .map((item, index) => {
      if (isPlainObject(item)) return fillObject(item, index);
      return buildFromText(textOf(item), index);
    })
    .filter(Boolean);
}

function normalizeFlow(flow) {
  const input = isPlainObject(flow) ? flow : {};
  return {
    ...input,
    pages: normalizeFlowItems(
      input.pages,
      "PAGE-LLM",
      (text, index) => text ? {
        id: numberedId("PAGE-LLM", index),
        name: text,
        purpose: text,
        sourceRef: "llm",
      } : null,
      (item, index) => ({
        ...item,
        id: isNonEmptyString(item.id) ? item.id : numberedId("PAGE-LLM", index),
        name: textOf(item.name ?? item) || `Page ${index + 1}`,
        purpose: isNonEmptyString(item.purpose) ? item.purpose : textOf(item) || `Page ${index + 1}`,
        sourceRef: isNonEmptyString(item.sourceRef) ? item.sourceRef : "llm",
      }),
    ),
    states: normalizeFlowItems(
      input.states,
      "STATE-LLM",
      (text, index) => text ? {
        id: numberedId("STATE-LLM", index),
        name: text,
        description: text,
        sourceRef: "llm",
      } : null,
      (item, index) => ({
        ...item,
        id: isNonEmptyString(item.id) ? item.id : numberedId("STATE-LLM", index),
        name: textOf(item.name ?? item) || `State ${index + 1}`,
        description: isNonEmptyString(item.description) ? item.description : textOf(item) || `State ${index + 1}`,
        sourceRef: isNonEmptyString(item.sourceRef) ? item.sourceRef : "llm",
      }),
    ),
    transitions: normalizeFlowItems(
      input.transitions,
      "TRANS-LLM",
      (text, index) => text ? {
        id: numberedId("TRANS-LLM", index),
        from: "unknown",
        to: "unknown",
        trigger: text,
        result: text,
        sourceRef: "llm",
      } : null,
      (item, index) => ({
        ...item,
        id: isNonEmptyString(item.id) ? item.id : numberedId("TRANS-LLM", index),
        from: isNonEmptyString(item.from) ? item.from : "unknown",
        to: isNonEmptyString(item.to) ? item.to : "unknown",
        trigger: isNonEmptyString(item.trigger) ? item.trigger : textOf(item) || `Transition ${index + 1}`,
        result: isNonEmptyString(item.result) ? item.result : textOf(item) || `Transition ${index + 1}`,
        sourceRef: isNonEmptyString(item.sourceRef) ? item.sourceRef : "llm",
      }),
    ),
    dataNeeded: normalizeFlowItems(
      input.dataNeeded,
      "DATA-LLM",
      (text, index) => text ? {
        id: numberedId("DATA-LLM", index),
        name: text,
        consumerRef: "unknown",
        requiredFor: text,
        unresolved: true,
      } : null,
      (item, index) => ({
        ...item,
        id: isNonEmptyString(item.id) ? item.id : numberedId("DATA-LLM", index),
        name: textOf(item.name ?? item) || `Data ${index + 1}`,
        consumerRef: isNonEmptyString(item.consumerRef) ? item.consumerRef : "unknown",
        requiredFor: isNonEmptyString(item.requiredFor) ? item.requiredFor : textOf(item) || `Data ${index + 1}`,
        unresolved: typeof item.unresolved === "boolean" ? item.unresolved : true,
      }),
    ),
  };
}

function normalizeTargetSurfaces(value) {
  return asArray(value)
    .map((item, index) => {
      if (isPlainObject(item)) {
        const name = textOf(item.name ?? item);
        return {
          ...item,
          id: isNonEmptyString(item.id) ? item.id : `surf_${slug(name || index + 1)}`,
          kind: isNonEmptyString(item.kind) ? item.kind : "unknown",
          name: name || `Target surface ${index + 1}`,
        };
      }
      const name = textOf(item);
      if (!name) return null;
      return {
        id: `surf_${slug(name)}`,
        kind: "unknown",
        name,
      };
    })
    .filter(Boolean);
}

function normalizeExistingSystemContext(value) {
  const context = isPlainObject(value) ? { ...value } : { mode: "unknown" };
  if (!["new", "update", "unknown"].includes(context.mode)) context.mode = "unknown";
  context.targetSurfaces = normalizeTargetSurfaces(context.targetSurfaces);
  for (const key of [
    "knownFiles",
    "existingFlows",
    "existingConstraints",
    "doNotChange",
    "reuseRequirements",
    "compatibilityRequirements",
    "migrationConcerns",
    "observedProblems",
    "referenceArtifacts",
  ]) {
    if (context[key] !== undefined && !Array.isArray(context[key])) {
      context[key] = asArray(context[key]).filter((item) => item !== undefined && item !== null);
    }
  }
  return context;
}

function fallbackEvidenceRef(request) {
  return request?.userTurn?.id ?? request?.currentPacket?.nextTurn?.id ?? "llm-output";
}

function normalizeContextSources(value, request) {
  return asArray(value)
    .filter(isPlainObject)
    .map((source, index) => {
      const id = isNonEmptyString(source.id) ? source.id : numberedId("CS-LLM", index);
      const status = ["used", "unavailable", "skipped"].includes(source.status) ? source.status : "used";
      const evidenceRefs = Array.isArray(source.evidenceRefs)
        ? source.evidenceRefs.filter(isNonEmptyString)
        : isNonEmptyString(source.evidenceRef)
          ? [source.evidenceRef]
          : isNonEmptyString(source.ref)
            ? [source.ref]
            : status === "used"
              ? [fallbackEvidenceRef(request)]
              : [];
      return {
        ...source,
        id,
        kind: CONTEXT_SOURCE_KIND_VALUES.includes(source.kind) ? source.kind : "user",
        status,
        summary: typeof source.summary === "string" ? source.summary : textOf(source),
        evidenceRefs,
      };
    });
}

function normalizeGroundedFacts(value, request) {
  return asArray(value)
    .filter(isPlainObject)
    .map((fact, index) => {
      const text = textOf(fact);
      if (!text) return null;
      const normalizedFact = {
        ...fact,
        id: isNonEmptyString(fact.id) ? fact.id : numberedId("GF-LLM", index),
        source: CONTEXT_SOURCE_KIND_VALUES.includes(fact.source) ? fact.source : "user",
        text,
        evidenceRef: isNonEmptyString(fact.evidenceRef)
          ? fact.evidenceRef
          : isNonEmptyString(fact.ref)
            ? fact.ref
            : fallbackEvidenceRef(request),
      };
      const confidence = normalizeGroundedFactConfidence(fact.confidence);
      if (!confidence) return null;
      normalizedFact.confidence = confidence;
      return normalizedFact;
    })
    .filter(Boolean);
}

function normalizeNextTurn(value) {
  if (!isPlainObject(value)) return value;
  const body = isPlainObject(value.body) ? { ...value.body } : value.body;
  if (isPlainObject(body)) {
    const rawKind = slug(body.kind);
    if (rawKind !== "choice") {
      body.kind = normalizeEnumValue(
        body.kind,
        ["question", "finding", "batch"],
        Array.isArray(body.questions) ? "batch" : body.q || body.question ? "question" : "question",
        {
          questions: "batch",
          questionnaire: "batch",
          multiple_questions: "batch",
          clarification: "question",
          ask: "question",
          issue: "finding",
        },
      );
    }
    if (body.kind === "question" && !isNonEmptyString(body.q) && isNonEmptyString(body.question)) {
      body.q = body.question;
    }
    if (body.kind === "question") {
      const options = normalizeTurnOptions(body.options);
      if (options.length > 0) {
        body.options = options;
      } else {
        delete body.options;
      }
    }
    if (body.kind === "batch") {
      body.questions = asArray(body.questions)
        .map((question, index) => {
          const q = textOf(question?.q ?? question?.question ?? question);
          if (!q) return null;
          const normalizedQuestion = {
            ...(isPlainObject(question) ? question : {}),
            id: isNonEmptyString(question?.id) ? question.id : numberedId("Q-LLM", index),
            q,
          };
          const options = normalizeTurnOptions(question?.options);
          if (options.length > 0) normalizedQuestion.options = options;
          return normalizedQuestion;
        })
        .filter(Boolean);
    }
  }
  return {
    ...value,
    phase: normalizeEnumValue(value.phase, TURN_PHASE_VALUES, "socratic", {
      question: "socratic",
      questioning: "socratic",
      clarification: "socratic",
      clarify: "socratic",
      review: "adversarial",
      challenge: "adversarial",
      challenged: "adversarial",
      done: "locked",
      ready: "locked",
      complete: "locked",
      concise: "crisp",
    }),
    target: normalizeSectionId(value.target, "intent"),
    body,
  };
}

const WEBSITE_CREATION_PATTERN = /\b(create|build|make|design|generate|scaffold)\b/i;
const WEBSITE_SURFACE_PATTERN = /\b(website|web\s*(site|page|app)|landing\s*page|homepage|site)\b/i;
const EXISTING_SURFACE_HINT_PATTERN =
  /\b(update|modify|change|fix|add\s+to|replace|existing|current|legacy|already|redesign|refactor)\b/i;
const SPECIFICITY_HINT_PATTERN =
  /\b(for|because|so\s+that|audience|users?|customers?|admins?|shop|store|restaurant|portfolio|pricing|contact|booking|reservation|signup|sign\s+up|login|checkout|dashboard|blog|gallery|about|services|donate|subscribe)\b/i;
const PRODUCT_GAP_PATTERN =
  /\b(purpose|audience|users?|buttons?|actions?|content|style|brand|pages?|sections?|success|layout|copy|workflow|acceptance)\b/i;

function initialUserText(request, packet) {
  const body = request?.userTurn?.body;
  if (
    request?.trigger === "initial" &&
    (body?.kind === "text" || body?.kind === "free") &&
    isNonEmptyString(body.text)
  ) {
    return body.text.trim();
  }
  if (isNonEmptyString(packet?.originalUserRequest)) return packet.originalUserRequest.trim();
  if (isNonEmptyString(request?.currentPacket?.originalUserRequest)) {
    return request.currentPacket.originalUserRequest.trim();
  }
  if (isNonEmptyString(request?.originalUserRequest)) return request.originalUserRequest.trim();
  return "";
}

function wordCount(text) {
  return (String(text).match(/[a-z0-9]+/gi) ?? []).length;
}

function isGenericWebsiteCreationRequest(text) {
  if (!isNonEmptyString(text)) return false;
  if (!WEBSITE_CREATION_PATTERN.test(text) || !WEBSITE_SURFACE_PATTERN.test(text)) return false;
  if (EXISTING_SURFACE_HINT_PATTERN.test(text)) return false;

  const words = wordCount(text);
  const specificityHints = text.match(SPECIFICITY_HINT_PATTERN) ?? [];
  const mentionsButtons = /\bbuttons?\b/i.test(text);
  return words <= 8 || (mentionsButtons && words <= 14 && specificityHints.length <= 1);
}

function questionText(value) {
  if (typeof value === "string") return value.trim();
  if (!isPlainObject(value)) return "";
  return textOf(value.q ?? value.question ?? value.text ?? value.summary ?? value.name ?? value.description);
}

function isModeOnlyNewUpdateQuestion(value) {
  const text = questionText(value).toLowerCase();
  if (!text) return false;
  const mentionsMode = /\b(new|existing|current|update|updating|create|creating)\b/.test(text);
  const comparesMode = /\b(or|versus|vs)\b/.test(text);
  return mentionsMode && comparesMode && !PRODUCT_GAP_PATTERN.test(text);
}

function packetReducedToModeOnlyQuestion(packet) {
  const body = packet?.nextTurn?.body;
  if (!isPlainObject(body) || body.kind !== "question") return false;
  if (!isModeOnlyNewUpdateQuestion(body)) return false;
  const questions = asArray(packet.openQuestions).filter((question) => questionText(question));
  return questions.length === 0 || questions.every(isModeOnlyNewUpdateQuestion);
}

function turnQuestionFromOpenQuestion(question, index) {
  const q = questionText(question);
  if (!q) return null;
  const turnQuestion = {
    ...(isPlainObject(question) ? question : {}),
    id: isNonEmptyString(question?.id) ? question.id : numberedId("Q-LLM", index),
    q,
  };
  delete turnQuestion.question;
  delete turnQuestion.text;
  const options = normalizeTurnOptions(question?.options);
  if (options.length > 0) {
    turnQuestion.options = options;
  } else {
    delete turnQuestion.options;
  }
  return turnQuestion;
}

function openQuestionsAsTurnQuestions(packet) {
  return asArray(packet.openQuestions)
    .map(turnQuestionFromOpenQuestion)
    .filter(Boolean);
}

function repairNeedsUserNextTurn(packet) {
  if (packet.readiness !== READINESS.NEEDS_USER) {
    packet.nextTurn = null;
    return;
  }

  const at = new Date().toISOString();
  const existingTurn = isPlainObject(packet.nextTurn) ? packet.nextTurn : {};
  const existingBody = isPlainObject(existingTurn.body) ? { ...existingTurn.body } : {};

  // Outgoing choice turns are a protocol violation. Leave them invalid so the
  // explicit guardrail test still catches that class of LLM mistake.
  if (slug(existingBody.kind) === "choice") {
    packet.nextTurn = existingTurn;
    return;
  }

  let body = existingBody;
  if (body.kind === "batch") {
    const questions = asArray(body.questions)
      .map((question, index) => {
        const q = questionText(question);
        if (!q) return null;
        const turnQuestion = {
          ...(isPlainObject(question) ? question : {}),
          id: isNonEmptyString(question?.id) ? question.id : numberedId("Q-LLM", index),
          q,
        };
        const options = normalizeTurnOptions(question?.options);
        if (options.length > 0) {
          turnQuestion.options = options;
        } else {
          delete turnQuestion.options;
        }
        return turnQuestion;
      })
      .filter(Boolean);
    body.questions = questions.length > 0 ? questions : openQuestionsAsTurnQuestions(packet);
  } else {
    body.kind = "question";
    if (!isNonEmptyString(body.q)) {
      const [fallbackQuestion] = openQuestionsAsTurnQuestions(packet);
      if (fallbackQuestion) {
        body.q = fallbackQuestion.q;
        body.options = fallbackQuestion.options;
      }
    }
    const options = normalizeTurnOptions(body.options);
    if (options.length > 0) {
      body.options = options;
    } else {
      delete body.options;
    }
  }

  packet.nextTurn = {
    ...existingTurn,
    id: isNonEmptyString(existingTurn.id) ? existingTurn.id : numberedId("T-LLM", packet.iteration ?? 0),
    side: "semantix",
    at: isNonEmptyString(existingTurn.at) ? existingTurn.at : at,
    phase: normalizeEnumValue(existingTurn.phase, TURN_PHASE_VALUES, "socratic", {
      question: "socratic",
      questioning: "socratic",
      clarification: "socratic",
      clarify: "socratic",
      review: "adversarial",
      challenge: "adversarial",
      done: "locked",
      ready: "locked",
      concise: "crisp",
    }),
    target: normalizeSectionId(existingTurn.target, "intent"),
    body,
  };
}

function repairRequiredPacketFields(packet, request) {
  const originalText = initialUserText(request, packet);
  if (typeof packet.originalUserRequest !== "string" || isPlaceholderLiteral(packet.originalUserRequest)) {
    if (originalText) {
      packet.originalUserRequest = originalText;
    } else {
      delete packet.originalUserRequest;
    }
  }
  if (typeof packet.alignedRequirement !== "string" || isPlaceholderLiteral(packet.alignedRequirement)) {
    const priorAlignedRequirement = request?.currentPacket?.alignedRequirement;
    if (isNonEmptyString(priorAlignedRequirement)) {
      packet.alignedRequirement = priorAlignedRequirement;
    } else {
      packet.alignedRequirement = "";
    }
  }
  if (typeof packet.approvalRequired !== "boolean") {
    packet.approvalRequired = packet.readiness !== READINESS.READY;
  }
  repairNeedsUserNextTurn(packet);
}

function normalizeCoverage(value, readiness) {
  const coverage = isPlainObject(value) ? { ...value } : {};
  const parsedPct =
    typeof coverage.alignmentPct === "number"
      ? coverage.alignmentPct
      : Number.parseFloat(String(coverage.alignmentPct ?? ""));
  coverage.alignmentPct = Number.isFinite(parsedPct)
    ? Math.max(0, Math.min(100, parsedPct))
    : readiness === "ready"
      ? 100
      : 0;
  coverage.sections = asArray(coverage.sections)
    .map((section, index) => {
      const rawId = isPlainObject(section) ? section.id : section;
      const id = normalizeSectionId(rawId, SECTION_ID_VALUES[index] ?? "intent");
      const sectionCoverage =
        isPlainObject(section) && typeof section.coverage === "number"
          ? Math.max(0, Math.min(100, section.coverage))
          : coverage.alignmentPct;
      return {
        ...(isPlainObject(section) ? section : {}),
        id,
        name: isNonEmptyString(section?.name) ? section.name : id,
        required: ["must", "should", "could"].includes(section?.required) ? section.required : "must",
        coverage: sectionCoverage,
        status:
          ["locked", "covered", "weak", "empty"].includes(section?.status)
            ? section.status
            : sectionCoverage >= 100
              ? "covered"
              : sectionCoverage > 0
                ? "weak"
                : "empty",
        annotations: Number.isFinite(section?.annotations) ? section.annotations : 0,
      };
    });
  coverage.openBlockers = Number.isFinite(Number(coverage.openBlockers)) ? Number(coverage.openBlockers) : 0;
  coverage.openConcerns = Number.isFinite(Number(coverage.openConcerns)) ? Number(coverage.openConcerns) : 0;
  coverage.openFYI = Number.isFinite(Number(coverage.openFYI)) ? Number(coverage.openFYI) : 0;
  return coverage;
}

function isCanonicalUserDecision(decision) {
  return (
    isPlainObject(decision) &&
    isNonEmptyString(decision.id) &&
    isNonEmptyString(decision.turnId) &&
    SECTION_ID_VALUES.includes(decision.section) &&
    isNonEmptyString(decision.questionRef) &&
    isNonEmptyString(decision.question) &&
    ["choice", "free", "decided-by-semantix", "dismiss"].includes(decision.kind) &&
    isPlainObject(decision.answer) &&
    isNonEmptyString(decision.at)
  );
}

function idOf(value) {
  return isPlainObject(value) && isNonEmptyString(value.id) ? value.id : null;
}

function mergeMissingStableItems(priorItems, nextItems, shouldCarry = () => true) {
  const prior = asArray(priorItems).filter((item) => idOf(item));
  const next = asArray(nextItems);
  const nextIds = new Set();
  for (const item of next) {
    const id = idOf(item);
    if (id) nextIds.add(id);
  }

  const missingPrior = prior
    .filter((priorItem) => !nextIds.has(idOf(priorItem)) && shouldCarry(priorItem))
    .map(deepClone);
  return [...missingPrior, ...next].filter(Boolean);
}

function isValidSupersession(requirement, nextIds) {
  return (
    requirement.status !== "superseded" ||
    (isNonEmptyString(requirement.supersededBy) &&
      requirement.supersededBy !== requirement.id &&
      nextIds.has(requirement.supersededBy))
  );
}

function fieldsChanged(a, b, fields) {
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  return fields.some((field) => a[field] !== b[field]);
}

function nextStableId(prefix, items) {
  const used = new Set(asArray(items).map(idOf).filter(Boolean));
  let max = 0;
  const pattern = new RegExp(`^${prefix}-(\\d+)$`);
  for (const id of used) {
    const match = pattern.exec(id);
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  for (let i = max + 1; i < max + 1000; i += 1) {
    const candidate = `${prefix}-${String(i).padStart(3, "0")}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${prefix}-${Date.now()}`;
}

function mergeRequirementsPreservingInvalidSupersession(priorItems, nextItems) {
  const identityFields = ["text", "type", "priority", "acceptance"];
  const priorById = new Map(
    asArray(priorItems)
      .filter((item) => idOf(item))
      .map((item) => [idOf(item), item]),
  );
  const next = asArray(nextItems);
  const nextIds = new Set(next.map(idOf).filter(Boolean));
  const replacedPriorIds = new Set();
  const repairBase = [...asArray(priorItems), ...next];
  const repairedNext = [];
  for (const requirement of next) {
    const id = idOf(requirement);
    const prior = id ? priorById.get(id) : null;
    if (prior && !isValidSupersession(requirement, nextIds)) {
      replacedPriorIds.add(id);
      repairedNext.push(deepClone(prior));
      continue;
    }
    if (
      prior &&
      prior.status !== "superseded" &&
      requirement.status !== "superseded" &&
      fieldsChanged(prior, requirement, identityFields)
    ) {
      const replacementId = nextStableId("REQ", [...repairBase, ...repairedNext]);
      const supersededPrior = {
        ...deepClone(prior),
        status: "superseded",
        supersededBy: replacementId,
      };
      const replacement = {
        ...requirement,
        id: replacementId,
        status: requirement.status === "superseded" ? "proposed" : requirement.status,
        supersededBy: undefined,
      };
      replacedPriorIds.add(id);
      repairedNext.push(supersededPrior, replacement);
      continue;
    }
    repairedNext.push(requirement);
  }
  const repairedIds = new Set(repairedNext.map(idOf).filter(Boolean));
  const missingPrior = asArray(priorItems)
    .filter((prior) => {
      const id = idOf(prior);
      return id && !repairedIds.has(id) && prior.status !== "superseded" && !replacedPriorIds.has(id);
    })
    .map(deepClone);
  return [...missingPrior, ...repairedNext].filter(Boolean);
}

function mergeFindingsPreservingMutations(priorItems, nextItems) {
  const identityFields = ["text", "kind", "sev", "section", "ref"];
  const priorById = new Map(
    asArray(priorItems)
      .filter((item) => idOf(item))
      .map((item) => [idOf(item), item]),
  );
  const next = asArray(nextItems);
  const carriedPriorIds = new Set();
  const repairedNext = [];
  for (const finding of next) {
    const id = idOf(finding);
    const prior = id ? priorById.get(id) : null;
    if (prior && fieldsChanged(prior, finding, identityFields)) {
      const replacementId = nextStableId("F", [...asArray(priorItems), ...next, ...repairedNext]);
      carriedPriorIds.add(id);
      repairedNext.push(deepClone(prior), { ...finding, id: replacementId });
      continue;
    }
    if (prior?.resolved === true && finding.resolved !== true) {
      repairedNext.push({
        ...finding,
        resolved: true,
        resolvedAt: prior.resolvedAt,
        resolutionDecisionId: prior.resolutionDecisionId,
      });
      continue;
    }
    repairedNext.push(finding);
  }
  const repairedIds = new Set(repairedNext.map(idOf).filter(Boolean));
  const missingPrior = asArray(priorItems)
    .filter((prior) => {
      const id = idOf(prior);
      return id && !repairedIds.has(id) && !carriedPriorIds.has(id);
    })
    .map(deepClone);
  return [...missingPrior, ...repairedNext].filter(Boolean);
}

function mergeGroundedFactsPreservingMutations(priorItems, nextItems) {
  const identityFields = ["text", "source", "evidenceRef", "confidence"];
  const priorById = new Map(
    asArray(priorItems)
      .filter((item) => idOf(item))
      .map((item) => [idOf(item), item]),
  );
  const next = asArray(nextItems);
  const carriedPriorIds = new Set();
  const repairedNext = [];
  for (const fact of next) {
    const id = idOf(fact);
    const prior = id ? priorById.get(id) : null;
    if (prior && fieldsChanged(prior, fact, identityFields)) {
      const changedFields = identityFields.filter((field) => prior[field] !== fact[field]);
      if (changedFields.length === 1 && changedFields[0] === "confidence" && fact.confidence === undefined) {
        repairedNext.push({ ...fact, confidence: prior.confidence });
        continue;
      }
      const replacementId = nextStableId("GF", [...asArray(priorItems), ...next, ...repairedNext]);
      carriedPriorIds.add(id);
      repairedNext.push(deepClone(prior), { ...fact, id: replacementId });
      continue;
    }
    repairedNext.push(fact);
  }
  const repairedIds = new Set(repairedNext.map(idOf).filter(Boolean));
  const missingPrior = asArray(priorItems)
    .filter((prior) => {
      const id = idOf(prior);
      return id && !repairedIds.has(id) && !carriedPriorIds.has(id);
    })
    .map(deepClone);
  return [...missingPrior, ...repairedNext].filter(Boolean);
}

function countResolvedFindings(priorPacket, nextPacket) {
  const nextById = new Map(asArray(nextPacket?.findings).map((finding) => [idOf(finding), finding]));
  return asArray(priorPacket?.findings).reduce((count, priorFinding) => {
    const id = idOf(priorFinding);
    if (!id || priorFinding.resolved) return count;
    const nextFinding = nextById.get(id);
    return nextFinding?.resolved ? count + 1 : count;
  }, 0);
}

function countConsumedQuestions(priorPacket, nextPacket) {
  const nextQuestionIds = new Set(asArray(nextPacket?.openQuestions).map(idOf).filter(Boolean));
  return asArray(priorPacket?.openQuestions).reduce((count, question) => {
    const id = idOf(question);
    if (!id) return count;
    return nextQuestionIds.has(id) ? count : count + 1;
  }, 0);
}

function uniqueNonEmpty(values) {
  return [...new Set(values.filter(isNonEmptyString))];
}

function findPhalanxDecisionId(request) {
  const userTurnId = request?.userTurn?.id;
  if (!isNonEmptyString(userTurnId)) return undefined;
  const decision = asArray(request?.decisions).find(
    (item) => isPlainObject(item) && item.turnId === userTurnId && isNonEmptyString(item.id),
  );
  return decision?.id;
}

function findPhalanxDecisionIdsByQuestionRef(request) {
  const userTurnId = request?.userTurn?.id;
  if (!isNonEmptyString(userTurnId)) return {};
  const byQuestionRef = {};
  for (const decision of asArray(request?.decisions)) {
    if (!isPlainObject(decision)) continue;
    if (decision.turnId !== userTurnId) continue;
    if (!isNonEmptyString(decision.id)) continue;
    const questionRef =
      decision.questionRef ??
      decision.questionId ??
      decision.answer?.questionRef ??
      decision.answer?.questionId;
    if (isNonEmptyString(questionRef) && !byQuestionRef[questionRef]) {
      byQuestionRef[questionRef] = decision.id;
    }
  }
  return byQuestionRef;
}

function buildStableBaseline(request) {
  const prior = request?.currentPacket;
  if (!isPlainObject(prior)) return null;
  const userTurn = request?.userTurn;
  const body = userTurn?.body;
  if (!isPlainObject(userTurn) || !isPlainObject(body)) {
    return prior;
  }

  if (body.kind === "batch") {
    try {
      return applyUserBatchTurn({
        packet: prior,
        userTurn,
        decisionIdsByQuestionRef: findPhalanxDecisionIdsByQuestionRef(request),
      }).packet;
    } catch {
      return prior;
    }
  }

  if (body.kind !== "choice" && body.kind !== "free" && body.kind !== "text") {
    return prior;
  }

  const singleOpenQuestion =
    asArray(prior.openQuestions).filter(isPlainObject).length === 1
      ? asArray(prior.openQuestions).find(isPlainObject)
      : null;
  const linkedQuestionRefs = new Set([
    ...asArray(prior.openQuestions).map(idOf).filter(Boolean),
    ...asArray(prior.findings)
      .filter((finding) => isPlainObject(finding) && finding.resolved !== true)
      .map((finding) => finding.ref)
      .filter(isNonEmptyString),
  ]);
  const explicitQuestionTurnId = body.questionTurnId;
  const candidateRefs = uniqueNonEmpty([
    body.questionTurnId,
    prior.nextTurn?.id,
    singleOpenQuestion?.id,
  ]).filter(
    (questionRef) =>
      questionRef === explicitQuestionTurnId || linkedQuestionRefs.has(questionRef),
  );
  if (candidateRefs.length === 0) return prior;

  if (body.kind === "free" || body.kind === "text") {
    if (!isNonEmptyString(body.text)) return prior;
    let best = null;
    let bestScore = 0;
    let firstApplied = null;

    for (const questionRef of candidateRefs) {
      try {
        const result = applyUserBatchTurn({
          packet: prior,
          userTurn,
          answers: [
            {
              questionRef,
              kind: "free",
              text: body.text,
            },
          ],
          decisionIdsByQuestionRef: findPhalanxDecisionIdsByQuestionRef(request),
        });
        const decision = asArray(result.packet.userDecisions).find(
          (item) => isPlainObject(item) && item.turnId === userTurn.id,
        );
        if (decision && !isNonEmptyString(decision.question) && isNonEmptyString(prior.nextTurn?.body?.q)) {
          decision.question = prior.nextTurn.body.q;
        }
        const score =
          countResolvedFindings(prior, result.packet) +
          countConsumedQuestions(prior, result.packet);
        if (!firstApplied) firstApplied = result.packet;
        if (score > bestScore) {
          best = result.packet;
          bestScore = score;
        }
      } catch {
        // If the free-text answer cannot be linked, fall back to raw prior state.
      }
    }
    return best ?? firstApplied ?? prior;
  }

  if (!isNonEmptyString(body.picked)) return prior;

  let best = null;
  let bestScore = 0;
  let firstApplied = null;
  for (const questionRef of candidateRefs) {
    try {
      const result = applyUserChoiceTurn({
        packet: prior,
        userTurn,
        questionRef,
        pickedOptionId: body.picked,
        pickedLabel: body.label,
        section: prior.nextTurn?.target,
        decisionId: findPhalanxDecisionId(request),
      });
      const decision = asArray(result.packet.userDecisions).find(
        (item) => isPlainObject(item) && item.turnId === userTurn.id,
      );
      if (decision && !isNonEmptyString(decision.question) && isNonEmptyString(prior.nextTurn?.body?.q)) {
        decision.question = prior.nextTurn.body.q;
      }
      const score =
        countResolvedFindings(prior, result.packet) +
        countConsumedQuestions(prior, result.packet);
      if (!firstApplied) firstApplied = result.packet;
      if (score > bestScore) {
        best = result.packet;
        bestScore = score;
      }
    } catch {
      // If the user-turn helper cannot link the choice, fall back to raw prior state.
    }
  }
  return best ?? firstApplied ?? prior;
}

function repairCoverageAfterStableMerge(packet) {
  if (!isPlainObject(packet.coverage)) return;
  const unresolved = asArray(packet.findings).filter(
    (finding) => isPlainObject(finding) && finding.resolved !== true,
  );
  const openBlockers = unresolved.filter((finding) => finding.sev === "blocker").length;
  const openConcerns = unresolved.filter((finding) => finding.sev === "concern").length;
  const openFYI = unresolved.filter((finding) => finding.sev === "fyi").length;
  packet.coverage.openBlockers = openBlockers;
  packet.coverage.openConcerns = openConcerns;
  packet.coverage.openFYI = openFYI;
  if (packet.readiness === "ready" && openBlockers > 0) {
    packet.readiness = "needs_user";
    packet.readinessReason =
      "Prior blocker findings remain unresolved after preserving stable IDs.";
    packet.coverage.alignmentPct = Math.min(packet.coverage.alignmentPct, 99);
  }
}

function pruneAnsweredOpenQuestions(packet) {
  const answeredDecisions = asArray(packet.userDecisions).filter(
    (decision) => isPlainObject(decision) && isNonEmptyString(decision.questionRef),
  );
  const answeredQuestionRefs = new Set(answeredDecisions.map((decision) => decision.questionRef));
  const answeredQuestionTexts = new Set(
    answeredDecisions
      .map((decision) => textOf(decision.question).toLowerCase())
      .filter(isNonEmptyString),
  );
  if (answeredQuestionRefs.size === 0) return;
  const unansweredQuestion = (question) => {
    const id = idOf(question);
    if (id && answeredQuestionRefs.has(id)) return false;
    const text = questionText(question).toLowerCase();
    return !text || !answeredQuestionTexts.has(text);
  };
  packet.openQuestions = asArray(packet.openQuestions).filter(
    (question) => unansweredQuestion(question),
  );

  const body = packet.nextTurn?.body;
  if (!isPlainObject(body)) return;
  if (body.kind === "batch") {
    const questions = asArray(body.questions).filter(unansweredQuestion);
    if (questions.length > 0) {
      packet.nextTurn.body = { ...body, questions };
    } else {
      packet.nextTurn = null;
    }
    return;
  }
  if (body.kind === "question") {
    const turnId = idOf(packet.nextTurn);
    const text = questionText(body).toLowerCase();
    if (
      (turnId && answeredQuestionRefs.has(turnId)) ||
      (text && answeredQuestionTexts.has(text))
    ) {
      packet.nextTurn = null;
    }
  }
}

function preserveStableIds(packet, request) {
  const baseline = buildStableBaseline(request);
  if (!isPlainObject(baseline)) return;
  packet.requirements = mergeRequirementsPreservingInvalidSupersession(
    baseline.requirements,
    packet.requirements,
  );
  packet.findings = mergeFindingsPreservingMutations(baseline.findings, packet.findings);
  packet.groundedFacts = mergeGroundedFactsPreservingMutations(
    baseline.groundedFacts,
    packet.groundedFacts,
  );
  packet.contextSources = mergeMissingStableItems(baseline.contextSources, packet.contextSources);
  packet.userDecisions = mergeMissingStableItems(baseline.userDecisions, packet.userDecisions);
  pruneAnsweredOpenQuestions(packet);
  repairCoverageAfterStableMerge(packet);
}

function canonicalizeLlmPacket(packet, request) {
  packet.readiness = normalizeReadiness(packet.readiness);
  packet.blockingReasons = normalizeBlockingReasons(packet.blockingReasons);
  packet.requirements = normalizeRequirements(packet.requirements, request, packet.readiness);
  packet.findings = normalizeFindings(packet.findings);
  packet.flow = normalizeFlow(packet.flow);
  packet.assumptions = normalizeInterpretations(packet.assumptions, "A-LLM", "assumptions");
  packet.openQuestions = normalizeOpenQuestions(packet.openQuestions);
  packet.risks = normalizeInterpretations(packet.risks, "RISK-LLM", "risks");
  packet.userDecisions = asArray(packet.userDecisions).filter(isCanonicalUserDecision);
  packet.nextTurn = normalizeNextTurn(packet.nextTurn);
  packet.existingSystemContext = normalizeExistingSystemContext(packet.existingSystemContext);
  packet.contextSources = normalizeContextSources(packet.contextSources, request);
  packet.groundedFacts = normalizeGroundedFacts(packet.groundedFacts, request);
  packet.coverage = normalizeCoverage(packet.coverage, packet.readiness);
  preserveStableIds(packet, request);
  packet.groundedFacts = normalizeGroundedFacts(packet.groundedFacts, request);
  repairRequiredPacketFields(packet, request);
  return packet;
}

/**
 * Parse LLM raw text output into a valid SemantixEvaluateResponse.
 * Throws with a descriptive message on malformed or invalid output so
 * withDegradationFallback can produce an honest degraded packet.
 *
 * @param {string} sessionId
 * @param {number} iteration
 * @param {string} rawText
 * @param {object} request - original SemantixEvaluateRequest (for fallbacks)
 * @returns {{ packet: object, events: object[], contextRequests: object[] }}
 */
export function parseEvaluatorOutput(sessionId, iteration, rawText, request) {
  const normalizedRequest = isPlainObject(request) && isPlainObject(request.currentPacket)
    ? {
        ...request,
        currentPacket: normalizeSemantixAlignmentPacketForContract(request.currentPacket),
      }
    : request;
  const parsed = extractJsonFromLlmOutput(rawText);
  if (!parsed) {
    throw new Error(buildExtractionFailureMessage(rawText));
  }
  if (shouldTreatAsMalformedJsonOutput(rawText, parsed)) {
    throw new Error(buildExtractionFailureMessage(rawText));
  }

  // Stamp stable fields the LLM might have left blank or wrong
  let packet = {
    ...stripPlaceholderLiterals(parsed),
    contractVersion: CONTRACT_VERSION,
    source: SOURCE_SEMANTIX,
    sessionId,
    iteration,
  };

  canonicalizeLlmPacket(packet, normalizedRequest);
  packet = stripPlaceholderLiterals(packet);
  repairRequiredPacketFields(packet, normalizedRequest);

  // Ensure required arrays exist
  if (!Array.isArray(packet.requirements)) packet.requirements = [];
  if (!Array.isArray(packet.findings)) packet.findings = [];
  if (!Array.isArray(packet.contextSources)) packet.contextSources = [];
  if (!Array.isArray(packet.groundedFacts)) packet.groundedFacts = [];

  // Strip groundedFacts with invalid source values so schema validation passes.
  // groundedFacts are supplemental; silently dropping malformed items is safer
  // than rejecting the whole packet.
  if (packet.groundedFacts.length > 0) {
    const validSources = new Set(["user", "html", "spec", "phalanx", "hoplon", "repo", "trace", "upload"]);
    packet.groundedFacts = packet.groundedFacts.filter(
      (f) =>
        f !== null &&
        typeof f === "object" &&
        typeof f.id === "string" && f.id.length > 0 &&
        validSources.has(f.source) &&
        typeof f.text === "string" && f.text.length > 0 &&
        typeof f.evidenceRef === "string" && f.evidenceRef.length > 0,
    );
  }

  // Validate the resulting packet
  const validation = validateSemantixAlignmentPacket(packet);
  if (!validation.ok) {
    const codes = validation.errors.map((e) => e.code).join(", ");
    throw new Error(`LLM evaluator returned an invalid packet: ${codes}`);
  }

  if (normalizedRequest.currentPacket) {
    const continuity = checkIdContinuity({
      priorPacket: normalizedRequest.currentPacket,
      nextPacket: packet,
      nextContextRequests: [],
    });
    if (!continuity.ok) {
      const codes = continuity.violations.map((violation) => violation.kind).join(", ");
      throw new Error(`LLM evaluator violated stable ID continuity: ${codes}`);
    }
  }

  const eventId = `evt_llm_${request.trigger}_${sessionId}_${iteration}_${Date.now()}`;
  return {
    packet,
    events: [
      {
        id: eventId,
        kind: `llm.evaluator.${request.trigger}`,
        sessionId,
        payload: {
          readiness: packet.readiness,
          iteration,
        },
      },
    ],
    contextRequests: [],
  };
}

// ---- ss-llm-003: implementation --------------------------------------------

/**
 * Create a real LLM-backed Spec Studio evaluator using the connector pattern.
 *
 * @param {{
 *   connector: object,
 *   model?: string,
 *   timeoutMs?: number
 * }} options
 * @returns {(request: object) => Promise<object>}
 */
export function createLlmSpecStudioEvaluator({
  connector,
  model = process.env.SEMANTIX_SPEC_STUDIO_MODEL ?? process.env.SEMANTIX_CODEX_MODEL,
  timeoutMs = Number(process.env.SEMANTIX_SPEC_STUDIO_TIMEOUT_MS ?? 300000),
  maxClarificationRetries = Number(process.env.SEMANTIX_SPEC_STUDIO_CLARIFICATION_RETRIES ?? 1),
  maxMissingQuestionRetries = Number(process.env.SEMANTIX_SPEC_STUDIO_MISSING_QUESTION_RETRIES ?? 1),
} = {}) {
  if (!connector || typeof connector.execute !== "function") {
    throw new Error("createLlmSpecStudioEvaluator requires a connector with execute().");
  }

  const systemPrompt = buildEvaluatorSystemPrompt();

  const rawEvaluator = async function llmEvaluate(request) {
    const sessionId = request.sessionId;
    const priorPacket = request.currentPacket ?? null;
    const iteration = (priorPacket?.iteration ?? -1) + 1;

    if (request.trigger === "initial" && !initialRequestText(request)) {
      throw new Error("Spec Studio initial request is empty; LLM evaluator was not called.");
    }

    const userMessage = synthesizeEvaluatorInput(request);
    const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;
    let prompt = fullPrompt;
    const retryEvents = [];
    const llmResponses = [];
    const retryLimit =
      Number.isFinite(maxClarificationRetries) && maxClarificationRetries > 0
        ? Math.floor(maxClarificationRetries)
        : 0;
    const missingQuestionRetryLimit =
      Number.isFinite(maxMissingQuestionRetries) && maxMissingQuestionRetries > 0
        ? Math.floor(maxMissingQuestionRetries)
        : 0;
    const maxAttempts = retryLimit + missingQuestionRetryLimit;
    let missingQuestionRetriesUsed = 0;

    for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
      const controller = new AbortController();
      const timeout =
        Number.isFinite(timeoutMs) && timeoutMs > 0
          ? setTimeout(() => controller.abort(), timeoutMs)
          : null;

      let result;
      try {
        result = await connector.execute({
          input: prompt,
          model,
          approvalPolicy: "never",
          sandboxMode: "read-only",
          signal: controller.signal,
        });
      } finally {
        if (timeout) clearTimeout(timeout);
      }

      result = normalizeLlmConnectorResult(result);

      const rawOutputs = collectLlmOutputCandidates(result);
      const rawText = rawOutputs.length > 0 ? rawOutputs.join("\n") : "";
      const currentTrace = buildLlmResponseTrace({
        attempt: attempt + 1,
        model,
        result,
        rawOutputs,
        rawText,
      });
      llmResponses.push(currentTrace);

      if (result.exitCode !== 0) {
        throw attachLlmResponsesToError(new Error(
          result.stderr
            ? `LLM evaluator exited with ${result.exitCode}: ${String(result.stderr).slice(0, 240)}`
            : `LLM evaluator exited with code ${result.exitCode}`,
        ), llmResponses);
      }

      try {
        if (rawText.trim().length === 0) {
          throw new Error(describeEmptyConnectorResult(result, { model }));
        }
        const response = parseEvaluatorOutput(sessionId, iteration, rawText, request);
        const quality = validateClarificationQuality(response.packet, request);
        const canRetryQuality =
          attempt < retryLimit ||
          (
            isNeedsUserQuestionRetryReason(quality.reason) &&
            missingQuestionRetriesUsed < missingQuestionRetryLimit
          );
        if (!quality.ok && canRetryQuality) {
          if (attempt >= retryLimit && isNeedsUserQuestionRetryReason(quality.reason)) {
            missingQuestionRetriesUsed += 1;
          }
          currentTrace.retryReason = quality.reason;
          retryEvents.push(correctiveRetryEvent(request, attempt + 1, quality.reason));
          prompt = buildCorrectiveRetryPrompt({
            systemPrompt,
            userMessage,
            reason: quality.reason,
            rawText,
          });
          continue;
        }
        if (!quality.ok) {
          throw new Error(`LLM evaluator returned low-quality clarification: ${quality.reason}`);
        }
        if (retryEvents.length > 0) {
          response.events = [...retryEvents, ...asArray(response.events)];
        }
        response.llmResponses = llmResponses;
        return response;
      } catch (error) {
        const canRetryError =
          shouldRetryEvaluatorError(error) &&
          (
            attempt < retryLimit ||
            (
              isNeedsUserQuestionRetryReason(error.message) &&
              missingQuestionRetriesUsed < missingQuestionRetryLimit
            )
          );
        if (canRetryError) {
          if (attempt >= retryLimit && isNeedsUserQuestionRetryReason(error.message)) {
            missingQuestionRetriesUsed += 1;
          }
          currentTrace.retryReason = error.message;
          retryEvents.push(correctiveRetryEvent(request, attempt + 1, error.message));
          prompt = buildCorrectiveRetryPrompt({
            systemPrompt,
            userMessage,
            reason: error.message,
            rawText,
          });
          continue;
        }
        throw attachLlmResponsesToError(error, llmResponses);
      }
    }

    throw attachLlmResponsesToError(
      new Error("LLM evaluator exhausted corrective retries without returning a packet."),
      llmResponses,
    );
  };

  const evaluateWithFallback = withDegradationFallback(rawEvaluator, {
    buildEvent: ({ request, error }) => ({
      id: `evt_llm_degraded_${request?.sessionId ?? "unknown"}_${Date.now()}`,
      kind: "llm.evaluator.degraded",
      sessionId: request?.sessionId,
      payload: { reason: error.message },
    }),
  });

  const evaluate = async (request) => {
    const response = await evaluateWithFallback(request);
    return withSemantixTurnLogEntry(request, response);
  };
  evaluate.evaluatorMode = "llm";
  return evaluate;
}
