function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function makeIssue({
  code,
  summary,
  detail = "",
  blocking = true,
  evidence = [],
  affectedSymbols = [],
  affectedFiles = [],
  interventions = [],
}) {
  return {
    code,
    type: code,
    summary,
    message: summary,
    detail,
    blocking,
    source: "ct-mcp",
    evidence,
    affectedSymbols,
    affectedFiles,
    interventions: interventions.length
      ? interventions
      : [
          {
            kind: "ct_mcp_repair",
            detail: "Regenerate the semantic output with a corrected ct_review_input block.",
          },
        ],
  };
}

function makeRecommendation(issue) {
  return {
    id: `ct.${issue.code}`,
    label: issue.interventions?.[0]?.detail ?? "Regenerate with corrected critical-thinking evidence",
    action: "regenerate_with_ct_review",
    source: "ct-mcp",
    reason: issue.summary,
  };
}

function relationCountsAsSupport(relation) {
  return ["supports", "implies", "requires"].includes(relation);
}

function hasEvidencePath(nodeId, incomingByTarget, nodeById, seen = new Set()) {
  if (seen.has(nodeId)) return false;
  seen.add(nodeId);

  for (const edge of incomingByTarget.get(nodeId) ?? []) {
    if (!relationCountsAsSupport(edge.relation)) continue;
    const source = nodeById.get(edge.from);
    if (!source) continue;
    if (["evidence", "assumption"].includes(source.type)) return true;
    if (hasEvidencePath(source.id, incomingByTarget, nodeById, seen)) return true;
  }

  return false;
}

