import { randomUUID } from "node:crypto";

import { createDefaultSemanticResponseSchema } from "../../core/src/index.js";
import { runCriticalReview } from "./ct-review.js";

function compactText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function countMatches(text, terms) {
  return terms.reduce((count, term) => count + (text.includes(term) ? 1 : 0), 0);
}

function countWords(value) {
  return compactText(value).match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function looksLikeClassificationObject(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (
        value.complexity != null ||
        value.effort != null ||
        value.riskLevel != null ||
        value.risk_level != null ||
        value.confidenceScore != null ||
        value.confidence_score != null ||
        value.outputKind != null ||
        value.output_kind != null ||
        value.signals != null ||
        value.reasons != null
      ),
  );
}

function extractJsonObject(value, depth = 0) {
  if (depth > 6) return null;

  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (looksLikeClassificationObject(value)) {
      return value;
    }

    for (const candidate of Object.values(value)) {
      const extracted = extractJsonObject(candidate, depth + 1);
      if (extracted) return extracted;
    }

    return null;
  }

  if (Array.isArray(value)) {
    for (const candidate of value) {
      const extracted = extractJsonObject(candidate, depth + 1);
      if (extracted) return extracted;
    }

    return null;
  }

  const text = String(value ?? "").trim();
  if (!text) return null;

  const direct = tryParseJson(text);
  const directObject = extractJsonObject(direct, depth + 1);
  if (directObject) {
    return directObject;
  }

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of lines.slice().reverse()) {
    const parsedLine = tryParseJson(line);
    const lineObject = extractJsonObject(parsedLine, depth + 1);
    if (lineObject) return lineObject;
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const extracted = tryParseJson(text.slice(start, end + 1));
    return extractJsonObject(extracted, depth + 1);
  }

  return null;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function classifyConfidence({ effortScore, riskScore }) {
  const score =
    0.94 -
    Math.min(0.24, effortScore * 0.045) -
    Math.min(0.28, riskScore * 0.07);

  return Number(clamp(score, 0.38, 0.92).toFixed(2));
}

function normalizeBand(score) {
  if (score >= 0.8) {
    return "high";
  }

  if (score >= 0.55) {
    return "medium";
  }

  return "low";
}

function normalizeLevel(value, fallback) {
  const normalized = compactText(value).toLowerCase();
  return ["low", "medium", "high"].includes(normalized) ? normalized : fallback;
}

function normalizeOutputKind(value, fallback = "code_change") {
  const normalized = compactText(value).toLowerCase().replaceAll("-", "_");
  return ["semantic_response", "code_change"].includes(normalized) ? normalized : fallback;
}

function inferOutputRouting({
  primaryDirective,
  successState,
} = {}) {
  const directiveText = compactText(primaryDirective).toLowerCase();
  const taskText = directiveText || compactText(successState).toLowerCase();
  const materialWorkspaceTerms = [
    "codebase",
    "commit",
    "component",
    "database",
    "delete",
    "endpoint",
    "feature branch",
    "file",
    "files",
    "fix",
    "implement",
    "json",
    "login",
    "migrate",
    "migration",
    "modify",
    "package",
    "prohect",
    "push",
    "refactor",
    "repo",
    "repository",
    "route",
    "signup",
    "subagent",
    "subagents",
    "task",
    "tasks",
    "test",
    "tracker",
    "trcker",
    "wire",
  ];
  const materialVerbTerms = [
    "add",
    "build",
    "change",
    "create",
    "delete",
    "execute",
    "executuon",
    "fix",
    "implement",
    "migrate",
    "modify",
    "refactor",
    "rename",
    "update",
    "wire",
  ];
  const semanticOnlyTerms = [
    "answer",
    "describe",
    "design",
    "draft",
    "explain",
    "joke",
    "outline",
    "poem",
    "say",
    "story",
    "summarize",
    "tell me",
    "write",
  ];
  const asksForSemanticOutput = hasAny(taskText, semanticOnlyTerms);
  const requiresFileChanges =
    hasAny(taskText, materialWorkspaceTerms) ||
    (hasAny(taskText, materialVerbTerms) && !asksForSemanticOutput);
  const semanticOnly = asksForSemanticOutput && !requiresFileChanges;

  return {
    outputKind: semanticOnly ? "semantic_response" : "code_change",
    requiresExecution: requiresFileChanges,
    requiresFileChanges,
  };
}

function normalizeStringArray(value, fallback = []) {
  const values = Array.isArray(value) ? value : fallback;
  return values
    .map((entry) => compactText(entry))
    .filter(Boolean)
    .slice(0, 8);
}

export function classifyCodexRequest({
  primaryDirective,
  strictBoundaries = [],
  successState,
} = {}) {
  const directiveText = compactText(primaryDirective).toLowerCase();
  const fallbackText = compactText(successState).toLowerCase();
  const taskText = directiveText || fallbackText;
  const routing = inferOutputRouting({
    primaryDirective,
    successState,
  });
  const wordCount = countWords(taskText);
  const hardConstraintCount = countMatches(taskText, [
    "must",
    "strictly",
    "prohibited",
    "forbidden",
    "exactly",
    "only",
    "zero",
    "all",
    "never",
    "always",
    "cannot",
    "without",
    "before",
    "after",
  ]);
  const reasons = [];
  const suggestedSteps = ["Fast classification"];
  let effortScore = 0;
  let riskScore = 0;

  if (hasAny(taskText, ["add", "build", "create", "implement", "refactor", "modify", "wire"])) {
    effortScore += 1;
    suggestedSteps.push("Code proposal");
    reasons.push("Code generation or modification task detected.");
  }

  if (hasAny(taskText, ["design", "outline", "architecture", "workflow", "essay", "write", "tell me"])) {
    effortScore += 1;
    reasons.push("Structured semantic output requested.");
  }

  if (hasAny(taskText, ["auth", "authentication", "verification", "token", "signup", "login"])) {
    effortScore += 1;
    riskScore += 1;
    reasons.push("Authentication or identity flow touched.");
  }

  if (hasAny(taskText, ["email", "message", "notify", "smtp", "webhook", "api"])) {
    effortScore += 1;
    riskScore += 1;
    reasons.push("External communication or API behavior may be involved.");
  }

  if (hasAny(taskText, ["database", "migration", "schema", "payment", "billing", "secret", "delete", "rename"])) {
    effortScore += 2;
    riskScore += 2;
    reasons.push("Persistent or sensitive state may change.");
  }

  if (hasAny(taskText, ["deploy", "execute", "execution", "approve", "approval", "agent", "orchestration"])) {
    effortScore += 1;
    riskScore += 1;
    reasons.push("Execution or approval workflow semantics are involved.");
  }

  if (hardConstraintCount >= 3) {
    effortScore += 1;
    reasons.push(`${hardConstraintCount} hard constraint markers were detected in the prompt.`);
  }

  if (wordCount >= 80) {
    effortScore += 1;
    reasons.push("Long-form prompt requires constraint tracking.");
  }

  if (wordCount >= 160) {
    effortScore += 1;
    suggestedSteps.push("Deeper semantic decomposition");
    reasons.push("Large prompt likely needs multi-step review.");
  }

  if (Array.isArray(strictBoundaries) && strictBoundaries.length > 0) {
    effortScore += 1;
    suggestedSteps.push("Constraint validation");
    reasons.push(`${strictBoundaries.length} explicit ${strictBoundaries.length === 1 ? "boundary requires" : "boundaries require"} validation.`);
  }

  const effort =
    effortScore >= 6 ? "high" : effortScore >= 2 ? "medium" : "low";
  const riskLevel =
    riskScore >= 4 ? "high" : riskScore >= 1 ? "medium" : "low";
  const confidenceScore = classifyConfidence({
    effortScore,
    riskScore,
  });

  return {
    complexity: effort,
    effort,
    riskLevel,
    outputKind: routing.outputKind,
    confidenceScore,
    confidenceBand: normalizeBand(confidenceScore),
    signals: {
      wordCount,
      hardConstraintCount,
      effortScore,
      riskScore,
      semanticContradictionSignals: 0,
      requiresExecution: routing.requiresExecution,
      requiresFileChanges: routing.requiresFileChanges,
      classifier: "heuristic",
    },
    reasons:
      reasons.length > 0
        ? reasons
        : ["No high-risk keywords or external side effects detected."],
    suggestedSteps: unique([
      ...suggestedSteps,
      "Structured Semantix review",
      ...(routing.requiresExecution ? ["Approval-gated execution"] : ["Semantic response admission"]),
    ]),
  };
}

