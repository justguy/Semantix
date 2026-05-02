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
  SECTION_ID_VALUES,
  SOURCE_SEMANTIX,
  validateSemantixAlignmentPacket,
} from "./spec-studio-contracts.js";
import { withDegradationFallback } from "./spec-studio-degraded.js";
import { checkIdContinuity } from "./spec-studio-id-continuity.js";
import { applyUserChoiceTurn } from "./spec-studio-user-turn-loop.js";

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
    "- Preserve all stable IDs from currentPacket when provided: requirements, findings, groundedFacts, contextSources, and userDecisions. If a user answer resolves a finding, keep the same finding id and mark it resolved; do not drop it.",
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
      flow: {
        pages: [{ id: "PAGE-001", name: "<string>", purpose: "<string>", sourceRef: "<string>" }],
        states: [{ id: "STATE-001", name: "<string>", description: "<string>", sourceRef: "<string>" }],
        transitions: [{ id: "TRANS-001", from: "<state id>", to: "<state id>", trigger: "<string>", result: "<string>", sourceRef: "<string>" }],
        dataNeeded: [{ id: "DATA-001", name: "<string>", consumerRef: "<string>", requiredFor: "<string>", unresolved: true }],
      },
      scope: { inScope: [], outOfScope: [], negativeRequirements: [] },
      assumptions: [{ id: "A-001", text: "<string>", section: "assumptions", sourceRef: "<string>" }],
      openQuestions: [{ id: "Q-001", section: "scope", question: "<string>", options: ["<string>"] }],
      risks: [{ id: "RISK-001", text: "<string>", section: "risks", sourceRef: "<string>" }],
      userDecisions: [],
      acceptanceSummary: [],
      existingSystemContext: {
        mode: "new | update | unknown",
        targetSurfaces: [{ id: "surf_001", kind: "ui-page | ui-panel | api | component | unknown", name: "<string>" }],
        doNotChange: ["<string — required when mode=update AND readiness=ready: things that must not change>"],
        reuseRequirements: ["<string — existing requirements to reuse unchanged>"],
        compatibilityRequirements: ["<string — backward-compat constraints>"],
      },
      contextSources: [
        {
          id: "<stable string e.g. CS-001>",
          kind: "user | html | spec | phalanx | hoplon | repo | trace | upload",
          summary: "<string>",
          status: "used | unavailable | skipped",
          evidenceRefs: ["<string — required when status=used>"],
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
        sections: [
          {
            id: "intent | scope | boundaries | success | constraints | assumptions | stakeholders | risks | failure | nfr",
            name: "<string>",
            required: "must | should | could",
            coverage: "<number 0-100>",
            status: "locked | covered | weak | empty",
            annotations: "<number>",
          },
        ],
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

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
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
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isPlainObject(value)) {
    for (const key of ["text", "question", "summary", "name", "description", "reason"]) {
      if (isNonEmptyString(value[key])) return value[key].trim();
    }
  }
  return "";
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

function normalizeSectionId(value, fallback = "intent") {
  if (typeof value !== "string") return fallback;
  const normalized = slug(value);
  return SECTION_ID_VALUES.includes(normalized) ? normalized : fallback;
}

function normalizeTextRecord(value, index, prefix, textKey = "text", extra = {}) {
  if (isPlainObject(value)) {
    const text = textOf(value);
    return {
      ...value,
      id: isNonEmptyString(value.id) ? value.id : numberedId(prefix, index),
      [textKey]: text || `${prefix} ${index + 1}`,
      ...extra,
    };
  }
  return {
    id: numberedId(prefix, index),
    [textKey]: textOf(value) || `${prefix} ${index + 1}`,
    ...extra,
  };
}

function normalizeBlockingReasons(value) {
  return asArray(value)
    .map((item, index) => normalizeTextRecord(item, index, "BR-LLM"))
    .filter((item) => isNonEmptyString(item.text));
}

function normalizeOpenQuestions(value) {
  return asArray(value)
    .map((item, index) => {
      const question = normalizeTextRecord(item, index, "Q-LLM", "question", {
        section: normalizeSectionId(item?.section ?? item?.target ?? item?.ref, "scope"),
      });
      if (Array.isArray(item?.options)) question.options = item.options;
      return question;
    })
    .filter((item) => isNonEmptyString(item.question));
}

function normalizeInterpretations(value, prefix, defaultSection) {
  return asArray(value)
    .map((item, index) => normalizeTextRecord(item, index, prefix, "text", {
      section: normalizeSectionId(item?.section, defaultSection),
      sourceRef: isNonEmptyString(item?.sourceRef) ? item.sourceRef : "llm",
    }))
    .filter((item) => isNonEmptyString(item.text));
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

function normalizeNextTurn(value) {
  if (!isPlainObject(value)) return value;
  return {
    ...value,
    target: normalizeSectionId(value.target, "intent"),
  };
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

function mergeRequirementsPreservingInvalidSupersession(priorItems, nextItems) {
  const priorById = new Map(
    asArray(priorItems)
      .filter((item) => idOf(item))
      .map((item) => [idOf(item), item]),
  );
  const next = asArray(nextItems);
  const nextIds = new Set(next.map(idOf).filter(Boolean));
  const replacedPriorIds = new Set();
  const repairedNext = next.map((requirement) => {
    const id = idOf(requirement);
    const prior = id ? priorById.get(id) : null;
    if (prior && !isValidSupersession(requirement, nextIds)) {
      replacedPriorIds.add(id);
      return deepClone(prior);
    }
    return requirement;
  });
  const repairedIds = new Set(repairedNext.map(idOf).filter(Boolean));
  const missingPrior = asArray(priorItems)
    .filter((prior) => {
      const id = idOf(prior);
      return id && !repairedIds.has(id) && prior.status !== "superseded" && !replacedPriorIds.has(id);
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

function buildStableBaseline(request) {
  const prior = request?.currentPacket;
  if (!isPlainObject(prior)) return null;
  const userTurn = request?.userTurn;
  const body = userTurn?.body;
  if (!isPlainObject(userTurn) || !isPlainObject(body) || body.kind !== "choice") {
    return prior;
  }

  const singleOpenQuestion =
    asArray(prior.openQuestions).filter(isPlainObject).length === 1
      ? asArray(prior.openQuestions).find(isPlainObject)
      : null;
  const candidateRefs = uniqueNonEmpty([
    body.questionTurnId,
    prior.nextTurn?.id,
    singleOpenQuestion?.id,
  ]);
  if (!isNonEmptyString(body.picked) || candidateRefs.length === 0) return prior;

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

function preserveStableIds(packet, request) {
  const baseline = buildStableBaseline(request);
  if (!isPlainObject(baseline)) return;
  packet.requirements = mergeRequirementsPreservingInvalidSupersession(
    baseline.requirements,
    packet.requirements,
  );
  packet.findings = mergeMissingStableItems(baseline.findings, packet.findings);
  packet.groundedFacts = mergeMissingStableItems(baseline.groundedFacts, packet.groundedFacts);
  packet.contextSources = mergeMissingStableItems(baseline.contextSources, packet.contextSources);
  packet.userDecisions = mergeMissingStableItems(baseline.userDecisions, packet.userDecisions);
  repairCoverageAfterStableMerge(packet);
}

function canonicalizeLlmPacket(packet, request) {
  packet.blockingReasons = normalizeBlockingReasons(packet.blockingReasons);
  packet.flow = normalizeFlow(packet.flow);
  packet.assumptions = normalizeInterpretations(packet.assumptions, "A-LLM", "assumptions");
  packet.openQuestions = normalizeOpenQuestions(packet.openQuestions);
  packet.risks = normalizeInterpretations(packet.risks, "RISK-LLM", "risks");
  packet.userDecisions = asArray(packet.userDecisions).filter(isCanonicalUserDecision);
  packet.nextTurn = normalizeNextTurn(packet.nextTurn);
  packet.existingSystemContext = normalizeExistingSystemContext(packet.existingSystemContext);
  packet.contextSources = normalizeContextSources(packet.contextSources, request);
  packet.coverage = normalizeCoverage(packet.coverage, packet.readiness);
  preserveStableIds(packet, request);
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

  canonicalizeLlmPacket(packet, request);

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

  if (request.currentPacket) {
    const continuity = checkIdContinuity({
      priorPacket: request.currentPacket,
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
