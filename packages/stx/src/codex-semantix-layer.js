import { randomUUID } from "node:crypto";

function compactText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function hasAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function classifyConfidence(effort, riskLevel) {
  if (riskLevel === "high" || effort === "high") {
    return 0.58;
  }

  if (riskLevel === "medium" || effort === "medium") {
    return 0.72;
  }

  return 0.88;
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

export function classifyCodexRequest({
  primaryDirective,
  strictBoundaries = [],
  successState,
} = {}) {
  const taskText = compactText([
    primaryDirective,
    successState,
  ].join(" ")).toLowerCase();

  const reasons = [];
  const suggestedSteps = ["Fast classification"];
  let effortScore = 0;
  let riskScore = 0;

  if (hasAny(taskText, ["add", "build", "create", "implement", "refactor", "modify", "wire"])) {
    effortScore += 1;
    suggestedSteps.push("Code proposal");
    reasons.push("Code generation or modification task detected.");
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

  if (Array.isArray(strictBoundaries) && strictBoundaries.length > 0) {
    effortScore += 1;
    suggestedSteps.push("Constraint validation");
    reasons.push("Explicit boundaries require validation.");
  }

  const effort =
    effortScore >= 5 ? "high" : effortScore >= 2 ? "medium" : "low";
  const riskLevel =
    riskScore >= 3 ? "high" : riskScore >= 1 ? "medium" : "low";
  const confidenceScore = classifyConfidence(effort, riskLevel);

  return {
    complexity: effort,
    effort,
    riskLevel,
    confidenceScore,
    confidenceBand: normalizeBand(confidenceScore),
    reasons:
      reasons.length > 0
        ? reasons
        : ["No high-risk keywords or external side effects detected."],
    suggestedSteps: unique([
      ...suggestedSteps,
      "Structured Semantix review",
      "Approval-gated execution",
    ]),
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

  return [
    {
      id: `review.${issue.code}`,
      label: "Review and regenerate proposal",
      action: "regenerate_with_constraints",
      recommended: true,
    },
    {
      id: `manual.${issue.code}`,
      label: "Escalate for manual decision",
      action: "manual_intervention",
      recommended: false,
    },
  ];
}

function collectInspectorIssues(inspectors) {
  const issues = [];

  for (const inspector of Object.values(inspectors)) {
    const nodeId = inspector?.node?.id;
    const rawIssues = [
      ...(Array.isArray(inspector?.issues) ? inspector.issues : []),
      ...(Array.isArray(inspector?.critique?.issues) ? inspector.critique.issues : []),
    ];

    for (const issue of rawIssues) {
      issues.push(normalizeIssue(issue, nodeId));
    }
  }

  const seen = new Set();
  return issues.filter((issue) => {
    const key = `${issue.nodeId}:${issue.code}:${issue.summary}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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

function buildExecutionProgress(artifact) {
  const labels = [
    {
      id: "plan",
      label: "Plan",
      done: Boolean(artifact?.plan?.nodes?.length),
    },
    {
      id: "code",
      label: "Code",
      done: (artifact?.plan?.nodes ?? []).some(
        (node) => isSemanticGenerationNode(node) && node.executionStatus === "succeeded",
      ),
    },
    {
      id: "validate",
      label: "Validate",
      done: materialStateEffects(artifact).length > 0,
    },
    {
      id: "execute",
      label: "Execute",
      done: artifact?.plan?.status === "completed",
    },
  ];

  const current = labels.find((entry) => !entry.done);
  return labels.map((entry) => ({
    ...entry,
    current: current?.id === entry.id,
  }));
}

function resolvePhase({ artifact, issues, approval }) {
  if (artifact?.plan?.status === "completed") {
    return "completed";
  }

  if (artifact?.plan?.status === "failed") {
    return "failed";
  }

  if (issues.some((issue) => issue.blocking)) {
    return "needs_intervention";
  }

  if (approval.ready) {
    return "awaiting_approval";
  }

  if (artifact?.plan?.status === "running") {
    return "executing";
  }

  return "reviewing";
}

function buildDemoSteps({ artifact, issues, approval }) {
  const runtimeNode = getRuntimeNode(artifact);
  const hasPlan = (artifact?.plan?.nodes ?? []).length > 0;
  const hasPreview = materialStateEffects(artifact).length > 0;
  const hasIssues = issues.length > 0;
  const hasBlockingIssues = issues.some((issue) => issue.blocking);
  const completed = artifact?.plan?.status === "completed";

  return [
    { id: 1, label: "Input", status: "complete" },
    { id: 2, label: "Fast Classification", status: "complete" },
    { id: 3, label: "Plan Appears", status: hasPlan ? "complete" : "pending" },
    {
      id: 4,
      label: "Issue Detection",
      status: hasIssues ? (hasBlockingIssues ? "blocked" : "warning") : hasPreview ? "complete" : "pending",
    },
    { id: 5, label: "Effort Indicator", status: "complete" },
    { id: 6, label: "Why? Explanation", status: "available" },
    {
      id: 7,
      label: "Fix Issues",
      status: hasBlockingIssues ? "required" : hasIssues ? "optional" : "complete",
    },
    {
      id: 8,
      label: "Re-evaluation",
      status: hasBlockingIssues ? "blocked" : hasPreview ? "complete" : "pending",
    },
    { id: 9, label: "Advanced View", status: hasPlan ? "available" : "pending" },
    {
      id: 10,
      label: "Approval",
      status: approval.approved || completed ? "complete" : approval.ready ? "ready" : "pending",
    },
    {
      id: 11,
      label: "Execution",
      status:
        completed
          ? "complete"
          : artifact?.plan?.status === "running" || runtimeNode?.executionStatus === "running"
            ? "running"
            : "pending",
    },
    { id: 12, label: "Result", status: completed ? "complete" : "pending" },
  ];
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

function buildResult(artifact) {
  const completed = artifact?.plan?.status === "completed";
  const effects = materialStateEffects(artifact);
  const filesUpdated = unique(effects.flatMap(stateEffectTargets));

  return {
    completed,
    filesUpdated,
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
  const issues = collectInspectorIssues(inspectors);
  const approval = buildApproval(artifact, issues);
  const result = buildResult(artifact);
  const phase = resolvePhase({
    artifact,
    issues,
    approval,
  });
  const effectiveClassification =
    classification ??
    classifyCodexRequest({
      primaryDirective: artifact.intent?.primaryDirective,
      strictBoundaries: artifact.intent?.strictBoundaries,
      successState: artifact.intent?.successState,
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
    classification: effectiveClassification,
    plan: {
      status: artifact.plan?.status,
      items: buildPlanItems(artifact),
    },
    issues: issues.map((issue) => ({
      ...issue,
      fixOptions: fixOptionsForIssue(issue),
    })),
    approval,
    advanced: {
      graph: buildGraph(artifact),
      selectedNodeId:
        getDeterministicNode(artifact)?.id ??
        getRuntimeNode(artifact)?.id ??
        artifact.plan?.nodes?.[0]?.id ??
        null,
      inspectors,
    },
    execution: {
      status: artifact.plan?.status ?? "unknown",
      progress: buildExecutionProgress(artifact),
    },
    result,
    steps: buildDemoSteps({
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

export class CodexSemantixLayer {
  constructor({
    service,
    defaultCwd,
    defaultActor = "operator",
  } = {}) {
    if (!service) {
      throw new Error("CodexSemantixLayer requires a ControlPlaneService.");
    }

    this.service = service;
    this.defaultCwd = defaultCwd;
    this.defaultActor = defaultActor;
  }

  classify(input) {
    return classifyCodexRequest(input);
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
    if (!compactText(primaryDirective)) {
      throw new Error("CodexSemantixLayer.start requires primaryDirective.");
    }

    const classification = this.classify({
      primaryDirective,
      strictBoundaries,
      successState,
    });

    const artifact = await this.service.bootstrapRun({
      runId,
      actor,
      primaryDirective: compactText(primaryDirective),
      strictBoundaries: Array.isArray(strictBoundaries) ? strictBoundaries : [],
      successState: compactText(successState) || defaultSuccessState(primaryDirective),
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