export function buildLlmClassificationPrompt({
  primaryDirective,
  strictBoundaries = [],
  successState,
} = {}) {
  return [
    "You are the Semantix fast classifier. Classify the user's requested work before planning or execution.",
    "Use semantic judgment. Do not use hardcoded keyword rules. Do not invent repo facts.",
    "Return exactly one JSON object and no markdown.",
    "Schema:",
    JSON.stringify({
      complexity: "low|medium|high",
      effort: "low|medium|high",
      riskLevel: "low|medium|high",
      confidenceScore: "number from 0.0 to 1.0",
      outputKind: "semantic_response|code_change",
      reasons: ["short evidence-backed reasons tied to the prompt"],
      suggestedSteps: ["short step labels"],
      signals: {
        effortScore: "optional integer 0-10",
        riskScore: "optional integer 0-10",
        semanticContradictionSignals: "optional integer, only if the prompt itself contains semantic tension",
        requiresExecution: "boolean, true only if real project/workspace execution is requested",
        requiresFileChanges: "boolean, true only if the request should change files or repo state",
      },
    }),
    "Input:",
    JSON.stringify({
      primaryDirective: String(primaryDirective ?? ""),
      strictBoundaries: Array.isArray(strictBoundaries) ? strictBoundaries : [],
      successState: String(successState ?? ""),
    }),
  ].join("\n");
}

export function normalizeLlmClassification(rawClassification, input = {}, { model } = {}) {
  const fallback = classifyCodexRequest(input);
  const raw = rawClassification && typeof rawClassification === "object" ? rawClassification : {};
  const confidence = Number(raw.confidenceScore ?? raw.confidence_score);
  const confidenceScore = Number.isFinite(confidence)
    ? Number(clamp(confidence, 0.05, 0.99).toFixed(2))
    : fallback.confidenceScore;
  const effort = normalizeLevel(raw.effort ?? raw.complexity, fallback.effort);
  const riskLevel = normalizeLevel(raw.riskLevel ?? raw.risk_level, fallback.riskLevel);
  const routing = inferOutputRouting(input);
  const rawOutputKind = raw.outputKind ?? raw.output_kind;
  const hasRawOutputKind = rawOutputKind != null;
  const outputKind = normalizeOutputKind(rawOutputKind, fallback.outputKind ?? routing.outputKind);
  const effortScore = Number(raw.signals?.effortScore ?? raw.signals?.effort_score);
  const riskScore = Number(raw.signals?.riskScore ?? raw.signals?.risk_score);
  const semanticContradictionSignals = Number(
    raw.signals?.semanticContradictionSignals ??
    raw.signals?.semantic_contradiction_signals ??
    0,
  );

  return {
    complexity: normalizeLevel(raw.complexity ?? effort, effort),
    effort,
    riskLevel,
    outputKind,
    confidenceScore,
    confidenceBand: normalizeBand(confidenceScore),
    signals: {
      ...fallback.signals,
      effortScore: Number.isFinite(effortScore) ? effortScore : fallback.signals.effortScore,
      riskScore: Number.isFinite(riskScore) ? riskScore : fallback.signals.riskScore,
      semanticContradictionSignals: Number.isFinite(semanticContradictionSignals)
        ? semanticContradictionSignals
        : 0,
      requiresExecution:
        typeof raw.signals?.requiresExecution === "boolean" || typeof raw.signals?.requires_execution === "boolean"
          ? Boolean(raw.signals.requiresExecution ?? raw.signals.requires_execution)
          : hasRawOutputKind
            ? outputKind === "code_change"
            : routing.requiresExecution,
      requiresFileChanges:
        typeof raw.signals?.requiresFileChanges === "boolean" || typeof raw.signals?.requires_file_changes === "boolean"
          ? Boolean(raw.signals.requiresFileChanges ?? raw.signals.requires_file_changes)
          : hasRawOutputKind
            ? outputKind === "code_change"
            : routing.requiresFileChanges,
      classifier: "llm",
      classifierModel: model ?? null,
    },
    reasons: normalizeStringArray(raw.reasons, fallback.reasons),
    suggestedSteps: unique([
      ...normalizeStringArray(raw.suggestedSteps ?? raw.suggested_steps, fallback.suggestedSteps),
      "Structured Semantix review",
      ...(outputKind === "code_change" ? ["Approval-gated execution"] : ["Semantic response admission"]),
    ]),
  };
}

function fallbackClassification(input, { model, error } = {}) {
  const fallback = classifyCodexRequest(input);
  return {
    ...fallback,
    signals: {
      ...fallback.signals,
      classifier: "heuristic_fallback",
      classifierModel: model ?? null,
      classifierError: compactText(error?.message ?? error).slice(0, 180),
    },
    reasons: unique([
      "Mini-model classification failed; deterministic fallback was used.",
      ...fallback.reasons,
    ]),
  };
}

