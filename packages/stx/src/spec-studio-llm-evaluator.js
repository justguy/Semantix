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

import { CONTRACT_VERSION, SOURCE_SEMANTIX, validateSemantixAlignmentPacket } from "./spec-studio-contracts.js";
import { withDegradationFallback } from "./spec-studio-degraded.js";

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
    "- Ask clarifying questions (readiness=needs_user, nextTurn.body.kind=question) when the request is ambiguous.",
    "- For a small set of discrete answers (e.g. placement, storage scope), keep nextTurn.body.kind=\"question\" and include body.options with 2-5 options, each with a unique id and a short label. The user may still answer in free text — options are suggestions only.",
    "- Only set readiness=ready when scope, boundaries, and key requirements are fully resolved.",
    "- Never set readiness=ready if there are unresolved blocker findings.",
    "- When readiness=ready: set coverage.alignmentPct=100, coverage.openBlockers=0, and mark every prior blocker finding as resolved=true.",
    "- When readiness=ready AND existingSystemContext.mode=update, you MUST include at least one targetSurfaces entry AND at least one of doNotChange, reuseRequirements, or compatibilityRequirements.",
    "- Preserve all stable IDs (requirements, findings, decisions) from the currentPacket when provided.",
    "",
    "Required JSON shape (all fields are required unless marked optional):",
    JSON.stringify({
      contractVersion: "semantix.phalanx.spec-studio.v1",
      source: "semantix",
      sessionId: "<string>",
      iteration: "<number>",
      readiness: "ready | needs_user | blocked",
      readinessReason: "<string>",
      blockingReasons: [],
      approvalRequired: true,
      originalUserRequest: "<string — preserve verbatim from request>",
      alignedRequirement: "<string — concise canonical form>",
      requirements: [
        {
          id: "<stable string e.g. REQ-001>",
          type: "functional | nonfunctional | negative | constraint | acceptance | integration",
          text: "<string>",
          priority: "must | should | could",
          sourceRef: "<string>",
          acceptance: "<string>",
          status: "proposed | confirmed | contested | superseded",
        },
      ],
      flow: { pages: [], states: [], transitions: [], dataNeeded: [] },
      scope: { inScope: [], outOfScope: [], negativeRequirements: [] },
      assumptions: [],
      openQuestions: [],
      risks: [],
      userDecisions: [],
      acceptanceSummary: [],
      existingSystemContext: {
        mode: "new | update | unknown",
        targetSurfaces: ["<string — required when mode=update AND readiness=ready: UI/API/component area being changed>"],
        doNotChange: ["<string — required when mode=update AND readiness=ready: things that must not change>"],
        reuseRequirements: ["<string — existing requirements to reuse unchanged>"],
        compatibilityRequirements: ["<string — backward-compat constraints>"],
      },
      contextSources: [
        {
          id: "<stable string e.g. CS-001>",
          kind: "user | html | spec | phalanx | hoplon | repo | trace | upload",
          ref: "<string>",
          summary: "<string>",
          status: "used | unavailable | skipped",
        },
      ],
      groundedFacts: [
        {
          id: "<stable string e.g. GF-001>",
          source: "user | html | spec | phalanx | hoplon | repo | trace | upload",
          text: "<string>",
          evidenceRef: "<string — must be non-empty>",
          confidence: "high | medium | low",
        },
      ],
      findings: [
        {
          id: "<stable string e.g. F-001>",
          kind: "gap | contradiction | assumption | risk | drift",
          sev: "blocker | concern | fyi",
          section: "intent | scope | boundaries | success | constraints | assumptions | stakeholders | risks | failure | nfr",
          ref: "<string>",
          text: "<string>",
          resolved: false,
          raisedBy: "semantix",
        },
      ],
      coverage: {
        alignmentPct: "<number 0-100>",
        sections: [],
        openBlockers: "<number>",
        openConcerns: "<number>",
        openFYI: "<number>",
      },
      nextTurn: {
        id: "<string>",
        side: "semantix",
        at: "<ISO timestamp>",
        phase: "crisp | socratic | adversarial | locked",
        target: "<string>",
        body: {
          kind: "question",
          q: "<string>",
          options: [
            {
              id: "OPT-001",
              label: "<short option label>",
              description: "<optional string>",
              tag: "recommend | risk | neutral",
            },
          ],
        },
      },
    }),
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