function detectCycle(edges, nodeIds) {
  const graph = new Map([...nodeIds].map((id) => [id, []]));
  for (const edge of edges) {
    if (!relationCountsAsSupport(edge.relation)) continue;
    if (graph.has(edge.from) && graph.has(edge.to)) {
      graph.get(edge.from).push(edge.to);
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const path = [];

  function visit(nodeId) {
    if (visiting.has(nodeId)) {
      return [...path.slice(path.indexOf(nodeId)), nodeId];
    }
    if (visited.has(nodeId)) return null;
    visiting.add(nodeId);
    path.push(nodeId);
    for (const next of graph.get(nodeId) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
    return null;
  }

  for (const nodeId of nodeIds) {
    const cycle = visit(nodeId);
    if (cycle) return cycle;
  }
  return null;
}

function reviewReasoningChain(reasoningChain) {
  const issues = [];
  if (!isObject(reasoningChain)) {
    return [
      makeIssue({
        code: "ct_reasoning_input_missing",
        summary: "CT-MCP reasoning input is missing or malformed.",
        detail: "ct_review_input.reasoning_chain must contain nodes and edges.",
      }),
    ];
  }

  const nodes = asArray(reasoningChain.nodes);
  const edges = asArray(reasoningChain.edges);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodeById.keys());
  const incomingByTarget = new Map();

  for (const edge of edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      issues.push(
        makeIssue({
          code: "ct_reasoning_broken_edge",
          summary: "CT-MCP found a reasoning edge that references a missing node.",
          detail: `${edge.from ?? "?"} -> ${edge.to ?? "?"}`,
          blocking: true,
        }),
      );
      continue;
    }

    if (!incomingByTarget.has(edge.to)) incomingByTarget.set(edge.to, []);
    incomingByTarget.get(edge.to).push(edge);

    if (edge.relation === "contradicts") {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      issues.push(
        makeIssue({
          code: "ct_reasoning_contradiction",
          summary: "CT-MCP found contradictory semantic constraints.",
          detail: `${from?.label ?? edge.from} contradicts ${to?.label ?? edge.to}`,
          blocking: true,
          evidence: [
            {
              kind: "reasoning_edge",
              detail: `${edge.from} contradicts ${edge.to}`,
            },
          ],
          interventions: [
            {
              kind: "rewrite_constraints",
              detail: "Rewrite the request or proposal so the conflicting constraints are resolved before approval.",
            },
          ],
        }),
      );
    }
  }

  const cycle = detectCycle(edges, nodeIds);
  if (cycle) {
    issues.push(
      makeIssue({
        code: "ct_reasoning_cycle",
        summary: "CT-MCP found circular reasoning in the semantic claims.",
        detail: cycle.join(" -> "),
        blocking: true,
      }),
    );
  }

  for (const node of nodes) {
    if (node.type !== "conclusion") continue;
    if (!hasEvidencePath(node.id, incomingByTarget, nodeById)) {
      issues.push(
        makeIssue({
          code: "ct_orphaned_conclusion",
          summary: "CT-MCP found a conclusion without evidence or assumptions.",
          detail: node.label,
          blocking: true,
        }),
      );
    }
  }

  return issues;
}

function detectPlanCycle(stepsById) {
  const visiting = new Set();
  const visited = new Set();
  const path = [];

  function visit(stepId) {
    if (visiting.has(stepId)) {
      return [...path.slice(path.indexOf(stepId)), stepId];
    }
    if (visited.has(stepId)) return null;
    visiting.add(stepId);
    path.push(stepId);
    for (const dependencyId of asArray(stepsById.get(stepId)?.dependencies)) {
      if (!stepsById.has(dependencyId)) continue;
      const cycle = visit(dependencyId);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(stepId);
    visited.add(stepId);
    return null;
  }

  for (const stepId of stepsById.keys()) {
    const cycle = visit(stepId);
    if (cycle) return cycle;
  }
  return null;
}

function dependencyClosure(stepId, stepsById, seen = new Set()) {
  if (seen.has(stepId)) return seen;
  seen.add(stepId);
  for (const dependencyId of asArray(stepsById.get(stepId)?.dependencies)) {
    dependencyClosure(dependencyId, stepsById, seen);
  }
  return seen;
}

function reviewPlanSteps(planSteps) {
  const steps = asArray(planSteps);
  if (steps.length === 0) return [];

  const issues = [];
  const stepsById = new Map(steps.map((step) => [step.id, step]));

  for (const step of steps) {
    for (const dependencyId of asArray(step.dependencies)) {
      if (!stepsById.has(dependencyId)) {
        issues.push(
          makeIssue({
            code: "ct_plan_missing_dependency",
            summary: "CT-MCP found a plan step with a missing prerequisite.",
            detail: `${step.id} depends on missing step ${dependencyId}`,
            blocking: true,
          }),
        );
      }
    }
  }

  const cycle = detectPlanCycle(stepsById);
  if (cycle) {
    issues.push(
      makeIssue({
        code: "ct_plan_cycle",
        summary: "CT-MCP found a circular plan dependency.",
        detail: cycle.join(" -> "),
        blocking: true,
      }),
    );
  }

  for (let leftIndex = 0; leftIndex < steps.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < steps.length; rightIndex += 1) {
      const left = steps[leftIndex];
      const right = steps[rightIndex];
      const shared = asArray(left.resources).filter((resource) => asArray(right.resources).includes(resource));
      if (shared.length === 0) continue;
      const leftDependsOnRight = dependencyClosure(left.id, stepsById).has(right.id);
      const rightDependsOnLeft = dependencyClosure(right.id, stepsById).has(left.id);
      if (!leftDependsOnRight && !rightDependsOnLeft) {
        issues.push(
          makeIssue({
            code: "ct_plan_resource_conflict",
            summary: "CT-MCP found unordered plan steps sharing a resource.",
            detail: `${left.id} and ${right.id} both use ${shared.join(", ")}`,
            blocking: false,
            interventions: [
              {
                kind: "order_resource_access",
                detail: "Add an explicit dependency or split the shared resource mutation.",
              },
            ],
          }),
        );
      }
    }
  }

  return issues;
}

function reviewConfidence({ assumptions, confidenceScore, hasDestructiveSideEffects }) {
  const issues = [];

  if (hasDestructiveSideEffects && typeof confidenceScore === "number" && confidenceScore < 0.8) {
    issues.push(
      makeIssue({
        code: "ct_low_confidence_side_effect",
        summary: "CT-MCP blocked a side-effecting proposal with low confidence.",
        detail: `confidence=${confidenceScore}`,
        blocking: true,
        interventions: [
          {
            kind: "raise_evidence_or_scope_down",
            detail: "Add falsifiable evidence or narrow the proposal before approval.",
          },
        ],
      }),
    );
  }

  for (const assumption of asArray(assumptions)) {
    const confidence = Number(assumption?.confidence);
    const falsification = compactText(assumption?.falsification_condition);
    if (Number.isFinite(confidence) && confidence > 0.3 && !falsification) {
      issues.push(
        makeIssue({
          code: "ct_unfalsifiable_confidence",
          summary: "CT-MCP found an overconfident assumption without a falsification condition.",
          detail: assumption?.description ?? "No assumption description supplied.",
          blocking: true,
        }),
      );
    }
  }

  return issues;
}

function nearlyEqual(actual, expected, tolerance = 0.01) {
  const denominator = Math.max(1, Math.abs(expected));
  return Math.abs(actual - expected) / denominator <= tolerance;
}

function reviewNumericClaims(numericClaims) {
  const issues = [];

  for (const claim of asArray(numericClaims)) {
    const type = claim?.claim_type;
    const values = asArray(claim?.values).map(Number);
    let actual = null;

    if (type === "sum") actual = values.reduce((sum, value) => sum + value, 0);
    if (type === "product") actual = values.reduce((product, value) => product * value, 1);
    if (type === "percentage") actual = Number(claim.part) / Number(claim.whole) * 100;
    if (type === "weighted_average") {
      const weights = asArray(claim.weights).map(Number);
      actual = values.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0);
    }
    if (type === "growth") {
      actual = values[0] * ((1 + Number(claim.rate)) ** Number(claim.periods));
    }

    const expected = Number(claim?.claimed_result);
    if (actual != null && Number.isFinite(actual) && Number.isFinite(expected) && !nearlyEqual(actual, expected, Number(claim.tolerance ?? 0.01))) {
      issues.push(
        makeIssue({
          code: "ct_arithmetic_mismatch",
          summary: "CT-MCP found an arithmetic mismatch.",
          detail: `${type} claimed ${expected}, recomputed ${actual}`,
          blocking: true,
        }),
      );
    }
  }

  return issues;
}