export function createLlmClassificationProvider({
  connector,
  model = process.env.SEMANTIX_CLASSIFIER_MODEL ?? "gpt-5.3-codex-spark",
  timeoutMs = Number(process.env.SEMANTIX_CLASSIFIER_TIMEOUT_MS ?? 20000),
} = {}) {
  if (!connector || typeof connector.execute !== "function") {
    throw new Error("createLlmClassificationProvider requires a connector with execute().");
  }

  return async function classifyWithMiniModel(input = {}) {
    const controller = new AbortController();
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const result = await connector.execute({
        input: buildLlmClassificationPrompt(input),
        model,
        approvalPolicy: "never",
        sandboxMode: "read-only",
        signal: controller.signal,
      });

      if (result.exitCode !== 0) {
        throw new Error(result.stderr || `Classifier exited with ${result.exitCode}`);
      }

      const parsed = extractJsonObject(result.finalJsonObject ?? result.stdout);
      if (!parsed) {
        throw new Error("Classifier did not return a JSON object.");
      }

      return normalizeLlmClassification(parsed, input, { model });
    } catch (error) {
      return fallbackClassification(input, { model, error });
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
}

function isSemanticGenerationNode(node) {
  return ["semantic_generation", "semantic", "tool"].includes(node?.nodeType);
}

function isDeterministicExecutionNode(node) {
  return ["deterministic_execution", "deterministic"].includes(node?.nodeType);
}

function isApprovalNode(node) {
  return ["approval_gate", "approval"].includes(node?.nodeType);
}

function getRuntimeNode(artifact) {
  return artifact?.plan?.nodes?.find(isSemanticGenerationNode) ?? null;
}

function getDeterministicNode(artifact) {
  return artifact?.plan?.nodes?.find(isDeterministicExecutionNode) ?? null;
}

function getApprovalGate(artifact, targetNodeId) {
  return (
    artifact?.plan?.approvalGates?.find((gate) => gate.targetNodeId === targetNodeId) ??
    null
  );
}

function getLatestAvailableCheckpoint(artifact) {
  return (
    artifact?.plan?.checkpoints
      ?.slice()
      .reverse()
      .find((checkpoint) => checkpoint.status !== "consumed") ?? null
  );
}

function stateEffectTargets(effect) {
  if (!effect) {
    return [];
  }

  if (Array.isArray(effect.targets) && effect.targets.length > 0) {
    return effect.targets;
  }

  return [effect.target].filter(Boolean);
}

function materialStateEffects(artifact) {
  return (artifact?.plan?.stateEffects ?? []).filter((effect) => {
    const targets = stateEffectTargets(effect);
    return targets.length > 0 && !targets.every((target) => target.startsWith("semantix.host."));
  });
}

function issueText(issue) {
  return (
    issue?.summary ??
    issue?.message ??
    issue?.title ??
    issue?.code ??
    "Review issue detected."
  );
}

function normalizeIssue(issue, nodeId) {
  return {
    code: issue?.code ?? issue?.type ?? "review_issue",
    severity: issue?.severity ?? (issue?.blocking ? "high" : "medium"),
    blocking:
      issue?.blocking === true ||
      ["block", "blocked"].includes(issue?.status) ||
      ["block", "blocked"].includes(issue?.disposition),
    summary: issueText(issue),
    affectedSymbols: [...(issue?.affectedSymbols ?? issue?.symbols ?? [])],
    evidence: [...(issue?.evidence ?? [])],
    nodeId,
    raw: issue,
  };
}

function nodeIsBlockedOrFailed(node) {
  return (
    node?.executionStatus === "failed" ||
    node?.reviewStatus === "blocked"
  );
}

function issueFromNodeRiskFlag(node, riskFlag) {
  const summary =
    node?.outputSummary ??
    (typeof riskFlag === "string" ? riskFlag.replaceAll("_", " ") : "Runtime issue detected.");

  return normalizeIssue({
    code: riskFlag || "runtime_node_blocked",
    type: riskFlag || "runtime_node_blocked",
    severity: node?.executionStatus === "failed" ? "high" : "medium",
    blocking: nodeIsBlockedOrFailed(node),
    summary,
    evidence: [
      node?.outputSummary,
      node?.executionStatus ? `executionStatus=${node.executionStatus}` : null,
      node?.reviewStatus ? `reviewStatus=${node.reviewStatus}` : null,
    ].filter(Boolean),
  }, node?.id);
}

function fixOptionsForIssue(issue) {
  const symbol = issue.affectedSymbols?.[0];

  if (issue.code === "missing_symbol" && symbol) {
    return [
      {
        id: `generate.${symbol}`,
        label: `Generate ${symbol}`,
        action: "generate_missing_symbol",
        recommended: true,
      },
      {
        id: `replace.${symbol}`,
        label: "Replace with existing utility",
        action: "replace_with_grounded_reference",
        recommended: false,
      },
      {
        id: `manual.${symbol}`,
        label: "Mark for manual implementation",
        action: "manual_intervention",
        recommended: false,
      },
    ];
  }

  if (issue.code === "invented_parameter") {
    return [
      {
        id: "ground.parameter",
        label: "Ground the parameter in repo context",
        action: "require_supporting_context",
        recommended: true,
      },
      {
        id: "manual.parameter",
        label: "Mark for manual review",
        action: "manual_intervention",
        recommended: false,
      },
    ];
  }

  if (issue.code === "runtime_connector_failure") {
    return [
      {
        id: "retry.semantic_admission",
        label: "Retry semantic admission",
        action: "retry_semantic_admission",
        recommended: true,
      },
      {
        id: "manual.runtime",
        label: "Inspect runtime connector",
        action: "manual_intervention",
        recommended: false,
      },
    ];
  }

  if (issue.code === "invalid_target_path") {
    return [
      {
        id: "restrict.target",
        label: "Restrict target to workspace",
        action: "tighten_path_policy",
        recommended: true,
      },
      {
        id: "manual.target",
        label: "Choose a different target",
        action: "manual_intervention",
        recommended: false,
      },
    ];
  }

  if (String(issue.code ?? "").startsWith("ct_")) {
    return [
      {
        id: `ct.review.${issue.code}`,
        label: "Regenerate with corrected CT review input",
        action: "regenerate_with_ct_review",
        recommended: true,
      },
      {
        id: "manual.ct_review",
        label: "Escalate CT finding for manual review",
        action: "manual_intervention",
        recommended: false,
      },
    ];
  }

  return [];
}

function collectInspectorIssues(inspectors) {
  const issues = [];

  for (const inspector of Object.values(inspectors)) {
    const nodeId = inspector?.node?.id;
    const node = inspector?.node;
    const rawIssues = [
      ...(Array.isArray(inspector?.issues) ? inspector.issues : []),
      ...(Array.isArray(inspector?.critique?.issues) ? inspector.critique.issues : []),
    ];

    for (const issue of rawIssues) {
      issues.push(normalizeIssue(issue, nodeId));
    }

    if (nodeIsBlockedOrFailed(node)) {
      const riskFlags = Array.isArray(node?.riskFlags) ? node.riskFlags : [];
      const runtimeRiskFlags = riskFlags.filter((riskFlag) =>
        ["runtime_connector_failure", "deterministic_execution_blocked"].includes(riskFlag),
      );
      let flags = runtimeRiskFlags;
      if (rawIssues.length === 0) {
        flags = riskFlags.length > 0 ? riskFlags : ["runtime_node_blocked"];
      }
      for (const riskFlag of flags) {
        issues.push(issueFromNodeRiskFlag(node, riskFlag));
      }
    }
  }

  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.summary}:${issue.affectedSymbols.join("|")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectSemanticCriticalReviewIssues(artifact) {
  const nodes = artifact?.plan?.nodes ?? [];
  const issues = [];

  for (const node of nodes.filter(isSemanticGenerationNode)) {
    if (!node?.admittedOutput?.ct_review_input) continue;
    const downstreamDeterministicNode = nodes.find(
      (candidate) => isDeterministicExecutionNode(candidate) && candidate.inputNodeId === node.id,
    );
    if (downstreamDeterministicNode) continue;

    const report = runCriticalReview({
      xplanNode: node,
      admittedOutput: node.admittedOutput,
      extractedClaims: node.admittedOutput.ct_review_input,
      intent: artifact.intent,
    });

    for (const issue of report.issues ?? []) {
      issues.push(normalizeIssue(issue, node.id));
    }
  }

  return issues;
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.summary}:${issue.affectedSymbols.join("|")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactFlowNode(node) {
  if (!node || typeof node !== "object") {
    return node;
  }

  const {
    hardValidationSchema,
    pathPolicies,
    admittedOutput,
    stateEffectPreview,
    ...compactNode
  } = node;

  if (admittedOutput) {
    compactNode.admittedOutputSummary = {
      summary: admittedOutput.summary ?? null,
      responseKind: admittedOutput.response_kind ?? null,
      hasResponse: typeof admittedOutput.response === "string" && admittedOutput.response.length > 0,
      changeCount: Array.isArray(admittedOutput.changes) ? admittedOutput.changes.length : 0,
      hasDiffPreview: typeof admittedOutput.diff_preview === "string" && admittedOutput.diff_preview.length > 0,
    };
  }

  if (stateEffectPreview) {
    compactNode.stateEffectPreview = compactStateEffect(stateEffectPreview);
  }

  return compactNode;
}

function compactRecord(record) {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) =>
      value !== undefined &&
      value !== null &&
      !(Array.isArray(value) && value.length === 0),
    ),
  );
}