/**
 * Extract a JSON object from raw LLM text output, handling markdown code
 * blocks and surrounding prose.
 *
 * @param {string} rawText
 * @returns {object | null}
 */
export function extractJsonFromLlmOutput(rawText) {
  if (typeof rawText !== "string") return null;
  const text = rawText.trim();
  if (!text) return null;

  // Try direct parse first
  const direct = tryParseJson(text);
  if (direct && typeof direct === "object" && !Array.isArray(direct)) return direct;

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const inner = tryParseJson(fenceMatch[1].trim());
    if (inner && typeof inner === "object" && !Array.isArray(inner)) return inner;
  }

  // Extract first {...} block from surrounding prose
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const extracted = tryParseJson(text.slice(start, end + 1));
    if (extracted && typeof extracted === "object" && !Array.isArray(extracted)) return extracted;
  }

  return null;
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
  const parsed = extractJsonFromLlmOutput(rawText);
  if (!parsed) {
    throw new Error(
      `LLM evaluator returned non-JSON output (${String(rawText).slice(0, 120)}…).`,
    );
  }

  // Stamp stable fields the LLM might have left blank or wrong
  const packet = {
    ...parsed,
    contractVersion: CONTRACT_VERSION,
    source: SOURCE_SEMANTIX,
    sessionId,
    iteration,
  };

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

  // Ensure coverage exists
  if (!packet.coverage || typeof packet.coverage !== "object") {
    packet.coverage = { alignmentPct: 0, sections: [], openBlockers: 0, openConcerns: 0, openFYI: 0 };
  }

  // Ensure existingSystemContext exists
  if (!packet.existingSystemContext || typeof packet.existingSystemContext !== "object") {
    packet.existingSystemContext = { mode: "unknown" };
  }

  // Validate the resulting packet
  const validation = validateSemantixAlignmentPacket(packet);
  if (!validation.ok) {
    const codes = validation.errors.map((e) => e.code).join(", ");
    throw new Error(`LLM evaluator returned an invalid packet: ${codes}`);
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
  model = process.env.SEMANTIX_SPEC_STUDIO_MODEL ?? "claude-sonnet-4-6",
  timeoutMs = Number(process.env.SEMANTIX_SPEC_STUDIO_TIMEOUT_MS ?? 60000),
} = {}) {
  if (!connector || typeof connector.execute !== "function") {
    throw new Error("createLlmSpecStudioEvaluator requires a connector with execute().");
  }

  const systemPrompt = buildEvaluatorSystemPrompt();

  const rawEvaluator = async function llmEvaluate(request) {
    const sessionId = request.sessionId;
    const priorPacket = request.currentPacket ?? null;
    const iteration = (priorPacket?.iteration ?? -1) + 1;

    const userMessage = synthesizeEvaluatorInput(request);
    const fullPrompt = `${systemPrompt}\n\n---\n\n${userMessage}`;

    const controller = new AbortController();
    const timeout =
      Number.isFinite(timeoutMs) && timeoutMs > 0
        ? setTimeout(() => controller.abort(), timeoutMs)
        : null;

    let result;
    try {
      result = await connector.execute({
        input: fullPrompt,
        model,
        approvalPolicy: "never",
        sandboxMode: "read-only",
        signal: controller.signal,
      });
    } finally {
      if (timeout) clearTimeout(timeout);
    }

    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr
          ? `LLM evaluator exited with ${result.exitCode}: ${String(result.stderr).slice(0, 240)}`
          : `LLM evaluator exited with code ${result.exitCode}`,
      );
    }

    const rawText =
      typeof result.stdout === "string" ? result.stdout : JSON.stringify(result.finalJsonObject ?? "");

    return parseEvaluatorOutput(sessionId, iteration, rawText, request);
  };

  const evaluate = withDegradationFallback(rawEvaluator, {
    buildEvent: ({ request, error }) => ({
      id: `evt_llm_degraded_${request?.sessionId ?? "unknown"}_${Date.now()}`,
      kind: "llm.evaluator.degraded",
      sessionId: request?.sessionId,
      payload: { reason: error.message },
    }),
  });

  evaluate.evaluatorMode = "llm";
  return evaluate;
}