function reviewConcurrency(concurrency) {
  if (!isObject(concurrency)) return [];

  const steps = asArray(concurrency.steps).map(compactText).filter(Boolean);
  const sharedResources = asArray(concurrency.shared_resources).map(compactText).filter(Boolean);
  const protections = asArray(concurrency.protections).map((item) => compactText(item).toLowerCase()).filter(Boolean);
  const joined = steps.join(" ").toLowerCase();
  const issues = [];

  const hasProtection = protections.some((entry) =>
    ["lock", "transaction", "idempotency", "idempotency key", "mutex", "serializable", "unique constraint"].some((term) => entry.includes(term)),
  );
  const hasReadModifyWrite =
    /\bread\b/.test(joined) &&
    /\b(write|update|modify|save)\b/.test(joined) &&
    sharedResources.length > 0;
  const hasCheckThenAct =
    /\b(if|check|when|unless)\b/.test(joined) &&
    /\b(approve|deploy|write|update|migrate|delete|send)\b/.test(joined) &&
    sharedResources.length > 0;

  if ((hasReadModifyWrite || hasCheckThenAct) && !hasProtection) {
    issues.push(
      makeIssue({
        code: "ct_concurrency_hazard",
        summary: "CT-MCP found a concurrency hazard without a deterministic protection.",
        detail: sharedResources.length ? `shared resources: ${sharedResources.join(", ")}` : "shared resource not specified",
        blocking: true,
        interventions: [
          {
            kind: "add_concurrency_protection",
            detail: "Add a transaction, lock, idempotency key, or explicit serialization before execution.",
          },
        ],
      }),
    );
  }

  return issues;
}

function hasDestructiveSideEffects(admittedOutput, extractedClaims) {
  if (typeof extractedClaims?.has_destructive_side_effects === "boolean") {
    return extractedClaims.has_destructive_side_effects;
  }
  if (typeof extractedClaims?.side_effects?.has_destructive_side_effects === "boolean") {
    return extractedClaims.side_effects.has_destructive_side_effects;
  }

  const operations = asArray(admittedOutput?.changes).map((change) => change?.operation);
  return (
    Boolean(admittedOutput?.workspace_path || admittedOutput?.diff_preview) ||
    operations.some((operation) => ["modify_file", "create_file", "delete_file", "rename_file"].includes(operation))
  );
}

function dedupeIssues(issues) {
  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.summary}:${issue.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function runCriticalReview(xplanNodeOrOptions, extractedClaimsArgument) {
  const options =
    arguments.length === 1 && isObject(xplanNodeOrOptions) && (
      Object.hasOwn(xplanNodeOrOptions, "admittedOutput") ||
      Object.hasOwn(xplanNodeOrOptions, "extractedClaims") ||
      Object.hasOwn(xplanNodeOrOptions, "xplanNode")
    )
      ? xplanNodeOrOptions
      : {
          xplanNode: xplanNodeOrOptions,
          extractedClaims: extractedClaimsArgument,
        };
  const xplanNode = options.xplanNode ?? options.node ?? {};
  const admittedOutput = options.admittedOutput ?? {};
  const extractedClaims = options.extractedClaims ?? admittedOutput?.ct_review_input;
  const report = {
    issues: [],
    riskFlags: [],
    isBlocked: false,
    recommendations: [],
    evidence: [],
    metrics: {
      issueCount: 0,
      blockingIssueCount: 0,
    },
  };

  if (!isObject(extractedClaims)) {
    report.issues.push(
      makeIssue({
        code: "ct_review_input_missing",
        summary: "The semantic output did not include a structured CT-MCP review input.",
        detail: "ct_review_input is required for deterministic critical review.",
        blocking: true,
      }),
    );
  } else {
    report.issues.push(
      ...reviewReasoningChain(extractedClaims.reasoning_chain),
      ...reviewPlanSteps(extractedClaims.plan_steps),
      ...reviewConfidence({
        assumptions: extractedClaims.assumptions,
        confidenceScore:
          typeof xplanNode.confidenceScore === "number"
            ? xplanNode.confidenceScore
            : typeof xplanNode.confidence_score === "number"
              ? xplanNode.confidence_score
              : typeof extractedClaims.confidence_score === "number"
                ? extractedClaims.confidence_score
                : null,
        hasDestructiveSideEffects: hasDestructiveSideEffects(admittedOutput, extractedClaims),
      }),
      ...reviewNumericClaims(extractedClaims.numeric_claims),
      ...reviewConcurrency(extractedClaims.concurrency),
    );
  }

  report.issues = dedupeIssues(report.issues);
  report.isBlocked = report.issues.some((issue) => issue.blocking);
  report.riskFlags = report.issues.map((issue) => issue.code);
  report.recommendations = report.issues.map(makeRecommendation);
  report.evidence = report.issues.flatMap((issue) => asArray(issue.evidence));
  report.metrics = {
    issueCount: report.issues.length,
    blockingIssueCount: report.issues.filter((issue) => issue.blocking).length,
  };

  return report;
}