function compactIssue(issue) {
  if (!issue || typeof issue !== "object") return issue;
  return compactRecord({
    code: issue.code ?? issue.type,
    type: issue.type,
    severity: issue.severity,
    blocking: Boolean(issue.blocking),
    summary: issue.summary ?? issue.message,
    detail: issue.detail,
    affectedSymbols: Array.isArray(issue.affectedSymbols) ? [...issue.affectedSymbols] : undefined,
    affectedFiles: Array.isArray(issue.affectedFiles) ? [...issue.affectedFiles] : undefined,
  });
}

function compactFlowIssue(issue) {
  return compactRecord({
    ...compactIssue(issue),
    evidence: Array.isArray(issue?.evidence) ? issue.evidence.slice(0, 6).map(compactEvidenceItem) : undefined,
    nodeId: issue?.nodeId,
    fixOptions: Array.isArray(issue?.fixOptions) ? issue.fixOptions : undefined,
  });
}

function compactEvidenceItem(item) {
  if (!item || typeof item !== "object") return item;
  return compactRecord({
    kind: item.kind,
    detail: item.detail ?? item.value ?? item.summary,
    path: item.path,
    symbol: item.symbol,
  });
}

function compactIntervention(intervention) {
  if (!intervention || typeof intervention !== "object") return intervention;
  return compactRecord({
    kind: intervention.kind,
    detail: intervention.detail ?? intervention.label,
    source: intervention.source,
  });
}

function compactStateEffect(effect) {
  if (!effect || typeof effect !== "object") return effect;
  return compactRecord({
    id: effect.id ?? null,
    kind: effect.kind ?? null,
    operation: effect.operation ?? null,
    target: effect.target ?? null,
    targets: Array.isArray(effect.targets) ? [...effect.targets] : undefined,
    summary: effect.summary ?? null,
    previewRef: effect.previewRef ?? null,
    policyState: effect.policyState ?? null,
    riskFlags: Array.isArray(effect.riskFlags) ? [...effect.riskFlags] : [],
  });
}

function compactOutputPreview(outputPreview) {
  if (!outputPreview || typeof outputPreview !== "object") return outputPreview;
  return {
    summary: outputPreview.summary ?? null,
    structuredData: Array.isArray(outputPreview.structuredData)
      ? outputPreview.structuredData.map(compactStateEffect)
      : [],
    previewRef: outputPreview.previewRef ?? null,
    diffPreview: typeof outputPreview.diffPreview === "string" && outputPreview.diffPreview.length <= 4000
      ? outputPreview.diffPreview
      : "",
    stateEffects: Array.isArray(outputPreview.stateEffects)
      ? outputPreview.stateEffects.map(compactStateEffect)
      : undefined,
  };
}

function compactCompiler(compiler) {
  if (!compiler || typeof compiler !== "object") return undefined;
  return {
    promptVersion: compiler.promptVersion ?? null,
    outputSchemaId: compiler.outputSchemaId ?? null,
  };
}

function compactCritique(critique) {
  if (!critique || typeof critique !== "object") return undefined;
  return compactRecord({
    summary: critique.summary,
    blocking: critique.blocking,
    riskFlags: Array.isArray(critique.riskFlags) ? [...critique.riskFlags] : [],
    issues: Array.isArray(critique.issues) ? critique.issues.map(compactIssue) : undefined,
    evidence: Array.isArray(critique.evidence) ? critique.evidence.slice(0, 10).map(compactEvidenceItem) : undefined,
    interventions: Array.isArray(critique.interventions) ? critique.interventions.slice(0, 10).map(compactIntervention) : undefined,
  });
}

function compactSemanticReview(review) {
  if (!review || typeof review !== "object") return undefined;
  return compactRecord({
    blocking: review.blocking,
    blockingReason: review.blockingReason,
    targetPath: review.targetPath,
    targetPaths: Array.isArray(review.targetPaths) ? [...review.targetPaths] : undefined,
    issues: Array.isArray(review.issues) ? review.issues.map(compactIssue) : undefined,
    evidence: Array.isArray(review.evidence) ? review.evidence.slice(0, 10).map(compactEvidenceItem) : undefined,
    interventions: Array.isArray(review.interventions) ? review.interventions.slice(0, 10).map(compactIntervention) : undefined,
  });
}

function compactFlowInspectors(inspectors) {
  return Object.fromEntries(
    Object.entries(inspectors).map(([nodeId, inspector]) => [
      nodeId,
      compactRecord({
        node: compactFlowNode(inspector?.node),
        overview: inspector?.overview,
        outputPreview: compactOutputPreview(inspector?.outputPreview),
        proposedChanges: Array.isArray(inspector?.proposedChanges)
          ? inspector.proposedChanges.map(compactStateEffect)
          : undefined,
        approvals: inspector?.approvals,
        issues: Array.isArray(inspector?.issues) ? inspector.issues.map(compactIssue) : undefined,
        compiler: compactCompiler(inspector?.compiler),
        runtimeSessions: Array.isArray(inspector?.runtimeSessions)
          ? inspector.runtimeSessions.map((session) => compactRecord({
              id: session?.id,
              runtimeId: session?.runtimeId,
              status: session?.status,
            }))
          : undefined,
      }),
    ]),
  );
}

function selectAdvancedNodeId(artifact) {
  const nodes = artifact?.plan?.nodes ?? [];
  return (
    nodes.find((node) => node.executionStatus === "failed")?.id ??
    nodes.find((node) => node.reviewStatus === "blocked")?.id ??
    getDeterministicNode(artifact)?.id ??
    getRuntimeNode(artifact)?.id ??
    nodes[0]?.id ??
    null
  );
}

