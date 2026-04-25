const {
  useState,
  useEffect,
  useMemo,
  useRef,
} = React;

const DEFAULT_HOST_TARGET_SYMBOL = "semantix.host.apply_admitted_semantic";

const THEMES = {
  light: {
    bg: "#f5f1e8",
    panel: "#fffdf9",
    panelAlt: "#f1ece3",
    border: "#ddd4c7",
    borderStrong: "#c8bcac",
    text: "#201c16",
    textDim: "#64594d",
    textFaint: "#8d8273",
    accent: "#2d6a4f",
    accentSoft: "#e6f0ea",
    accentText: "#1f4d39",
    green: "#2d6a4f",
    greenSoft: "#e7f3ec",
    yellow: "#b8791f",
    yellowSoft: "#fbf2df",
    orange: "#c76b1c",
    orangeSoft: "#f8eadc",
    red: "#a8413a",
    redSoft: "#f8e9e6",
    info: "#3a5f7f",
    infoSoft: "#e7eef4",
    shadow: "0 1px 2px rgba(32,28,22,.05), 0 1px 1px rgba(32,28,22,.03)",
    shadowLg: "0 10px 32px rgba(32,28,22,.08), 0 2px 6px rgba(32,28,22,.04)",
  },
  dark: {
    bg: "#14110e",
    panel: "#1b1713",
    panelAlt: "#26211b",
    border: "#363028",
    borderStrong: "#4a4238",
    text: "#efe7da",
    textDim: "#b0a493",
    textFaint: "#7c7162",
    accent: "#4fb37f",
    accentSoft: "#173125",
    accentText: "#9ce1bf",
    green: "#58cb90",
    greenSoft: "#173125",
    yellow: "#dbb251",
    yellowSoft: "#3c2d10",
    orange: "#eb9050",
    orangeSoft: "#422315",
    red: "#ef857d",
    redSoft: "#421917",
    info: "#7dafd4",
    infoSoft: "#162634",
    shadow: "0 2px 8px rgba(0,0,0,.32)",
    shadowLg: "0 14px 36px rgba(0,0,0,.42)",
  },
};

function deepClone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function asArray(value) {
  if (Array.isArray(value)) return value.filter((entry) => entry != null && entry !== "");
  if (value == null || value === "") return [];
  return [value];
}