async function loadInspectors(service, artifact) {
  const inspectors = {};

  await Promise.all(
    (artifact?.plan?.nodes ?? []).map(async (node) => {
      try {
        inspectors[node.id] = await service.getNodeInspectorPayload({
          runId: artifact.runId,
          nodeId: node.id,
        });
      } catch {
        inspectors[node.id] = {
          node,
        };
      }
    }),
  );

  return inspectors;
}

function buildPlanItems(artifact) {
  return (artifact?.plan?.nodes ?? [])
    .filter((node) => !isApprovalNode(node))
    .map((node, index) => ({
      id: node.id,
      index: index + 1,
      title: node.title,
      nodeType: node.nodeType,
      status: node.executionStatus,
      reviewStatus: node.reviewStatus,
      summary: node.outputSummary ?? node.inputSummary ?? "",
      confidenceScore: node.confidenceScore,
      riskFlags: [...(node.riskFlags ?? [])],
    }));
}

function buildGraph(artifact) {
  return {
    nodes: (artifact?.plan?.nodes ?? []).map((node) => ({
      id: node.id,
      title: node.title,
      nodeType: node.nodeType,
      reviewStatus: node.reviewStatus,
      executionStatus: node.executionStatus,
      dependsOn: [...(node.dependsOn ?? [])],
      approvalRequired: Boolean(node.approvalRequired),
      confidenceScore: node.confidenceScore,
      runtimeBinding: node.runtimeBinding ?? null,
    })),
    edges: artifact?.plan?.edges ?? [],
  };
}

function buildExecutionProgress(artifact, { issues = [], approval } = {}) {
  const semanticNode = getRuntimeNode(artifact);
  const deterministicNode = getDeterministicNode(artifact);
  const semanticDone = semanticNode?.executionStatus === "succeeded";
  const hasBlockingIssues = issues.some((issue) => issue.blocking);
  const hasStateEffects = materialStateEffects(artifact).length > 0;
  const validationDone =
    (artifact?.plan?.status === "completed" && !hasBlockingIssues) ||
    Boolean(approval?.approved) ||
    Boolean(approval?.ready) ||
    (semanticDone && !hasBlockingIssues && (hasStateEffects || !deterministicNode));
  const deterministicRunning = deterministicNode?.executionStatus === "running";

  const labels = [
    {
      id: "plan",
      label: "Plan",
      done: Boolean(artifact?.plan?.nodes?.length),
    },
    {
      id: "semantic",
      label: deterministicNode ? "Proposal" : "Response",
      done: semanticDone,
    },
    {
      id: "validate",
      label: "Validate",
      done: validationDone,
    },
  ];

  if (deterministicNode) {
    labels.push({
      id: "execute",
      label: "Execute",
      done: artifact?.plan?.status === "completed" && !hasBlockingIssues,
      current: deterministicRunning,
    });
  }

  const current = labels.find((entry) => entry.current) ?? labels.find((entry) => !entry.done);
  return labels.map((entry) => ({
    ...entry,
    current: current?.id === entry.id,
  }));
}

function resolvePhase({ artifact, issues, approval }) {
  const deterministicNode = getDeterministicNode(artifact);

  if (artifact?.plan?.status === "failed") {
    return "failed";
  }

  if (issues.some((issue) => issue.blocking)) {
    return "needs_intervention";
  }

  if (artifact?.plan?.status === "completed") {
    return "completed";
  }

  if (approval.ready) {
    return "awaiting_approval";
  }

  if (deterministicNode?.executionStatus === "running") {
    return "executing";
  }

  return "reviewing";
}

function buildFlowSteps({ artifact, issues, approval }) {
  const runtimeNode = getRuntimeNode(artifact);
  const deterministicNode = getDeterministicNode(artifact);
  const hasPlan = (artifact?.plan?.nodes ?? []).length > 0;
  const hasIssues = issues.length > 0;
  const hasBlockingIssues = issues.some((issue) => issue.blocking);
  const completed = artifact?.plan?.status === "completed" && !hasBlockingIssues;
  const semanticDone = runtimeNode?.executionStatus === "succeeded";
  const semanticFinished = semanticDone || runtimeNode?.executionStatus === "failed" || hasIssues || completed;
  const reEvaluated = Number(artifact?.planVersion ?? 1) > 1 || Number(runtimeNode?.revision ?? 1) > 1;
  const deterministicRunning = deterministicNode?.executionStatus === "running";
  const steps = [
    { id: 1, label: "Input", status: "complete" },
    { id: 2, label: "Classification", status: "complete" },
    { id: 3, label: deterministicNode ? "Review Plan" : "Semantic Response", status: hasPlan ? "complete" : "pending" },
    {
      id: 4,
      label: "Issue Detection",
      status: hasIssues ? (hasBlockingIssues ? "blocked" : "warning") : semanticFinished ? "complete" : "pending",
    },
    { id: 5, label: "Effort Indicator", status: "complete" },
    { id: 6, label: "Why? Explanation", status: hasIssues || hasPlan ? "available" : "pending" },
    { id: 9, label: "Advanced View", status: semanticFinished ? "available" : "pending" },
  ];

  if (hasIssues || hasBlockingIssues || reEvaluated) {
    steps.push(
      {
        id: 7,
        label: "Fix Issues",
        status: hasBlockingIssues ? "required" : hasIssues ? "optional" : "not_required",
      },
      {
        id: 8,
        label: "Re-evaluation",
        status:
          hasBlockingIssues
            ? "blocked"
            : reEvaluated && semanticFinished && !hasIssues
              ? "complete"
              : "pending",
      },
    );
  }

  if (approval.required) {
    steps.push({
      id: 10,
      label: "Approval",
      status: approval.approved || completed ? "complete" : approval.ready ? "ready" : "pending",
    });
  }

  if (deterministicNode) {
    steps.push({
      id: 11,
      label: "Execution",
      status:
        completed
          ? "complete"
          : deterministicRunning
            ? "running"
            : "pending",
    });
  }

  steps.push({ id: 12, label: "Result", status: completed ? "complete" : "pending" });
  return steps.sort((left, right) => left.id - right.id);
}

function buildApproval(artifact, issues) {
  const runtimeNode = getRuntimeNode(artifact);
  const deterministicNode = getDeterministicNode(artifact);
  const gate = deterministicNode ? getApprovalGate(artifact, deterministicNode.id) : null;
  const checkpoint = getLatestAvailableCheckpoint(artifact);
  const hasBlockingIssues = issues.some((issue) => issue.blocking);
  const semanticAdmissionReady = runtimeNode?.executionStatus === "succeeded";
  const previewReady = materialStateEffects(artifact).length > 0;

  return {
    required: Boolean(gate?.required),
    ready: Boolean(
      gate?.required &&
        gate.status === "pending" &&
        semanticAdmissionReady &&
        previewReady &&
        !hasBlockingIssues,
    ),
    approved: gate?.status === "approved",
    blocked: hasBlockingIssues,
    gateId: gate?.id ?? null,
    nodeId: deterministicNode?.id ?? null,
    nodeRevision: deterministicNode?.revision ?? null,
    checkpointId: checkpoint?.id ?? null,
    reason: gate?.reason ?? null,
    status: gate?.status ?? "none",
  };
}