function firstMeaningfulString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
  }
  return "";
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  return items.filter((item, index) => {
    const key = getKey(item, index);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeAffectedItem(entry, index = 0) {
  if (typeof entry === "string") {
    const label = entry.trim();
    return label ? { key: `scope:${label}`, label, detail: "", kind: "" } : null;
  }
  if (!entry || typeof entry !== "object") return null;

  const label = firstMeaningfulString(
    entry.label,
    entry.target,
    entry.path,
    entry.file,
    entry.filePath,
    entry.symbol,
    Array.isArray(entry.symbolPath) ? entry.symbolPath.join(".") : "",
    entry.name,
    entry.id,
  );
  const detail = firstMeaningfulString(
    entry.detail,
    entry.description,
    entry.summary,
    entry.reason,
    entry.location,
    entry.line != null ? `line ${entry.line}` : "",
  );
  const kind = firstMeaningfulString(entry.kind, entry.type, entry.scope);
  if (!label && !detail) return null;
  return {
    key: `scope:${label || detail}:${index}`,
    label: label || detail,
    detail: label && detail ? detail : "",
    kind,
  };
}

function normalizeEvidenceItem(entry, index = 0) {
  if (typeof entry === "string") {
    const summary = entry.trim();
    return summary ? { key: `evidence:${summary}`, summary, detail: "", source: "", locator: "" } : null;
  }
  if (!entry || typeof entry !== "object") return null;

  const summary = firstMeaningfulString(
    entry.summary,
    entry.message,
    entry.observation,
    entry.finding,
    entry.quote,
    entry.text,
    entry.label,
    entry.reason,
    entry.claim,
  );
  const detail = firstMeaningfulString(entry.detail, entry.description, entry.context, entry.excerpt);
  const source = firstMeaningfulString(entry.source, entry.origin, entry.title, entry.kind, entry.type);
  const locator = firstMeaningfulString(
    entry.path,
    entry.file,
    entry.filePath,
    entry.symbol,
    Array.isArray(entry.symbolPath) ? entry.symbolPath.join(".") : "",
    entry.previewRef,
    entry.line != null ? `line ${entry.line}` : "",
  );
  if (!summary && !detail && !source && !locator) return null;
  return {
    key: `evidence:${summary || detail || source || locator}:${index}`,
    summary: summary || detail || source || locator,
    detail: summary && detail ? detail : "",
    source,
    locator,
  };
}

function normalizeInterventionItem(entry, index = 0) {
  if (typeof entry === "string") {
    const label = entry.trim();
    return label ? { key: `intervention:${label}`, label, detail: "", kind: "" } : null;
  }
  if (!entry || typeof entry !== "object") return null;

  const label = firstMeaningfulString(entry.label, entry.title, entry.action, entry.name, entry.kind, entry.id);
  const detail = firstMeaningfulString(entry.detail, entry.description, entry.reason, entry.summary);
  const kind = firstMeaningfulString(entry.kind, entry.actionId, entry.id);
  if (!label && !detail) return null;
  return {
    key: `intervention:${label || detail}:${index}`,
    label: label || detail,
    detail: label && detail ? detail : "",
    kind,
  };
}

function normalizeReviewIssue(entry, index = 0) {
  if (typeof entry === "string") {
    const summary = entry.trim();
    if (!summary) return null;
    return {
      key: `issue:${summary}`,
      title: summary,
      summary: "",
      severity: "",
      kind: "",
      assumption: "",
      evidence: [],
      affected: [],
      interventions: [],
    };
  }
  if (!entry || typeof entry !== "object") return null;

  const title = firstMeaningfulString(
    entry.title,
    entry.issue,
    entry.label,
    entry.name,
    entry.assumption,
    entry.badAssumption,
    entry.claim,
  );
  const summary = firstMeaningfulString(
    entry.summary,
    entry.message,
    entry.description,
    entry.detail,
    entry.reason,
    entry.exactIssue,
  );
  const severity = firstMeaningfulString(entry.severity, entry.status, entry.disposition, entry.confidenceBand);
  const kind = firstMeaningfulString(entry.kind, entry.type, entry.category, entry.classification);
  const assumption = firstMeaningfulString(entry.assumption, entry.badAssumption, entry.claim, entry.hypothesis);
  const evidence = uniqueBy(
    [
      ...asArray(entry.evidence),
      ...asArray(entry.evidenceItems),
      ...asArray(entry.findings),
      ...asArray(entry.observations),
      ...asArray(entry.signals),
      ...asArray(entry.support),
      ...asArray(entry.riskFlags),
    ]
      .map((item, itemIndex) => normalizeEvidenceItem(item, itemIndex))
      .filter(Boolean),
    (item) => item.key,
  );
  const affected = uniqueBy(
    [
      ...asArray(entry.affected),
      ...asArray(entry.targets),
      ...asArray(entry.scope),
      ...asArray(entry.files),
      ...asArray(entry.affectedFiles),
      ...asArray(entry.symbols),
      ...asArray(entry.affectedSymbols),
    ]
      .map((item, itemIndex) => normalizeAffectedItem(item, itemIndex))
      .filter(Boolean),
    (item) => item.key,
  );
  const interventions = uniqueBy(
    [
      ...asArray(entry.interventions),
      ...asArray(entry.suggestedInterventions),
      ...asArray(entry.suggestions),
      ...asArray(entry.actions),
      ...asArray(entry.nextActions),
      ...asArray(entry.remediations),
      ...asArray(entry.suggestion),
    ]
      .map((item, itemIndex) => normalizeInterventionItem(item, itemIndex))
      .filter(Boolean),
    (item) => item.key,
  );

  if (!title && !summary && evidence.length === 0 && affected.length === 0 && interventions.length === 0) {
    return null;
  }

  return {
    key: `issue:${title || summary || assumption || index}`,
    title: title || summary || assumption || "Flagged issue",
    summary: title && summary ? summary : "",
    severity,
    kind,
    assumption,
    evidence,
    affected,
    interventions,
  };
}

function getScenarioRecordByKey(key) {
  return window.SEMANTIX_SCENARIOS?.[key] || null;
}

const DEFAULT_SUCCESS_SUMMARY = "Compile a fresh review artifact and wait for explicit approval before execution.";
const DEFAULT_BOUNDARIES = [
  "Keep the backend authoritative for artifact freshness.",
  "Require fresh approval before any execution step becomes real.",
  "Do not exceed the user-stated scope.",
];

function cloneScenarioRecord(key) {
  const source = getScenarioRecordByKey(key);
  const scenario = source ? deepClone(source) : null;
  return scenario || null;
}

function getApiBase() {
  const configured = window.SEMANTIX_API_BASE;
  if (typeof configured === "string") {
    return configured.replace(/\/$/, "");
  }
  return "";
}

function buildRunApiUrl(runId, path) {
  const safePath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBase()}/runs/${encodeURIComponent(runId)}${safePath}`;
}

function buildPreviewApiUrl(runId, previewRef) {
  const url = new URL(buildRunApiUrl(runId, "/previews"), window.location.origin);
  url.searchParams.set("previewRef", previewRef);
  return url.toString();
}

function createBrowserRunId() {
  const entropy = Math.random().toString(36).slice(2, 8);
  return `browser-${Date.now().toString(36)}-${entropy}`;
}

function readRunIdFromLocation() {
  const params = new URLSearchParams(window.location.search);
  return params.get("run") || params.get("runId") || "";
}

function writeRunIdToLocation(runId) {
  const url = new URL(window.location.href);
  url.searchParams.set("run", runId);
  window.history.replaceState({}, "", url.toString());
}

function ensureRunId(runId, { reuseLocation = true } = {}) {
  const locationRunId = reuseLocation ? readRunIdFromLocation() : "";
  const resolved = runId || locationRunId || createBrowserRunId();
  if (readRunIdFromLocation() !== resolved) {
    writeRunIdToLocation(resolved);
  }
  return resolved;
}

function deriveIntentFromPrompt(prompt, scenario) {
  const trimmed = String(prompt || "").trim();
  const scenarioIntent = scenario?.intent;

  if (scenarioIntent && trimmed === String(scenario?.prompt || "").trim()) {
    return {
      primaryDirective: scenarioIntent.directive,
      strictBoundaries: scenarioIntent.boundaries.slice(),
      successState: scenarioIntent.success,
    };
  }

  return {
    primaryDirective: trimmed,
    strictBoundaries: DEFAULT_BOUNDARIES.slice(),
    successState: `${DEFAULT_SUCCESS_SUMMARY} Target outcome: ${trimmed}`,
  };
}

function getPrimaryReviewNode(artifact) {
  return (
    getNodes(artifact).find((node) => node.approvalRequired)
    || getNodes(artifact).find((node) => node.nodeType === "tool")
    || getNodes(artifact).find((node) => node.nodeType === "approval")
    || getNodes(artifact)[0]
    || null
  );
}

function getChangeNodeId(artifact, change) {
  if (!artifact || !change) return null;
  return (
    change.originatingNodeId
    || change.targetNodeId
    || change.nodeId
    || change.node
    || change.payload?.nodeId
    || artifact.plan?.approvalGates?.find((gate) => gate.required)?.targetNodeId
    || getPrimaryReviewNode(artifact)?.id
    || null
  );
}

function normalizePreviewMarker(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isObjectRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getOperationName(operation) {
  const raw = firstMeaningfulString(operation?.operation, operation?.op, operation?.kind);
  const aliases = {
    modify: "modify_file",
    create: "create_file",
    delete: "delete_file",
    rename: "rename_file",
  };
  return aliases[raw] || raw || "change";
}

function collectOperationTargets(operation) {
  if (!isObjectRecord(operation)) return [];
  return asArray([
    operation.relativeSourcePath,
    operation.source,
    operation.source_path,
    operation.from,
    operation.old_path,
    operation.workspace_path,
    operation.path,
    operation.file_path,
    operation.target_path,
    operation.target,
    operation.relativeTargetPath,
    operation.destination_path,
    operation.to,
    operation.new_path,
    operation.new_workspace_path,
  ].filter(Boolean)).filter((entry) => typeof entry === "string" && entry.trim());
}

function getInlineCodeChangeOperations(change) {
  if (!isObjectRecord(change)) return [];
  return [
    ...asArray(change.effects),
    ...asArray(change.execution?.effects),
    ...asArray(change.changes),
    ...asArray(change.operations),
    ...asArray(change.admittedOutput?.changes),
    ...asArray(change.admittedOutput?.operations),
  ].filter(isObjectRecord);
}

function getArtifactCodeChangeOperations(artifact, change) {
  const inlineOperations = getInlineCodeChangeOperations(change);
  if (inlineOperations.length > 0) return inlineOperations;

  const nodeId = getChangeNodeId(artifact, change);
  const nodes = artifact?.plan?.nodes || [];
  const ownerNode = nodes.find((node) => node.id === nodeId) || null;
  const inputNode = ownerNode?.inputNodeId
    ? nodes.find((node) => node.id === ownerNode.inputNodeId)
    : null;
  const candidates = uniqueBy(
    [inputNode, ownerNode, ...nodes].filter(Boolean),
    (node) => node.id,
  );

  for (const node of candidates) {
    const operations = [
      ...asArray(node.admittedOutput?.changes),
      ...asArray(node.admittedOutput?.operations),
    ].filter(isObjectRecord);
    if (operations.length > 0) return operations;
  }

  return [];
}

function getChangeAffectedFiles(change) {
  const explicitTargets = [
    ...asArray(change?.affectedFiles),
    ...asArray(change?.targets),
    ...asArray(change?.targetFiles),
  ].filter((entry) => typeof entry === "string" && entry.trim());
  const operationTargets = getInlineCodeChangeOperations(change).flatMap((operation) =>
    collectOperationTargets(operation),
  );
  const fallbackTarget = firstMeaningfulString(change?.target, change?.workspace_path, change?.path);

  return uniqueBy(
    [
      ...explicitTargets,
      ...operationTargets,
      ...(fallbackTarget && fallbackTarget !== DEFAULT_HOST_TARGET_SYMBOL ? [fallbackTarget] : []),
    ].map((entry) => entry.trim()),
    (entry) => entry,
  );
}

function hasRealFileTargets(change) {
  return getChangeAffectedFiles(change).length > 0 || getInlineCodeChangeOperations(change).length > 0;
}

function isAdvisoryPreviewChange(change, previewBody = "") {
  if (!change || typeof change !== "object") return false;

  const target = firstMeaningfulString(change.target, change.targetSymbol, change.symbol);
  const summary = normalizePreviewMarker(firstMeaningfulString(change.summary, change.issueSummary));
  const enforcementDetails = normalizePreviewMarker(firstMeaningfulString(change.enforcement?.details, change.details));
  const riskFlags = [
    ...asArray(change.riskFlags),
    ...asArray(change.flags),
  ].map((entry) => normalizePreviewMarker(entry));
  const preview = normalizePreviewMarker(
    previewBody
    || change.preview
    || change.diff
    || change.diffPreview
    || change.outputPreview?.preview,
  );

  return (
    riskFlags.includes("advisory_preview")
    || enforcementDetails.includes("advisory only")
    || summary.includes("advisory preview for deterministic host target")
    || preview.includes("state_effect_preview is advisory only")
    || preview.includes("advisory preview for deterministic host target")
    || (target === DEFAULT_HOST_TARGET_SYMBOL && !hasRealFileTargets(change))
  );
}

function isDisplayableProposedChange(change, previewBody = "") {
  if (!change || typeof change !== "object") return false;
  if (isAdvisoryPreviewChange(change, previewBody)) return false;

  return Boolean(
    firstMeaningfulString(change.target, change.summary, change.previewRef, change.id)
    || hasRealFileTargets(change)
    || (typeof previewBody === "string" && previewBody.trim())
  );
}

function filterDisplayableProposedChanges(changes = []) {
  return asArray(changes).filter((change) =>
    isDisplayableProposedChange(
      change,
      change?.preview || change?.diff || change?.diffPreview || change?.outputPreview?.preview || "",
    ),
  );
}

function filterAdvisoryProposedChanges(changes = []) {
  return asArray(changes).filter((change) =>
    isAdvisoryPreviewChange(
      change,
      change?.preview || change?.diff || change?.diffPreview || change?.outputPreview?.preview || "",
    ),
  );
}

function resolvePreviewBody(previewCache, change) {
  const cached = change.previewRef ? previewCache?.[change.previewRef] : null;
  const operationLines = getChangeEffectRows(change).map((row) => `! ${row}`);
  return (
    cached?.content
    || change.preview
    || change.diff
    || change.diffPreview
    || (operationLines.length > 0 ? operationLines.join("\n") : "")
    || (change.previewRef ? `! previewRef ${change.previewRef}\n! ${change.summary}` : `! ${change.summary}`)
  );
}

function getChangeTargetLabel(change, { maxFiles = 3 } = {}) {
  const files = getChangeAffectedFiles(change);
  if (files.length === 1) return files[0];
  if (files.length > 1) {
    const visible = files.slice(0, maxFiles).join(", ");
    return `${files.length} files: ${visible}${files.length > maxFiles ? ", ..." : ""}`;
  }
  return firstMeaningfulString(change?.target, change?.summary, change?.id, "Untargeted change");
}

function getChangeEffectRows(change) {
  const operations = getInlineCodeChangeOperations(change);
  if (operations.length === 0) return [];

  return operations.map((operation, index) => {
    const operationName = getOperationName(operation).replaceAll("_", " ");
    const source = firstMeaningfulString(
      operation.relativeSourcePath,
      operation.source,
      operation.source_path,
      operation.from,
      operation.old_path,
      operation.workspace_path,
      operation.path,
    );
    const target = firstMeaningfulString(
      operation.relativeTargetPath,
      operation.target,
      operation.destination_path,
      operation.to,
      operation.new_path,
      operation.new_workspace_path,
      operation.target_path,
      operation.path,
      operation.workspace_path,
    );
    const summary = firstMeaningfulString(operation.summary, operation.description);
    const pathLabel = source && target && source !== target ? `${source} -> ${target}` : target || source || `operation ${index + 1}`;
    return [operationName, pathLabel, summary].filter(Boolean).join(" · ");
  });
}

function countAffectedFiles(changes = []) {
  return uniqueBy(
    asArray(changes).flatMap((change) => getChangeAffectedFiles(change)),
    (entry) => entry,
  ).length;
}

function normalizeIssueEvidence(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return {
      kind: "text",
      message: entry,
    };
  }

  if (typeof entry !== "object") {
    return null;
  }

  return {
    kind: entry.kind || entry.type || "text",
    message: entry.message || entry.summary || entry.description || entry.text || "",
    detail: entry.detail || entry.value || entry.snippet || entry.path || null,
    path: entry.path || entry.file || null,
    symbol: entry.symbol || entry.name || null,
  };
}

function normalizeInterventionSuggestion(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    return {
      key: entry,
      label: entry.replace(/[-_]/g, " "),
      description: "",
    };
  }

  if (typeof entry !== "object") {
    return null;
  }

  return {
    key: entry.key || entry.kind || entry.action || entry.id || "intervention",
    label: entry.label || entry.title || entry.actionLabel || entry.action || entry.kind || "Intervene",
    description: entry.description || entry.message || entry.reason || "",
  };
}

function normalizeIssue(issue, fallback = {}) {
  if (!issue) return null;
  if (typeof issue === "string") {
    return {
      id: fallback.id || `issue.${fallback.index || 0}`,
      type: fallback.type || "runtime_issue",
      severity: fallback.severity || "warning",
      message: issue,
      evidence: [],
      affectedFiles: fallback.affectedFiles || [],
      affectedSymbols: fallback.affectedSymbols || [],
      suggestedInterventions: [],
      blocking: fallback.blocking ?? false,
    };
  }

  if (typeof issue !== "object") {
    return null;
  }

  const evidence = Array.isArray(issue.evidence)
    ? issue.evidence.map((entry) => normalizeIssueEvidence(entry)).filter(Boolean)
    : [];
  const suggestions = [
    ...(Array.isArray(issue.suggestedInterventions) ? issue.suggestedInterventions : []),
    ...(Array.isArray(issue.interventions) ? issue.interventions : []),
    ...(Array.isArray(issue.suggestions) ? issue.suggestions : []),
  ]
    .map((entry) => normalizeInterventionSuggestion(entry))
    .filter(Boolean);

  return {
    id: issue.id || fallback.id || `issue.${fallback.index || 0}`,
    type: issue.type || issue.kind || fallback.type || "runtime_issue",
    severity: issue.severity || issue.level || fallback.severity || "warning",
    message: issue.message || issue.summary || issue.description || issue.title || "",
    evidence,
    affectedFiles:
      issue.affectedFiles
      || issue.files
      || issue.affected_paths
      || fallback.affectedFiles
      || [],
    affectedSymbols:
      issue.affectedSymbols
      || issue.symbols
      || issue.affected_symbols
      || fallback.affectedSymbols
      || [],
    suggestedInterventions: suggestions,
    blocking:
      Boolean(issue.blocking)
      || issue.severity === "error"
      || issue.severity === "critical"
      || issue.status === "blocked"
      || fallback.blocking === true,
  };
}

function deriveIssuesFromFlags(change) {
  if (!Array.isArray(change?.riskFlags) && !Array.isArray(change?.flags)) {
    return [];
  }

  return [...(change.riskFlags || []), ...(change.flags || [])].map((message, index) =>
    normalizeIssue(message, {
      id: `issue.flag.${index}`,
      type: "risk_flag",
      severity: (change.policyState || change.policy) === "block" ? "error" : "warning",
      affectedFiles: getChangeAffectedFiles(change),
      blocking: (change.policyState || change.policy) === "block",
      index,
    }),
  );
}

function normalizeProposedChange(artifact, change, previewCache = {}) {
  const artifactOperations = getArtifactCodeChangeOperations(artifact, change);
  const enrichedChange = artifactOperations.length > 0 && getInlineCodeChangeOperations(change).length === 0
    ? { ...change, changes: artifactOperations }
    : change;
  const nodeId = getChangeNodeId(artifact, change);
  const affectedFiles = getChangeAffectedFiles(enrichedChange);
  const issues = [
    ...(Array.isArray(enrichedChange.issues) ? enrichedChange.issues : []),
    ...(Array.isArray(enrichedChange.verificationIssues) ? enrichedChange.verificationIssues : []),
    ...deriveIssuesFromFlags(enrichedChange),
  ]
    .map((issue, index) =>
      normalizeIssue(issue, {
        id: `${enrichedChange.id || "change"}.issue.${index}`,
        affectedFiles,
        blocking:
          enrichedChange.blocking === true
          || enrichedChange.status === "blocked"
          || (enrichedChange.policyState || enrichedChange.policy) === "block",
        index,
      }),
    )
    .filter(Boolean);
  const suggestedInterventions = [
    ...(Array.isArray(enrichedChange.suggestedInterventions) ? enrichedChange.suggestedInterventions : []),
    ...(Array.isArray(enrichedChange.interventions) ? enrichedChange.interventions : []),
  ]
    .map((entry) => normalizeInterventionSuggestion(entry))
    .filter(Boolean);
  const evidence = Array.isArray(enrichedChange.evidence)
    ? enrichedChange.evidence.map((entry) => normalizeIssueEvidence(entry)).filter(Boolean)
    : [];

  return {
    ...enrichedChange,
    nodeId,
    node: enrichedChange.node || nodeId,
    originatingNodeId: enrichedChange.originatingNodeId || nodeId,
    preview: resolvePreviewBody(previewCache, enrichedChange),
    issues,
    issueSummary:
      enrichedChange.issueSummary
      || enrichedChange.verificationSummary
      || issues.find((issue) => issue.message)?.message
      || null,
    evidence,
    affectedFiles,
    affectedSymbols: enrichedChange.affectedSymbols || [],
    suggestedInterventions,
    hasBlockingIssue: issues.some((issue) => issue.blocking),
  };
}

function decorateArtifact(rawArtifact, previewCache = {}) {
  if (!rawArtifact) return null;
  const artifact = deepClone(rawArtifact);
  const existingChanges = Array.isArray(artifact.proposedChanges)
    ? artifact.proposedChanges
    : Array.isArray(artifact.plan?.stateEffects)
      ? artifact.plan.stateEffects
      : [];

  artifact.proposedChanges = existingChanges.map((change) =>
    normalizeProposedChange(artifact, change, previewCache),
  );
  return artifact;
}

function normalizeInspectorPayload(artifact, rawPayload, previewCache = {}) {
  if (!rawPayload) return null;

  const payload = deepClone(rawPayload);
  if (Array.isArray(payload.proposedChanges)) {
    payload.proposedChanges = payload.proposedChanges.map((change) =>
      normalizeProposedChange(artifact, change, previewCache),
    );
  }

  payload.issues = [
    ...(Array.isArray(payload.issues) ? payload.issues : []),
    ...(Array.isArray(payload.verificationIssues) ? payload.verificationIssues : []),
  ]
    .map((issue, index) =>
      normalizeIssue(issue, {
        id: `${payload.node?.id || "node"}.issue.${index}`,
        affectedFiles: payload.affectedFiles || [],
        affectedSymbols: payload.affectedSymbols || [],
        blocking: payload.node?.reviewStatus === "blocked",
        index,
      }),
    )
    .filter(Boolean);

  payload.evidence = Array.isArray(payload.evidence)
    ? payload.evidence.map((entry) => normalizeIssueEvidence(entry)).filter(Boolean)
    : [];
  payload.suggestedInterventions = [
    ...(Array.isArray(payload.suggestedInterventions) ? payload.suggestedInterventions : []),
    ...(Array.isArray(payload.interventions) ? payload.interventions : []),
  ]
    .map((entry) => normalizeInterventionSuggestion(entry))
    .filter(Boolean);
  payload.issueSummary =
    payload.issueSummary
    || payload.verificationSummary
    || payload.issues.find((issue) => issue.message)?.message
    || null;
  payload.affectedFiles = payload.affectedFiles || [];
  payload.affectedSymbols = payload.affectedSymbols || [];

  if (payload.approvals && !payload.approvals.gates && payload.approvals.gateId) {
    payload.approvals.gates = [
      {
        id: payload.approvals.gateId,
        status: payload.approvals.status || payload.approvals.gateStatus,
        planVersion: payload.approvals.planVersion,
        artifactHash: payload.approvals.artifactHash,
        nodeRevision: payload.approvals.nodeRevision,
      },
    ];
  }

  if (payload.approvals && payload.approvals.required == null) {
    payload.approvals.required = Boolean(payload.approvals.gateId || payload.approvals.status);
  }

  if (payload.audit?.lastArtifactHash && !payload.audit.artifactHash) {
    payload.audit.artifactHash = payload.audit.lastArtifactHash;
  }

  if (payload.audit && payload.audit.nodeRevision == null && payload.node?.revision != null) {
    payload.audit.nodeRevision = payload.node.revision;
  }

  return payload;
}

function collectReviewIssues(record, node = null, proposedChanges = []) {
  const normalizedFromIssues = [
    ...asArray(record?.issues),
    ...asArray(record?.verificationIssues),
    ...asArray(record?.findings),
  ]
    .map((entry) => normalizeReviewIssue(entry))
    .filter(Boolean);

  const normalizedFromSummary = record?.issueSummary
    ? [normalizeReviewIssue({
      title: record.proposedAction || record.issue || "Flagged issue",
      summary: record.issueSummary,
      severity: record?.blocking ? "critical" : record?.severity,
      evidence: record?.evidence,
      affectedFiles: record?.affectedFiles,
      affectedSymbols: record?.affectedSymbols,
      suggestedInterventions: record?.suggestedInterventions,
    })].filter(Boolean)
    : [];

  const normalizedFromChanges = proposedChanges.flatMap((change) => {
    const entries = [
      ...asArray(change?.issues),
      ...asArray(change?.verificationIssues),
    ]
      .map((entry) => normalizeReviewIssue(entry))
      .filter(Boolean);

    if (entries.length > 0) return entries;
    if (!change?.issueSummary && !change?.riskFlags?.length) return [];
    return [normalizeReviewIssue({
      title: change.proposedAction || getChangeTargetLabel(change) || "Flagged action",
      summary: change.issueSummary || change.summary,
      severity: change.hasBlockingIssue || (change.policyState || change.policy) === "block" ? "critical" : change.policyState,
      evidence: [...asArray(change.evidence), ...asArray(change.riskFlags)],
      affectedFiles: getChangeAffectedFiles(change),
      affectedSymbols: change.affectedSymbols,
      suggestedInterventions: change.suggestedInterventions,
    })].filter(Boolean);
  });

  const fallbackFlags = node?.riskFlags?.length
    ? [normalizeReviewIssue({
      title: node.riskFlags[0],
      severity: node.reviewStatus === "blocked" ? "critical" : node.confidenceBand,
      evidence: node.riskFlags,
    })].filter(Boolean)
    : [];

  return uniqueBy(
    [...normalizedFromIssues, ...normalizedFromSummary, ...normalizedFromChanges, ...fallbackFlags],
    (issue) => issue.key,
  );
}

function deriveAffectedScope(node, payload, proposedChanges = []) {
  const explicitScope = [
    ...asArray(payload?.affected),
    ...asArray(payload?.targets),
    ...asArray(payload?.affectedFiles),
    ...asArray(payload?.affectedSymbols),
  ]
    .map((entry, index) => normalizeAffectedItem(entry, index))
    .filter(Boolean);
  if (explicitScope.length > 0) {
    return uniqueBy(explicitScope, (entry) => entry.key);
  }

  const issueScope = collectReviewIssues(payload, node, proposedChanges)
    .flatMap((issue) => issue.affected)
    .filter(Boolean);
  if (issueScope.length > 0) {
    return uniqueBy(issueScope, (entry) => entry.key);
  }

  return uniqueBy(
    proposedChanges
      .flatMap((change, index) => {
        const files = getChangeAffectedFiles(change);
        if (files.length > 0) {
          return files.map((file, fileIndex) => normalizeAffectedItem({
            label: file,
            detail: fileIndex === 0 ? change.summary : "",
            kind: change.kind,
          }, index + fileIndex));
        }
        return [normalizeAffectedItem({
          label: getChangeTargetLabel(change),
          detail: change.summary,
          kind: change.kind,
        }, index)];
      })
      .filter(Boolean),
    (entry) => entry.key,
  );
}

function summarizeChangeApproval(change, artifact, approvals = {}) {
  const policyState = change?.policyState || change?.policy;
  const entry = approvals?.[change?.id];
  const fresh = approvalEntryIsFresh(entry, artifact);

  if (policyState === "block" || change?.hasBlockingIssue) {
    return {
      tone: "red",
      label: "Blocked",
      detail: "This action is blocked before execution.",
    };
  }
  if (!artifact || artifact.freshnessState === "stale") {
    return {
      tone: "orange",
      label: "Stale artifact",
      detail: "Re-open the latest artifact before approving this action.",
    };
  }
  if (fresh && entry?.decision === "approve") {
    return {
      tone: "green",
      label: "Approved",
      detail: "Fresh reviewer approval recorded for this action.",
    };
  }
  if (fresh && entry?.decision === "block") {
    return {
      tone: "red",
      label: "Blocked by reviewer",
      detail: "Reviewer stopped this action from continuing.",
    };
  }
  if (fresh && entry?.decision === "changes") {
    return {
      tone: "orange",
      label: "Changes requested",
      detail: "Reviewer requested intervention before execution.",
    };
  }
  if (policyState === "review_required") {
    return {
      tone: "orange",
      label: "Approval required",
      detail: "This action is paused at an approval gate.",
    };
  }
  return {
    tone: "yellow",
    label: "Pending review",
    detail: "This action is compiled and waiting for a decision.",
  };
}

function summarizeNodeApproval(artifact, node, payload, approvals = {}) {
  const nodeChanges = payload?.proposedChanges?.length
    ? payload.proposedChanges
    : getDisplayableProposedChanges(artifact).filter((change) => getChangeNodeId(artifact, change) === node?.id);
  const approvableChanges = nodeChanges.filter((change) => (change.policyState || change.policy) !== "block");
  const approvedCount = approvableChanges.filter((change) => {
    const entry = approvals?.[change.id];
    return entry?.decision === "approve" && approvalEntryIsFresh(entry, artifact, node?.revision);
  }).length;
  const blockedCount = approvableChanges.filter((change) => {
    const entry = approvals?.[change.id];
    return entry?.decision === "block" && approvalEntryIsFresh(entry, artifact, node?.revision);
  }).length;
  const changeRequestCount = approvableChanges.filter((change) => {
    const entry = approvals?.[change.id];
    return entry?.decision === "changes" && approvalEntryIsFresh(entry, artifact, node?.revision);
  }).length;
  const policyBlockedCount = nodeChanges.filter((change) => (change.policyState || change.policy) === "block" || change.hasBlockingIssue).length;
  const gates = payload?.approvals?.gates?.length
    ? payload.approvals.gates
    : artifact?.plan?.approvalGates?.filter((gate) => gate.targetNodeId === node?.id) || [];

  if (!artifact || artifact.freshnessState === "stale" || node?.reviewStatus === "stale") {
    return {
      tone: "red",
      label: "Stale review surface",
      detail: "Re-open this node from backend truth before taking action.",
      approvedCount,
      approvableCount: approvableChanges.length,
      blockedCount,
      changeRequestCount,
      policyBlockedCount,
      gateCount: gates.length,
    };
  }
  if (policyBlockedCount > 0) {
    return {
      tone: "red",
      label: "Issue blocks execution",
      detail: `${policyBlockedCount} action${policyBlockedCount === 1 ? "" : "s"} on this node are blocked.`,
      approvedCount,
      approvableCount: approvableChanges.length,
      blockedCount,
      changeRequestCount,
      policyBlockedCount,
      gateCount: gates.length,
    };
  }
  if (blockedCount > 0) {
    return {
      tone: "red",
      label: "Reviewer blocked",
      detail: `${blockedCount} reviewer decision${blockedCount === 1 ? "" : "s"} currently stop execution.`,
      approvedCount,
      approvableCount: approvableChanges.length,
      blockedCount,
      changeRequestCount,
      policyBlockedCount,
      gateCount: gates.length,
    };
  }
  if (changeRequestCount > 0) {
    return {
      tone: "orange",
      label: "Intervention requested",
      detail: `${changeRequestCount} change${changeRequestCount === 1 ? "" : "s"} need intervention before approval.`,
      approvedCount,
      approvableCount: approvableChanges.length,
      blockedCount,
      changeRequestCount,
      policyBlockedCount,
      gateCount: gates.length,
    };
  }
  if (approvableChanges.length > 0 && approvedCount === approvableChanges.length) {
    return {
      tone: "green",
      label: "Approved to continue",
      detail: "Every approvable action on this node has a fresh approval.",
      approvedCount,
      approvableCount: approvableChanges.length,
      blockedCount,
      changeRequestCount,
      policyBlockedCount,
      gateCount: gates.length,
    };
  }
  if (gates.length > 0 || approvableChanges.length > 0 || node?.approvalRequired) {
    return {
      tone: "orange",
      label: "Awaiting reviewer action",
      detail: "This node is paused at approval until the issue is resolved or approved.",
      approvedCount,
      approvableCount: approvableChanges.length,
      blockedCount,
      changeRequestCount,
      policyBlockedCount,
      gateCount: gates.length,
    };
  }
  return {
    tone: "yellow",
    label: "No explicit gate",
    detail: "No approval gate is attached to this node yet.",
    approvedCount,
    approvableCount: approvableChanges.length,
    blockedCount,
    changeRequestCount,
    policyBlockedCount,
    gateCount: gates.length,
  };
}

function hydrateArtifactWithInspectorCache(rawArtifact, inspectorCache, previewCache = {}) {
  const artifact = decorateArtifact(rawArtifact, previewCache);
  if (!artifact) return null;

  artifact.nodeInspectorPayloads = {
    ...(artifact.nodeInspectorPayloads || {}),
  };

  getNodes(artifact).forEach((node) => {
    const cachedPayload = inspectorCache?.[inspectorCacheKey(artifact.runId, node)];
    if (!cachedPayload) return;
    artifact.nodeInspectorPayloads[node.id] = normalizeInspectorPayload(
      artifact,
      cachedPayload,
      previewCache,
    );
  });

  Object.entries(artifact.nodeInspectorPayloads).forEach(([nodeId, payload]) => {
    artifact.nodeInspectorPayloads[nodeId] = normalizeInspectorPayload(
      artifact,
      payload,
      previewCache,
    );
  });

  return artifact;
}

function buildStaleArtifactView(currentArtifact, latestArtifact, focusNodeId, previewCache = {}) {
  if (!currentArtifact || !latestArtifact) {
    return decorateArtifact(currentArtifact, previewCache);
  }

  const staleArtifact = decorateArtifact(currentArtifact, previewCache);
  const latestNodesById = new Map(getNodes(latestArtifact).map((node) => [node.id, node]));
  const invalidatedNodeIds = new Set();

  getNodes(staleArtifact).forEach((node) => {
    const latestNode = latestNodesById.get(node.id);
    if (!latestNode || latestNode.revision !== node.revision) {
      invalidatedNodeIds.add(node.id);
    }
  });

  if (focusNodeId) {
    invalidatedNodeIds.add(focusNodeId);
  }

  staleArtifact.freshnessState = "stale";
  staleArtifact.staleReason = `This view is older than artifact ${shortHash(latestArtifact.artifactHash)}.`;
  staleArtifact.plan.nodes = staleArtifact.plan.nodes.map((node) =>
    invalidatedNodeIds.has(node.id)
      ? {
          ...node,
          reviewStatus: "stale",
        }
      : node,
  );

  if (staleArtifact.nodeInspectorPayloads) {
    Object.values(staleArtifact.nodeInspectorPayloads).forEach((payload) => {
      if (!payload?.node || !invalidatedNodeIds.has(payload.node.id)) return;
      payload.node.reviewStatus = "stale";
      if (payload.audit) {
        payload.audit.artifactHash = staleArtifact.artifactHash;
      }
    });
  }

  return staleArtifact;
}

function phaseFromArtifact(artifact) {
  const status = artifact?.plan?.status;
  const runningNode = getNodes(artifact).find((node) => node.executionStatus === "running");
  if (status === "running" && runningNode?.nodeType !== "semantic_generation") return "running";
  if (status === "completed") return "done";
  if (artifact) return "review";
  return "prompt";
}

function getLatestCheckpoint(artifact) {
  const checkpoints = artifact?.plan?.checkpoints || [];
  return checkpoints[checkpoints.length - 1] || null;
}

function summarizeExecutionState(source) {
  const artifact = getReviewArtifact(source) || (source?.plan ? source : null);
  const nodes = getNodes(artifact);
  const latestCheckpoint = getLatestCheckpoint(artifact);
  const displayableChanges = getDisplayableProposedChanges(artifact);
  const advisoryChanges = getAdvisoryProposedChanges(artifact);
  const runningNodes = nodes.filter((node) => node.executionStatus === "running");
  const succeededNodes = nodes.filter((node) => node.executionStatus === "succeeded");
  const pausedNodes = nodes.filter((node) => node.executionStatus === "paused");
  const failedNodes = nodes.filter((node) => node.executionStatus === "failed");
  const admittedNodes = nodes.filter((node) => node.admittedOutput != null);
  const semanticAdmissionNode = runningNodes.find((node) => node.nodeType === "semantic_generation");
  const semanticAdmissionElapsedMs = semanticAdmissionNode && artifact?.generatedAt
    ? Date.now() - artifact.generatedAt
    : 0;
  const items = uniqueBy(
    [
      latestCheckpoint
        ? `${latestCheckpoint.id} · ${(latestCheckpoint.reason || "checkpoint_ready").replace(/_/g, " ")}`
        : null,
      ...runningNodes.map((node) =>
        `${node.title} · running${node.outputSummary ? ` · ${node.outputSummary}` : ""}`,
      ),
      ...pausedNodes.map((node) =>
        `${node.title} · paused${node.outputSummary ? ` · ${node.outputSummary}` : ""}`,
      ),
      ...failedNodes.map((node) =>
        `${node.title} · failed${node.outputSummary ? ` · ${node.outputSummary}` : ""}`,
      ),
      ...admittedNodes.map((node) =>
        `${node.title} · admitted output ready`,
      ),
      ...succeededNodes.map((node) =>
        `${node.title} · completed${node.outputSummary ? ` · ${node.outputSummary}` : ""}`,
      ),
    ].filter(Boolean),
    (item) => item,
  ).slice(0, 5);

  if (displayableChanges.length > 0) {
    const affectedFileCount = countAffectedFiles(displayableChanges);
    return {
      title: "Admitted code changes ready",
      body: affectedFileCount > 0
        ? `${displayableChanges.length} admitted code change${displayableChanges.length === 1 ? "" : "s"} across ${affectedFileCount} file${affectedFileCount === 1 ? "" : "s"} are attached to this artifact.`
        : `${displayableChanges.length} admitted code change${displayableChanges.length === 1 ? "" : "s"} are attached to this artifact.`,
      items,
      latestCheckpoint,
      displayableCount: displayableChanges.length,
      advisoryCount: advisoryChanges.length,
    };
  }

  if (failedNodes.length > 0 || artifact?.plan?.status === "failed") {
    return {
      title: "Semantic proposal failed",
      body: failedNodes[0]?.outputSummary || "The runtime failed before Semantix could admit a strict code-change proposal.",
      items,
      latestCheckpoint,
      displayableCount: 0,
      advisoryCount: advisoryChanges.length,
    };
  }

  if (semanticAdmissionNode) {
    const elapsedSeconds = Math.max(0, Math.floor(semanticAdmissionElapsedMs / 1000));
    const elapsedDetail = elapsedSeconds >= 30
      ? ` It has been running for about ${elapsedSeconds}s.`
      : "";
    return {
      title: "Compiling semantic proposal",
      body: `Semantix is still waiting for semantic admission to produce a strict code-change proposal. Blocking issues cannot appear until that proposal is admitted and validated.${elapsedDetail}`,
      items,
      latestCheckpoint,
      displayableCount: 0,
      advisoryCount: advisoryChanges.length,
    };
  }

  if (latestCheckpoint) {
    return {
      title: "Execution paused at checkpoint",
      body: `No admitted code-change proposal is attached yet. Latest checkpoint: ${(latestCheckpoint.reason || "checkpoint_ready").replace(/_/g, " ")}.`,
      items,
      latestCheckpoint,
      displayableCount: 0,
      advisoryCount: advisoryChanges.length,
    };
  }

  if (admittedNodes.length > 0) {
    return {
      title: "Admitted output is ready",
      body: `No rendered code-change diff is attached yet, but ${admittedNodes.length} node${admittedNodes.length === 1 ? "" : "s"} produced admitted output.`,
      items,
      latestCheckpoint,
      displayableCount: 0,
      advisoryCount: advisoryChanges.length,
    };
  }

  if (runningNodes.length > 0 || succeededNodes.length > 0 || pausedNodes.length > 0) {
    return {
      title: "Execution data available",
      body: "This artifact has execution progress data but no admitted code-change proposal yet.",
      items,
      latestCheckpoint,
      displayableCount: 0,
      advisoryCount: advisoryChanges.length,
    };
  }

  return {
    title: "Awaiting admitted code changes",
    body: advisoryChanges.length > 0
      ? "This artifact only carries advisory host previews right now. The review surface will expose code changes once the backend publishes admitted proposals."
      : "No admitted code-change proposal is attached to this artifact yet.",
    items,
    latestCheckpoint,
    displayableCount: 0,
    advisoryCount: advisoryChanges.length,
  };
}

async function parseApiError(response) {
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const error = new Error(payload?.message || `HTTP ${response.status}`);
  error.status = response.status;
  error.code = payload?.error;
  error.details = payload?.details;
  error.payload = payload;
  return error;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    throw await parseApiError(response);
  }

  return response.status === 204 ? null : response.json();
}

function createEventStream(runId) {
  return new EventSource(buildRunApiUrl(runId, "/events"));
}

function formatFreshnessError(actionLabel, error) {
  const details = error?.details || {};
  const suffix = details.currentPlanVersion != null
    ? `Re-open v${details.currentPlanVersion} / g${details.currentGraphVersion ?? "?"}.`
    : "Re-open the latest artifact.";
  return `${actionLabel} was rejected by the control plane because this review artifact is stale. ${suffix}`;
}

function getReviewArtifact(source) {
  if (!source) return null;
  if (source.reviewArtifact) return source.reviewArtifact;
  if (source.plan && source.intent) return source;
  return null;
}

function getPlan(source) {
  const artifact = getReviewArtifact(source);
  return artifact?.plan || source?.plan || null;
}

function getIntent(source) {
  const artifact = getReviewArtifact(source);
  return artifact?.intent || getPlan(source)?.intent || source?.intent || null;
}

function getNodes(source) {
  return getPlan(source)?.nodes || source?.nodes || [];
}

function getEdges(source) {
  return getPlan(source)?.edges || source?.edges || [];
}

function getProposedChanges(source) {
  const artifact = getReviewArtifact(source);
  return artifact?.proposedChanges || artifact?.plan?.stateEffects || source?.diff || [];
}

function getDisplayableProposedChanges(source) {
  return filterDisplayableProposedChanges(
    source?.proposedChanges || getProposedChanges(source),
  );
}

function getAdvisoryProposedChanges(source) {
  return filterAdvisoryProposedChanges(
    source?.proposedChanges || getProposedChanges(source),
  );
}

function getNodeById(source, nodeId) {
  return getNodes(source).find((node) => node.id === nodeId) || null;
}

function getNodeInspectorPayload(source, nodeId) {
  const artifact = getReviewArtifact(source);
  if (artifact?.nodeInspectorPayloads?.[nodeId]) {
    return normalizeInspectorPayload(artifact, artifact.nodeInspectorPayloads[nodeId]);
  }
  return null;
}

function shortHash(hash) {
  if (!hash) return "n/a";
  return String(hash).slice(0, 8);
}

function edgeKind(edge) {
  return edge?.kind || edge?.relation || "execution";
}

function edgeEndpoints(edge) {
  if (Array.isArray(edge)) return { from: edge[0], to: edge[1] };
  return { from: edge.from, to: edge.to };
}

function nodeRevisionKey(node) {
  return `${node.id}:${node.revision || 0}`;
}

function inspectorCacheKey(runId, nodeOrId, revision) {
  if (typeof nodeOrId === "object" && nodeOrId) {
    return `${runId}:${nodeRevisionKey(nodeOrId)}`;
  }
  return `${runId}:${nodeOrId}:${revision || 0}`;
}

function freshnessTone(state) {
  if (state === "stale" || state === "superseded") return "red";
  return "green";
}

function formatFreshnessState(state) {
  if (!state) return "fresh";
  return state.replace(/_/g, " ");
}

function resolveRiskFromNode(node) {
  if (!node) return "yellow";
  if (node.reviewStatus === "blocked" || node.reviewStatus === "stale") return "red";
  if (node.confidenceBand === "low") return "orange";
  if (node.confidenceBand === "medium") return "yellow";
  return "green";
}

function reviewStatusLabel(status) {
  if (!status) return "ready";
  return status.replace(/_/g, " ");
}

function prettySystemName(systemId) {
  const label = {
    semantix: "Semantix",
    phalanx: "Phalanx",
    hoplon: "Hoplon",
    ct_mcp: "CT-MCP",
    llm_tracker: "LLM Tracker",
    guardrail: "Guardrail",
  }[systemId];
  return label || systemId;
}

function countFreshApprovals(approvals, artifact) {
  return Object.values(approvals || {}).filter((entry) => approvalEntryIsFresh(entry, artifact)).length;
}

function getBlockingIssues(source) {
  const artifact = getReviewArtifact(source);
  if (!artifact) return [];

  const changeIssues = getDisplayableProposedChanges(artifact).flatMap((change) =>
    collectReviewIssues(change, null, [change]).filter((issue) =>
      issue?.severity === "critical"
      || issue?.severity === "error"
      || issue?.severity === "block"
      || change?.hasBlockingIssue,
    ),
  );
  const inspectorIssues = Object.values(artifact.nodeInspectorPayloads || {}).flatMap((payload) =>
    collectReviewIssues(payload, payload?.node, payload?.proposedChanges || []).filter((issue) =>
      issue?.severity === "critical"
      || issue?.severity === "error"
      || issue?.severity === "block"
      || payload?.node?.reviewStatus === "blocked",
    ),
  );

  return [...changeIssues, ...inspectorIssues];
}

function countStaleApprovals(approvals, artifact) {
  return Object.values(approvals || {}).filter((entry) => !approvalEntryIsFresh(entry, artifact)).length;
}

function approvalEntryIsFresh(entry, artifact, expectedNodeRevision) {
  if (!entry || !artifact) return false;
  if (entry.planVersion !== artifact.planVersion) return false;
  if (entry.graphVersion !== artifact.graphVersion) return false;
  if (entry.artifactHash !== artifact.artifactHash) return false;
  if (expectedNodeRevision != null && entry.nodeRevision !== expectedNodeRevision) return false;
  return true;
}

function interveneArtifactLocally(artifact, nodeId, kind) {
  const staleArtifact = deepClone(artifact);
  const latestArtifact = deepClone(artifact);
  const childrenByNode = {};

  getEdges(artifact).forEach((edge) => {
    const { from, to } = edgeEndpoints(edge);
    childrenByNode[from] ||= [];
    childrenByNode[from].push(to);
  });

  const queue = [nodeId];
  const invalidatedNodeIds = new Set([nodeId]);
  while (queue.length) {
    const current = queue.shift();
    (childrenByNode[current] || []).forEach((child) => {
      if (invalidatedNodeIds.has(child)) return;
      invalidatedNodeIds.add(child);
      queue.push(child);
    });
  }

  const invalidatedChangeIds = getProposedChanges(artifact)
    .filter((change) => invalidatedNodeIds.has(change.originatingNodeId || change.nodeId || change.node))
    .map((change) => change.id);

  staleArtifact.freshnessState = "stale";
  staleArtifact.staleReason = `${kind} invalidated ${invalidatedNodeIds.size} node(s).`;
  staleArtifact.plan.nodes = staleArtifact.plan.nodes.map((node) => (
    invalidatedNodeIds.has(node.id) ? { ...node, reviewStatus: "stale" } : node
  ));
  Object.values(staleArtifact.nodeInspectorPayloads || {}).forEach((payload) => {
    if (invalidatedNodeIds.has(payload.node.id)) payload.node.reviewStatus = "stale";
  });

  latestArtifact.planVersion += 1;
  latestArtifact.graphVersion += 1;
  latestArtifact.generatedAt = Date.now();
  latestArtifact.artifactHash = `artifact-${latestArtifact.planVersion}-${latestArtifact.graphVersion}-${String(nodeId).replace(/[^a-z0-9]/gi, "")}`;
  latestArtifact.artifactId = `${latestArtifact.artifactId.split("_v")[0]}_v${latestArtifact.planVersion}_${shortHash(latestArtifact.artifactHash)}`;
  latestArtifact.freshnessState = "fresh";
  latestArtifact.intent.planVersion = latestArtifact.planVersion;
  latestArtifact.intent.artifactHash = latestArtifact.artifactHash;
  latestArtifact.plan.planVersion = latestArtifact.planVersion;
  latestArtifact.plan.graphVersion = latestArtifact.graphVersion;
  latestArtifact.plan.artifactHash = latestArtifact.artifactHash;
  latestArtifact.plan.status = "pending_review";

  latestArtifact.plan.nodes = latestArtifact.plan.nodes.map((node) => {
    if (!invalidatedNodeIds.has(node.id)) return node;
    const next = { ...node, revision: (node.revision || 1) + 1, executionStatus: "paused" };
    if (node.id === nodeId) {
      next.reviewStatus = "warning";
      next.confidenceBand = node.confidenceBand === "low" ? "medium" : node.confidenceBand;
      next.confidenceScore = node.confidenceBand === "low" ? 0.68 : node.confidenceScore;
      next.grounding = node.grounding === "bridged" ? "transformed" : node.grounding;
      if (kind === "require-approval") next.approvalRequired = true;
    } else {
      next.reviewStatus = node.reviewStatus === "blocked" ? "blocked" : "warning";
    }
    return next;
  });

  latestArtifact.proposedChanges = latestArtifact.proposedChanges.map((change) => {
    const related = invalidatedNodeIds.has(change.originatingNodeId || change.nodeId || change.node);
    if (!related) return change;
    const next = { ...change, riskFlags: (change.riskFlags || []).slice() };
    if (kind === "require-approval" && next.policyState === "pass") next.policyState = "review_required";
    if ((kind === "add-source" || kind === "regenerate" || kind === "tighten") && next.originatingNodeId === nodeId) {
      next.policyState = next.policyState === "review_required" ? "pass" : next.policyState;
      next.status = next.policyState === "pass" ? "proposed" : next.status;
      next.riskFlags = [];
      if (typeof next.preview === "string") {
        next.preview = next.preview
          .replace("!  const claims = signToken.verify(token);   // ⚠ signToken not found in repo", "   const claims = tokenVerifier.verify(token);")
          .replace("!We'll make this right financially and get you back to where you", " We'll follow the approved billing path and keep you updated as we")
          .replace("!expected to be.", " investigate the duplicate charge.");
      }
    }
    next.enforcement = {
      ...next.enforcement,
      status: next.policyState === "block" ? "block" : next.policyState === "review_required" ? "review_required" : "pass",
    };
    return next;
  });
  latestArtifact.plan.stateEffects = deepClone(latestArtifact.proposedChanges);

  latestArtifact.plan.approvalGates = latestArtifact.plan.approvalGates.map((gate) => {
    if (!invalidatedNodeIds.has(gate.targetNodeId)) return gate;
    return {
      ...gate,
      status: "pending",
      planVersion: latestArtifact.planVersion,
      artifactHash: latestArtifact.artifactHash,
      nodeRevision: latestArtifact.plan.nodes.find((node) => node.id === gate.targetNodeId)?.revision,
    };
  });
  if (kind === "require-approval" && !latestArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === nodeId)) {
    latestArtifact.plan.approvalGates.push({
      id: `gate.${nodeId}.local`,
      targetNodeId: nodeId,
      required: true,
      status: "pending",
      planVersion: latestArtifact.planVersion,
      artifactHash: latestArtifact.artifactHash,
      nodeRevision: latestArtifact.plan.nodes.find((node) => node.id === nodeId)?.revision,
      reason: "Reviewer inserted an approval gate locally.",
    });
  }

  Object.entries(latestArtifact.nodeInspectorPayloads || {}).forEach(([payloadNodeId, payload]) => {
    const currentNode = latestArtifact.plan.nodes.find((node) => node.id === payloadNodeId);
    if (!currentNode) return;
    payload.node = deepClone(currentNode);
    payload.audit.artifactHash = latestArtifact.artifactHash;
    payload.audit.planVersion = latestArtifact.planVersion;
    payload.audit.graphVersion = latestArtifact.graphVersion;
    payload.audit.nodeRevision = currentNode.revision;
    payload.approvals.required = currentNode.approvalRequired;
    payload.approvals.planVersion = latestArtifact.planVersion;
    payload.approvals.artifactHash = latestArtifact.artifactHash;
    payload.proposedChanges = latestArtifact.proposedChanges.filter((change) => (change.originatingNodeId || change.nodeId || change.node) === payloadNodeId);
    if (payloadNodeId === nodeId) {
      if (kind === "add-source" && payload.context?.visibleSources) {
        if (!payload.context.visibleSources.includes("lib/crypto/tokens.ts")) {
          payload.context.visibleSources.push("lib/crypto/tokens.ts");
        }
      }
      if (kind === "tighten" && payload.constraints?.hard) {
        payload.constraints.hard.push("Fresh reviewer confirmation required after intervention");
      }
      if (kind === "require-approval") {
        payload.approvals.required = true;
      }
      payload.critique = kind === "require-approval" ? payload.critique : undefined;
    }
  });

  return {
    latestArtifact,
    staleArtifact,
    invalidatedNodeIds: Array.from(invalidatedNodeIds),
    invalidatedChangeIds,
    message: `Applied ${kind} on ${nodeId}. The backend regenerated only the affected subgraph.`,
  };
}

const RISK_TOKEN = (t, risk) => {
  const map = {
    green: [t.green, t.greenSoft],
    yellow: [t.yellow, t.yellowSoft],
    orange: [t.orange, t.orangeSoft],
    red: [t.red, t.redSoft],
    info: [t.info, t.infoSoft],
  };
  const [fg, bg] = map[risk] || [t.textDim, t.panelAlt];
  return { fg, bg };
};

function Pill({ children, t, risk, strong, style }) {
  const { fg, bg } = risk ? RISK_TOKEN(t, risk) : { fg: t.textDim, bg: t.panelAlt };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: 0.1,
        padding: "3px 9px",
        borderRadius: 999,
        background: strong ? fg : bg,
        color: strong ? "#fff" : fg,
        border: `1px solid ${strong ? fg : "transparent"}`,
        ...style,
      }}
    >
      {children}
    </span>
  );
}

function RiskDot({ t, risk, size = 8 }) {
  const { fg } = RISK_TOKEN(t, risk);
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background: fg,
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}

function Btn({ t, children, onClick, variant = "ghost", disabled, icon, style, title }) {
  const base = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "8px 12px",
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid transparent",
    transition: "all 120ms",
    opacity: disabled ? 0.55 : 1,
    lineHeight: 1,
    whiteSpace: "nowrap",
    fontFamily: "inherit",
  };
  const variants = {
    primary: { background: t.accent, color: "#fff" },
    approve: { background: t.green, color: "#fff" },
    danger: { background: t.red, color: "#fff" },
    ghost: { background: "transparent", color: t.text, border: `1px solid ${t.border}` },
    solid: { background: t.panelAlt, color: t.text, border: `1px solid ${t.border}` },
    link: { background: "transparent", color: t.accent, padding: "4px 0" },
  };
  return (
    <button onClick={disabled ? undefined : onClick} title={title} style={{ ...base, ...variants[variant], ...style }}>
      {icon}
      {children}
    </button>
  );
}

function Card({ t, children, style, pad = 14 }) {
  return (
    <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12, padding: pad, ...style }}>
      {children}
    </div>
  );
}

function Divider({ t, style }) {
  return <div style={{ height: 1, background: t.border, ...style }} />;
}

function SectionTitle({ t, eyebrow, title, meta }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, marginBottom: 10 }}>
      <div>
        {eyebrow && (
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: t.textFaint, marginBottom: 4 }}>
            {eyebrow}
          </div>
        )}
        <div style={{ fontSize: 14, fontWeight: 700, color: t.text }}>{title}</div>
      </div>
      <div style={{ flex: 1 }} />
      {meta && <div style={{ fontSize: 11, color: t.textFaint }}>{meta}</div>}
    </div>
  );
}

const Icon = {
  Spark: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />
    </svg>
  ),
  Check: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M5 12l5 5L20 7" />
    </svg>
  ),
  X: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  ),
  Block: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.5 5.5l13 13" />
    </svg>
  ),
  Edit: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M16 3l5 5-11 11H5v-5L16 3z" />
    </svg>
  ),
  Play: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M7 5v14l12-7z" />
    </svg>
  ),
  Chevron: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  ),
  File: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M6 3h8l5 5v13H6z" />
      <path d="M14 3v5h5" />
    </svg>
  ),
  Api: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M4 12h6M14 12h6M10 8v8M14 8v8" />
    </svg>
  ),
  Mail: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 7 9-7" />
    </svg>
  ),
  Database: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <ellipse cx="12" cy="5" rx="7" ry="3" />
      <path d="M5 5v10c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
    </svg>
  ),
  Ext: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <path d="M7 7h10v10" />
      <path d="M7 17L17 7" />
    </svg>
  ),
  Alert: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" {...p}>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v5M12 18v.5" />
    </svg>
  ),
  Lock: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  ),
  Refresh: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}>
      <path d="M4 11a8 8 0 0114-5l2 2" />
      <path d="M20 13a8 8 0 01-14 5l-2-2" />
      <path d="M20 4v4h-4M4 20v-4h4" />
    </svg>
  ),
  Dot: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  History: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" {...p}>
      <path d="M3 12a9 9 0 101.7-5.3" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
};

const KIND_ICON = {
  file: Icon.File,
  api: Icon.Api,
  database: Icon.Database,
  message: Icon.Mail,
  external_action: Icon.Ext,
  external: Icon.Ext,
};

Object.assign(window, {
  THEMES,
  RISK_TOKEN,
  Pill,
  RiskDot,
  Btn,
  Card,
  Divider,
  SectionTitle,
  Icon,
  KIND_ICON,
  deepClone,
  asArray,
  firstMeaningfulString,
  getScenarioRecordByKey,
  cloneScenarioRecord,
  getReviewArtifact,
  getPlan,
  getIntent,
  getNodes,
  getEdges,
  getProposedChanges,
  getDisplayableProposedChanges,
  getAdvisoryProposedChanges,
  getNodeById,
  getNodeInspectorPayload,
  shortHash,
  edgeKind,
  edgeEndpoints,
  nodeRevisionKey,
  inspectorCacheKey,
  freshnessTone,
  formatFreshnessState,
  resolveRiskFromNode,
  reviewStatusLabel,
  prettySystemName,
  normalizeAffectedItem,
  normalizeEvidenceItem,
  normalizeInterventionItem,
  normalizeReviewIssue,
  collectReviewIssues,
  deriveAffectedScope,
  summarizeChangeApproval,
  summarizeNodeApproval,
  countFreshApprovals,
  getBlockingIssues,
  countStaleApprovals,
  approvalEntryIsFresh,
  interveneArtifactLocally,
  DEFAULT_BOUNDARIES,
  DEFAULT_SUCCESS_SUMMARY,
  getApiBase,
  buildRunApiUrl,
  buildPreviewApiUrl,
  ensureRunId,
  readRunIdFromLocation,
  writeRunIdToLocation,
  createBrowserRunId,
  deriveIntentFromPrompt,
  decorateArtifact,
  normalizeInspectorPayload,
  hydrateArtifactWithInspectorCache,
  buildStaleArtifactView,
  phaseFromArtifact,
  getLatestCheckpoint,
  summarizeExecutionState,
  requestJson,
  createEventStream,
  formatFreshnessError,
  getPrimaryReviewNode,
  getChangeNodeId,
  isAdvisoryPreviewChange,
  isDisplayableProposedChange,
  filterDisplayableProposedChanges,
  filterAdvisoryProposedChanges,
  getChangeAffectedFiles,
  getChangeTargetLabel,
  getChangeEffectRows,
  countAffectedFiles,
});