function buildResult(artifact, { issues = [] } = {}) {
  const completed = artifact?.plan?.status === "completed" && !issues.some((issue) => issue.blocking);
  const effects = materialStateEffects(artifact);
  const filesUpdated = completed ? unique(effects.flatMap(stateEffectTargets)) : [];
  const outputs = (artifact?.plan?.nodes ?? [])
    .filter((node) => isSemanticGenerationNode(node) && node.executionStatus === "succeeded" && node.admittedOutput)
    .map((node) => compactRecord({
      nodeId: node.id,
      kind: node.admittedOutput?.response ? "semantic_output" : "semantic_proposal",
      summary: node.outputSummary ?? node.admittedOutput?.summary ?? null,
      response: node.admittedOutput?.response ?? null,
      responseKind: node.admittedOutput?.response_kind ?? null,
    }));

  return {
    completed,
    filesUpdated,
    outputs,
    stateEffects: effects.map((effect) => ({
      id: effect.id,
      kind: effect.kind,
      operation: effect.operation,
      target: effect.target,
      targets: stateEffectTargets(effect),
      summary: effect.summary,
      policyState: effect.policyState,
      riskFlags: [...(effect.riskFlags ?? [])],
      previewRef: effect.previewRef ?? null,
    })),
  };
}

function buildAnalysis({ artifact, classification, issues, approval, result }) {
  const nodes = artifact?.plan?.nodes ?? [];
  const failedNode = nodes.find((node) => node.executionStatus === "failed") ?? null;
  const blockedIssues = issues.filter((issue) => issue.blocking);
  const effects = materialStateEffects(artifact);
  const checkpoints = artifact?.plan?.checkpoints ?? [];
  const evidence = unique([
    failedNode?.outputSummary,
    ...issues.flatMap((issue) => issue.evidence ?? []),
    ...nodes
      .filter((node) => node.outputSummary)
      .map((node) => `${node.title}: ${node.outputSummary}`),
  ]);

  let summary = "Backend analysis has not emitted a specific finding yet.";
  if (failedNode) {
    summary = `Runtime failed before admission on ${failedNode.id}: ${failedNode.outputSummary ?? "no runtime summary recorded"}`;
  } else if (blockedIssues.length > 0) {
    summary = `${blockedIssues.length} blocking issue${blockedIssues.length === 1 ? "" : "s"} prevent execution.`;
  } else if (approval.ready) {
    summary = "Semantic admission produced material state effects and the artifact is ready for fresh approval.";
  } else if (result.completed) {
    if (result.outputs?.length > 0 && result.stateEffects.length === 0) {
      summary = `Semantic response completed with ${result.outputs.length} admitted output${result.outputs.length === 1 ? "" : "s"}.`;
    } else {
      summary = `Execution completed with ${result.stateEffects.length} material state effect${result.stateEffects.length === 1 ? "" : "s"}.`;
    }
  } else if (effects.length > 0) {
    summary = `${effects.length} material state effect${effects.length === 1 ? "" : "s"} await review.`;
  }

  return {
    summary,
    evidence,
    metrics: {
      nodeCount: nodes.length,
      issueCount: issues.length,
      blockingIssueCount: blockedIssues.length,
      materialStateEffectCount: effects.length,
      checkpointCount: checkpoints.length,
      confidenceScore: classification?.confidenceScore ?? null,
      confidenceBand: classification?.confidenceBand ?? null,
    },
  };
}

function buildRecommendations({ issues, approval, result }) {
  const issueRecommendations = issues.flatMap((issue) =>
    fixOptionsForIssue(issue)
      .filter((option) => option.recommended)
      .map((option) => ({
        id: option.id,
        label: option.label,
        action: option.action,
        source: issue.code,
        nodeId: issue.nodeId,
        reason: issue.summary,
      })),
  );

  if (issueRecommendations.length > 0) {
    return issueRecommendations;
  }

  if (approval.ready) {
    return [{
      id: "approval.record_fresh",
      label: "Record fresh approval",
      action: "approve",
      source: "approval_gate",
      nodeId: approval.nodeId,
      reason: approval.reason,
    }];
  }

  if (result.completed) {
    if (result.outputs?.length > 0 && result.filesUpdated.length === 0) {
      return [{
        id: "result.semantic_output",
        label: "Review admitted response",
        action: "inspect_result",
        source: "result",
        nodeId: result.outputs[0]?.nodeId ?? null,
        reason: `${result.outputs.length} semantic output${result.outputs.length === 1 ? "" : "s"} admitted.`,
      }];
    }

    return [{
      id: "result.audit",
      label: "Review audit trail",
      action: "inspect_audit",
      source: "result",
      nodeId: null,
      reason: `${result.filesUpdated.length} file${result.filesUpdated.length === 1 ? "" : "s"} updated.`,
    }];
  }

  return [];
}

export async function buildCodexSemantixFlowProjection({
  service,
  artifact,
  classification,
} = {}) {
  if (!service) {
    throw new Error("buildCodexSemantixFlowProjection requires a service.");
  }

  if (!artifact) {
    throw new Error("buildCodexSemantixFlowProjection requires an artifact.");
  }

  const inspectors = await loadInspectors(service, artifact);
  const issues = dedupeIssues([
    ...collectInspectorIssues(inspectors),
    ...collectSemanticCriticalReviewIssues(artifact),
  ]);
  const approval = buildApproval(artifact, issues);
  const result = buildResult(artifact, { issues });
  const phase = resolvePhase({
    artifact,
    issues,
    approval,
  });
  const effectiveClassification =
    classification ??
    artifact.classification ??
    classifyCodexRequest({
      primaryDirective: artifact.intent?.primaryDirective,
      strictBoundaries: artifact.intent?.strictBoundaries,
      successState: artifact.intent?.successState,
    });
  const projectedClassification = {
    ...effectiveClassification,
    signals: {
      ...(effectiveClassification.signals ?? {}),
      semanticContradictionSignals: issues.filter((issue) => issue.code === "ct_reasoning_contradiction").length,
    },
  };
  const issuesWithFixOptions = issues.map((issue) => ({
    ...issue,
    fixOptions: fixOptionsForIssue(issue),
  })).map(compactFlowIssue);
  const analysis = buildAnalysis({
    artifact,
    classification: projectedClassification,
    issues,
    approval,
    result,
  });
  const recommendations = buildRecommendations({
    issues,
    approval,
    result,
  });

  return {
    runId: artifact.runId,
    phase,
    artifact: {
      artifactId: artifact.artifactId,
      planVersion: artifact.planVersion,
      graphVersion: artifact.graphVersion,
      artifactHash: artifact.artifactHash,
      freshnessState: artifact.freshnessState,
      generatedAt: artifact.generatedAt,
    },
    input: {
      primaryDirective: artifact.intent?.primaryDirective ?? "",
      strictBoundaries: [...(artifact.intent?.strictBoundaries ?? [])],
      successState: artifact.intent?.successState ?? "",
    },
    classification: projectedClassification,
    plan: {
      status: artifact.plan?.status,
      items: buildPlanItems(artifact),
    },
    issues: issuesWithFixOptions,
    analysis,
    recommendations,
    approval,
    advanced: {
      graph: buildGraph(artifact),
      selectedNodeId: selectAdvancedNodeId(artifact),
      inspectors: compactFlowInspectors(inspectors),
    },
    execution: {
      status: getDeterministicNode(artifact)?.executionStatus ?? getRuntimeNode(artifact)?.executionStatus ?? "not_started",
      progress: buildExecutionProgress(artifact, { issues, approval }),
    },
    result,
    steps: buildFlowSteps({
      artifact,
      issues,
      approval,
    }),
  };
}

function defaultSuccessState(primaryDirective) {
  const task = compactText(primaryDirective) || "the requested change";
  return `Preview, validate, and apply ${task} only after Semantix approval gates pass.`;
}

function defaultSemanticResponseSuccessState(primaryDirective) {
  const task = compactText(primaryDirective) || "the requested response";
  return `Compile a Semantix-reviewed semantic response for: ${task}`;
}

function normalizeSuccessStateForClassification({ primaryDirective, successState, classification }) {
  const successStateText = compactText(successState);
  if (shouldUseSemanticResponseBlueprint(classification)) {
    if (!successStateText || /\breview artifact\b|\bfile updated\b|\bexecution step\b|\bapply\b/.test(successStateText.toLowerCase())) {
      return defaultSemanticResponseSuccessState(primaryDirective);
    }
    return successStateText;
  }

  return successStateText || defaultSuccessState(primaryDirective);
}

function shouldUseSemanticResponseBlueprint(classification) {
  return (
    classification?.outputKind === "semantic_response" &&
    classification?.signals?.requiresFileChanges !== true
  );
}

function buildSemanticResponseBlueprint({
  primaryDirective,
  strictBoundaries = [],
  successState,
} = {}) {
  return {
    intent_contract: {
      primary_directive: primaryDirective,
      strict_boundaries: [...strictBoundaries],
      success_state: successState,
    },
    semantic_frames: [
      {
        frame_id: "frame.semantic.respond",
        node_id: "node.semantic.respond",
        prompt: primaryDirective,
        context: {
          workflow: "semantic_response",
          success_state: successState,
          strict_boundaries: [...strictBoundaries],
          review_expectations: [
            "Return a user-visible semantic response, not a repo code-change proposal.",
            "Do not include workspace_path, diff_preview, changes, target files, or file operations.",
            "Put the final user-visible answer in response.",
            "Preserve prompt-level tensions in ct_review_input instead of pretending they are file or repo issues.",
            "Provide ct_review_input with reasoning_chain, plan_steps, assumptions, numeric_claims, and concurrency so deterministic CT-MCP review can run before the response is admitted.",
          ],
        },
        hard_constraints: [],
      },
    ],
    execution_graph: {
      nodes: [
        {
          node_id: "node.semantic.respond",
          kind: "semantic_generation",
          title: "Compile Semantic Response",
          depends_on: [],
          frame_id: "frame.semantic.respond",
          base_validation_schema: createDefaultSemanticResponseSchema(),
        },
      ],
    },
  };
}

function resolveArtifactIdentity(flowOrArtifact) {
  if (!flowOrArtifact) {
    return {};
  }

  if (flowOrArtifact.artifact?.artifactHash) {
    return {
      planVersion: flowOrArtifact.artifact.planVersion,
      graphVersion: flowOrArtifact.artifact.graphVersion,
      artifactHash: flowOrArtifact.artifact.artifactHash,
    };
  }

  return {
    planVersion: flowOrArtifact.planVersion,
    graphVersion: flowOrArtifact.graphVersion,
    artifactHash: flowOrArtifact.artifactHash,
  };
}

function normalizeFixMetadata(metadata = {}) {
  return {
    issueCode: compactText(metadata.issueCode ?? metadata.issue_code ?? metadata.code),
    issueId: compactText(metadata.issueId ?? metadata.issue_id),
    symbol: compactText(metadata.symbol ?? metadata.affectedSymbol ?? metadata.affected_symbol),
    action: compactText(metadata.action ?? metadata.fixAction ?? metadata.fix_action),
    fixOptionId: compactText(metadata.fixOptionId ?? metadata.fix_option_id ?? metadata.fixId ?? metadata.fix_id),
    note: compactText(metadata.note ?? metadata.reason ?? metadata.summary),
  };
}

function selectIssueForFix(issues, metadata) {
  const blockingIssues = issues.filter((issue) => issue.blocking);
  const candidates = blockingIssues.length > 0 ? blockingIssues : issues;

  return (
    candidates.find((issue) => {
      if (metadata.issueId && issue.raw?.id !== metadata.issueId && issue.id !== metadata.issueId) {
        return false;
      }

      if (metadata.issueCode && issue.code !== metadata.issueCode) {
        return false;
      }

      if (metadata.symbol && !issue.affectedSymbols.includes(metadata.symbol)) {
        return false;
      }

      return true;
    }) ??
    candidates.find((issue) => (metadata.issueCode ? issue.code === metadata.issueCode : true)) ??
    candidates[0] ??
    null
  );
}

function selectFixOption(issue, metadata) {
  const options = issue?.fixOptions ?? [];

  return (
    options.find((option) => metadata.fixOptionId && option.id === metadata.fixOptionId) ??
    options.find((option) => metadata.action && option.action === metadata.action) ??
    options.find((option) => option.recommended) ??
    options[0] ??
    null
  );
}

function formatSelectedFix({ issue, fixOption, metadata }) {
  const symbol = metadata.symbol || issue?.affectedSymbols?.[0] || "";
  const action = metadata.action || fixOption?.action || "regenerate_with_constraints";
  const label = fixOption?.label || action.replaceAll("_", " ");
  const subject = issue
    ? `${issue.code}${symbol ? ` for '${symbol}'` : ""}`
    : symbol
      ? `issue for '${symbol}'`
      : "the selected issue";

  return {
    action,
    label,
    symbol,
    summary: `Apply '${label}' to resolve ${subject}.`,
  };
}

function buildFixConstraint({ issue, selectedFix, metadata }) {
  const symbol = selectedFix.symbol;
  const issueSummary = issue?.summary ?? metadata.note ?? "Semantix review requested regeneration.";
  const symbolInstruction = symbol
    ? ` Resolve symbol '${symbol}' by generating it in the proposal or replacing it with an existing grounded repo symbol.`
    : "";

  return [
    `Semantix fix selected: ${selectedFix.action}. ${issueSummary}${symbolInstruction}`,
    "Regenerate the semantic output so every referenced file, symbol, and parameter is grounded in repo context or explicitly created by the proposed change.",
    "Do not repeat the blocked proposal unless the selected fix is fully reflected in the admitted semantic output.",
  ].join(" ");
}

export class CodexSemantixLayer {
  constructor({
    service,
    defaultCwd,
    defaultActor = "operator",
    classifier,
  } = {}) {
    if (!service) {
      throw new Error("CodexSemantixLayer requires a ControlPlaneService.");
    }

    this.service = service;
    this.defaultCwd = defaultCwd;
    this.defaultActor = defaultActor;
    this.classifier = classifier;
  }

  classify(input) {
    return classifyCodexRequest(input);
  }

  async classifyAsync(input) {
    if (typeof this.classifier === "function") {
      return this.classifier(input);
    }

    return this.classify(input);
  }

  async start({
    runId = `run-${randomUUID()}`,
    actor = this.defaultActor,
    primaryDirective,
    strictBoundaries = [],
    successState,
    cwd = this.defaultCwd,
    autoExecuteSemanticAdmission = true,
  } = {}) {
    const directiveText = String(primaryDirective ?? "").trim();
    const successStateText = String(successState ?? "").trim();

    if (!directiveText) {
      throw new Error("CodexSemantixLayer.start requires primaryDirective.");
    }

    const classification = await this.classifyAsync({
      primaryDirective,
      strictBoundaries,
      successState,
    });
    const effectiveSuccessState = normalizeSuccessStateForClassification({
      primaryDirective,
      successState: successStateText,
      classification,
    });
    const blueprint = shouldUseSemanticResponseBlueprint(classification)
      ? buildSemanticResponseBlueprint({
          primaryDirective: directiveText,
          strictBoundaries: Array.isArray(strictBoundaries) ? strictBoundaries : [],
          successState: effectiveSuccessState,
        })
      : undefined;

    const artifact = await this.service.bootstrapRun({
      runId,
      actor,
      primaryDirective: directiveText,
      strictBoundaries: Array.isArray(strictBoundaries) ? strictBoundaries : [],
      successState: effectiveSuccessState,
      blueprint,
      classification,
      cwd,
      autoExecuteSemanticAdmission,
    });

    return buildCodexSemantixFlowProjection({
      service: this.service,
      artifact,
      classification,
    });
  }

  async getFlow({ runId } = {}) {
    if (!compactText(runId)) {
      throw new Error("CodexSemantixLayer.getFlow requires runId.");
    }

    const artifact = await this.service.getCurrentArtifact(runId);
    return buildCodexSemantixFlowProjection({
      service: this.service,
      artifact,
    });
  }

  async applyFix({
    runId,
    actor = this.defaultActor,
    issueCode,
    issueId,
    symbol,
    action,
    fixOptionId,
    note,
  } = {}) {
    if (!compactText(runId)) {
      throw new Error("CodexSemantixLayer.applyFix requires runId.");
    }

    const currentArtifact = await this.service.getCurrentArtifact(runId);
    const semanticNode = getRuntimeNode(currentArtifact);
    if (!semanticNode) {
      throw new Error(`Run "${runId}" does not contain a semantic generation node.`);
    }

    const currentFlow = await buildCodexSemantixFlowProjection({
      service: this.service,
      artifact: currentArtifact,
    });
    const metadata = normalizeFixMetadata({
      issueCode,
      issueId,
      symbol,
      action,
      fixOptionId,
      note,
    });
    const issue = selectIssueForFix(currentFlow.issues, metadata);
    const fixOption = selectFixOption(issue, metadata);
    const selectedFix = formatSelectedFix({
      issue,
      fixOption,
      metadata,
    });
    const hardConstraints = [...(semanticNode.constraints?.hard ?? [])];
    const softConstraints = [...(semanticNode.constraints?.soft ?? [])];
    const fixConstraint = buildFixConstraint({
      issue,
      selectedFix,
      metadata,
    });
    const identity = resolveArtifactIdentity(currentArtifact);

    await this.service.submitIntervention({
      runId,
      actor,
      nodeId: semanticNode.id,
      nodeRevision: semanticNode.revision,
      planVersion: identity.planVersion,
      graphVersion: identity.graphVersion,
      artifactHash: identity.artifactHash,
      changes: {
        inputSummary: `Re-evaluate semantic output after fix: ${selectedFix.summary}`,
        outputSummary: "Awaiting fixed semantic admission.",
        contextPatch: {
          selectedFix: {
            issueCode: (issue?.code ?? metadata.issueCode) || null,
            issueSummary: (issue?.summary ?? metadata.note) || null,
            action: selectedFix.action,
            label: selectedFix.label,
            symbol: selectedFix.symbol || null,
          },
        },
        constraintPatch: {
          hard: unique([...hardConstraints, fixConstraint]),
          soft: unique([
            ...softConstraints,
            "Prefer the smallest grounded proposal that resolves the selected Semantix issue.",
          ]),
          reviewerNote: selectedFix.summary,
        },
      },
    });

    const refreshedArtifact = await this.service.executeApprovedNodes({
      runId,
      actor,
    });

    return buildCodexSemantixFlowProjection({
      service: this.service,
      artifact: refreshedArtifact,
    });
  }

  async approveAndRun({
    runId,
    actor = this.defaultActor,
    gateId,
    nodeId,
    nodeRevision,
    checkpointId,
    reason = "Approved from Codex Semantix facade.",
    planVersion,
    graphVersion,
    artifactHash,
  } = {}) {
    if (!compactText(runId)) {
      throw new Error("CodexSemantixLayer.approveAndRun requires runId.");
    }

    const currentArtifact = await this.service.getCurrentArtifact(runId);
    const deterministicNode = getDeterministicNode(currentArtifact);
    const gate = getApprovalGate(currentArtifact, nodeId ?? deterministicNode?.id);
    const checkpoint = checkpointId
      ? currentArtifact.plan.checkpoints.find((entry) => entry.id === checkpointId)
      : getLatestAvailableCheckpoint(currentArtifact);
    const identity = resolveArtifactIdentity(currentArtifact);

    const targetNodeId = nodeId ?? deterministicNode?.id;
    const targetNodeRevision = nodeRevision ?? deterministicNode?.revision;
    const targetGateId = gateId ?? gate?.id;

    if (!targetNodeId || !targetGateId || !checkpoint) {
      throw new Error("No approval-ready Codex Semantix checkpoint is available for this run.");
    }

    await this.service.submitApprovalAction({
      runId,
      actor,
      action: "approve",
      planVersion: planVersion ?? identity.planVersion,
      graphVersion: graphVersion ?? identity.graphVersion,
      artifactHash: artifactHash ?? identity.artifactHash,
      gateId: targetGateId,
      nodeId: targetNodeId,
      nodeRevision: targetNodeRevision,
      reason,
    });

    const completedArtifact = await this.service.resumeFromCheckpoint({
      runId,
      actor,
      checkpointId: checkpoint?.id,
      planVersion: planVersion ?? identity.planVersion,
      artifactHash: artifactHash ?? identity.artifactHash,
      nodeId: targetNodeId,
      nodeRevision: targetNodeRevision,
    });

    return buildCodexSemantixFlowProjection({
      service: this.service,
      artifact: completedArtifact,
    });
  }
}

export function createCodexSemantixLayer(options = {}) {
  return new CodexSemantixLayer(options);
}
