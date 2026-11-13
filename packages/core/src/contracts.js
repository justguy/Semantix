import { createHash, randomUUID } from "node:crypto";

const DEFAULT_RUNTIME_ID = "codex_cli";
const DEFAULT_RUNTIME_KIND = "cli_runtime";

/**
 * @typedef {"semantix" | "phalanx" | "hoplon" | "ct_mcp" | "llm_tracker" | "guardrail"} SystemId
 */

/**
 * @typedef {"grounded" | "transformed" | "bridged" | "unsupported"} GroundingLabel
 */

/**
 * @typedef {"high" | "medium" | "low"} ConfidenceBand
 */

/**
 * @typedef {"draft" | "pending_review" | "approved" | "rejected" | "modified" | "stale"} IntentStatus
 */

/**
 * @typedef {"fresh" | "stale" | "superseded"} FreshnessState
 */

/**
 * @typedef {"draft" | "pending_review" | "approved_for_execution" | "running" | "paused" | "completed" | "failed" | "stale"} PlanStatus
 */

/**
 * @typedef {"ready" | "warning" | "blocked" | "approved" | "stale"} ReviewStatus
 */

/**
 * @typedef {"not_started" | "queued" | "running" | "succeeded" | "failed" | "paused"} ExecutionStatus
 */

/**
 * @typedef {"semantic" | "deterministic" | "tool" | "policy_gate" | "approval"} ExecutionNodeType
 */

/**
 * @typedef {"file" | "api" | "database" | "external_action"} StateEffectKind
 */

/**
 * @typedef {"pass" | "block" | "review_required"} PolicyState
 */

/**
 * @typedef {"reversible" | "reversible_within_window" | "irreversible"} ReversibilityStatus
 */

/**
 * @typedef {"pending" | "approved" | "rejected" | "stale"} ApprovalStatus
 */

/**
 * @typedef {"low" | "medium" | "high"} RiskSeverity
 */

/**
 * @typedef {"policy" | "provenance" | "critique" | "runtime" | "system" | "verifier"} RiskSource
 */

/**
 * @typedef {"run.created" | "artifact.generated" | "node.updated" | "state_effect.available" | "risk.detected" | "approval.required" | "approval.accepted" | "approval.rejected" | "approval.stale" | "checkpoint.created" | "run.paused" | "run.resumed" | "run.completed" | "run.failed" | "session.created" | "session.updated" | "session.cancelled" | "turn.accepted" | "turn.started" | "turn.output.delta" | "turn.completed" | "turn.failed" | "turn.interrupted"} RunEventType
 */

/**
 * @typedef {"schema" | "path_policy" | "capability" | "approval" | "verifier" | "provenance" | "runtime"} ConstraintFailureClass
 */

/**
 * @typedef {"hard" | "soft"} ConstraintFailureSeverity
 */

/**
 * @typedef {{
 *   format?: "json" | "text" | "markdown" | "code" | "custom",
 *   jsonSchema?: object,
 *   requiredFields?: string[],
 *   forbiddenFields?: string[],
 *   parser?: string
 * }} ConstraintSchemaPolicy
 */

/**
 * @typedef {{
 *   root?: string,
 *   allow?: string[],
 *   deny?: string[],
 *   operations?: string[]
 * }} ConstraintPathPolicy
 */

/**
 * @typedef {{
 *   required?: string[],
 *   forbidden?: string[],
 *   approvalRequired?: string[]
 * }} ConstraintCapabilityPolicy
 */

/**
 * @typedef {{
 *   required: boolean,
 *   gateId?: string,
 *   reason?: string,
 *   freshness?: "artifact" | "node" | "state_effect"
 * }} ConstraintApprovalPolicy
 */

/**
 * @typedef {{
 *   maxAttempts: number,
 *   retryOn?: string[],
 *   failOn?: string[],
 *   repairInstructions?: string
 * }} ConstraintRetryPolicy
 */

/**
 * @typedef {"groundedness" | "entailment" | "contradiction" | "similarity" | "custom"} VerifierCheckKind
 */

/**
 * @typedef {"gte" | "lte"} VerifierComparator
 */

/**
 * @typedef {"pass" | "concern" | "block" | "review_required"} VerifierAdvisoryState
 */

/**
 * @typedef {{
 *   id: string,
 *   kind: VerifierCheckKind,
 *   threshold?: number,
 *   comparator?: VerifierComparator,
 *   failureSeverity?: ConstraintFailureSeverity,
 *   description?: string
 * }} ConstraintVerifierCheckPolicy
 */

/**
 * @typedef {{
 *   mode: "none" | "advisory" | "required",
 *   checks?: ConstraintVerifierCheckPolicy[]
 * }} ConstraintVerifierPolicy
 */

/**
 * @typedef {{
 *   runId?: string,
 *   nodeId?: string,
 *   constraintIrId?: string,
 *   target?: object,
 *   subject: unknown,
 *   reference?: unknown,
 *   context?: object,
 *   checks: ConstraintVerifierCheckPolicy[]
 * }} VerifierInput
 */

/**
 * @typedef {{
 *   id?: string,
 *   kind: VerifierCheckKind,
 *   score?: number,
 *   passed?: boolean,
 *   confidence?: number,
 *   advisoryState?: VerifierAdvisoryState,
 *   severity?: VerifierAdvisoryState,
 *   message?: string,
 *   evidence?: unknown[]
 * }} VerifierCheckResult
 */

/**
 * @typedef {{
 *   providerId?: string,
 *   status?: "available" | "unavailable" | "error",
 *   checks?: VerifierCheckResult[],
 *   error?: string,
 *   latencyMs?: number
 * }} VerifierResult
 */

/**
 * @typedef {{
 *   required: boolean,
 *   sources?: string[],
 *   evidenceRefs?: string[],
 *   attachToOutput?: boolean
 * }} ConstraintProvenancePolicy
 */

/**
 * @typedef {{
 *   code: string,
 *   class: ConstraintFailureClass,
 *   severity: ConstraintFailureSeverity,
 *   retryable: boolean,
 *   message: string
 * }} ConstraintFailurePolicy
 */

/**
 * Durable Phase 2 IR emitted from context, constraint, and ~> lowering.
 * This is a contract shell only; compiler slices attach executable artifacts
 * such as concrete validators and policy functions in later tasks.
 *
 * @typedef {{
 *   id: string,
 *   version: number,
 *   sourceRef: string,
 *   target: {
 *     kind: "semantic_output" | "state_effect" | "tool_call" | "runtime_node",
 *     nodeId?: string,
 *     outputRef?: string,
 *     stateEffectId?: string
 *   },
 *   schema?: ConstraintSchemaPolicy,
 *   pathPolicy?: ConstraintPathPolicy,
 *   capabilities?: ConstraintCapabilityPolicy,
 *   approval?: ConstraintApprovalPolicy,
 *   retry?: ConstraintRetryPolicy,
 *   verifier?: ConstraintVerifierPolicy,
 *   provenance?: ConstraintProvenancePolicy,
 *   failure?: {
 *     defaultSeverity: ConstraintFailureSeverity,
 *     classes: ConstraintFailurePolicy[]
 *   },
 *   compiledArtifacts?: {
 *     schemaValidatorRef?: string,
 *     fieldValidatorRef?: string,
 *     pathPolicyRef?: string,
 *     approvalMarkerRef?: string,
 *     retryPolicyRef?: string,
 *     failurePolicyRef?: string,
 *     verifierRef?: string,
 *     constrainedDecoderRef?: string
 *   }
 * }} ConstraintIR
 */

export const CONSTRAINT_IR_VERSION = 1;

/**
 * @typedef {{
 *   hard?: string[],
 *   soft?: string[],
 *   reviewerNote?: string
 * }} ConstraintSet
 */

/**
 * @typedef {{
 *   tools?: string[],
 *   permissions?: string[],
 *   runtimeIds?: string[]
 * }} CapabilityScope
 */

/**
 * @typedef {{
 *   runtimeId: string,
 *   family: "cli_runtime" | "provider_backed_runtime" | "domain_runtime",
 *   displayName?: string
 * }} RuntimeTarget
 */

/**
 * @typedef {{
 *   id: string,
 *   primaryDirective: string,
 *   strictBoundaries: string[],
 *   successState: string,
 *   status: IntentStatus,
 *   planVersion: number,
 *   contractVersion: number,
 *   artifactHash: string
 * }} IntentContract
 */

/**
 * @typedef {{
 *   from: string,
 *   to: string
 * }} ExecutionEdge
 */

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   nodeType: ExecutionNodeType,
 *   revision: number,
 *   dependsOn: string[],
 *   gatingOwner: SystemId,
 *   contributingSystems: SystemId[],
 *   reviewStatus: ReviewStatus,
 *   executionStatus: ExecutionStatus,
 *   grounding?: GroundingLabel,
 *   confidenceBand?: ConfidenceBand,
 *   confidenceScore?: number,
 *   confidenceSignals?: {
 *     provenanceStrength: number,
 *     verifierAgreement: number,
 *     retryStability: number,
 *     changeSafety: number
 *   },
 *   sourceCount?: number,
 *   riskFlags: string[],
 *   approvalRequired: boolean,
 *   inputSummary?: string,
 *   outputSummary?: string,
 *   constraints?: ConstraintSet,
 *   constraintIrRefs?: string[],
 *   capabilityScope?: CapabilityScope,
 *   runtimeBinding?: RuntimeTarget
 * }} ExecutionNode
 */

/**
 * @typedef {{
 *   id: string,
 *   kind: StateEffectKind,
 *   operation: string,
 *   target: string,
 *   summary: string,
 *   previewRef?: string,
 *   policyState: PolicyState,
 *   riskFlags: string[],
 *   reversibility: {
 *     status: ReversibilityStatus,
 *     mechanism?: string,
 *     windowSeconds?: number
 *   },
 *   enforcement: {
 *     owner: "phalanx" | "hoplon" | "policy",
 *     status: PolicyState,
 *     details?: string
 *   },
 *   constraintIrRefs?: string[]
 * }} StateEffect
 */

/**
 * @typedef {{
 *   id: string,
 *   targetNodeId?: string,
 *   required: boolean,
 *   status: ApprovalStatus,
 *   planVersion: number,
 *   artifactHash: string,
 *   nodeRevision?: number,
 *   reason?: string
 * }} ApprovalGate
 */

/**
 * @typedef {{
 *   id: string,
 *   runId: string,
 *   planVersion: number,
 *   artifactHash: string,
 *   afterNodeId?: string,
 *   createdAt: number,
 *   reason?: string,
 *   status?: "available" | "consumed"
 * }} ResumeCheckpoint
 */

/**
 * @typedef {{
 *   id: string,
 *   nodeId?: string,
 *   severity: RiskSeverity,
 *   message: string,
 *   source: RiskSource
 * }} RiskSignal
 */

/**
 * @typedef {{
 *   id: string,
 *   kind: StateEffectKind,
 *   operation: string,
 *   target: string,
 *   summary: string,
 *   previewRef?: string,
 *   policyState: PolicyState,
 *   riskFlags: string[],
 *   reversibility: StateEffect["reversibility"],
 *   enforcement: StateEffect["enforcement"]
 * }} ProposedChange
 */

/**
 * @typedef {{
 *   node: ExecutionNode,
 *   overview?: object,
 *   context?: object,
 *   constraints?: object,
 *   outputPreview?: object,
 *   critique?: object,
 *   tooling?: object,
 *   proposedChanges?: ProposedChange[],
 *   approvals?: object,
 *   replay?: object,
 *   audit?: object
 * }} NodeInspectorPayload
 */

/**
 * @typedef {{
 *   id: string,
 *   runtimeKind: string,
 *   planVersion: number,
 *   graphVersion: number,
 *   artifactHash: string,
 *   intent: IntentContract,
 *   nodes: ExecutionNode[],
 *   edges: ExecutionEdge[],
 *   approvalGates: ApprovalGate[],
 *   stateEffects: StateEffect[],
 *   constraintIRs?: ConstraintIR[],
 *   checkpoints: ResumeCheckpoint[],
 *   status: PlanStatus
 * }} ExecutionPlan
 */

/**
 * @typedef {{
 *   artifactId: string,
 *   runId: string,
 *   planVersion: number,
 *   graphVersion: number,
 *   artifactHash: string,
 *   generatedAt: number,
 *   freshnessState: FreshnessState,
 *   intent: IntentContract,
 *   plan: ExecutionPlan
 * }} ReviewArtifact
 */

/**
 * @typedef {{
 *   sessionId: string,
 *   runId: string,
 *   nodeId: string,
 *   runtimeId: string,
 *   runtimeSessionId: string,
 *   planVersion: number,
 *   artifactHash: string,
 *   nodeRevision: number,
 *   status: "starting" | "waiting_for_input" | "running" | "paused" | "failed" | "cancelled" | "completed",
 *   activeTurnId?: string | null,
 *   turnCount: number,
 *   createdAt: number,
 *   updatedAt: number,
 *   completedAt?: number | null,
 *   error?: { message: string } | null,
 *   preview?: string,
 *   lastTurnSummary?: string | null
 * }} RuntimeSession
 */

/**
 * @typedef {{
 *   turnId: string,
 *   sessionId: string,
 *   runId: string,
 *   sequence: number,
 *   clientTurnId?: string,
 *   runtimeTurnId?: string | null,
 *   status: "accepted" | "running" | "completed" | "failed" | "interrupted",
 *   role: "user" | "assistant" | "system",
 *   input: Array<{
 *     type: "text" | "image" | "localImage" | "skill" | "mention",
 *     text?: string,
 *     url?: string,
 *     path?: string,
 *     name?: string,
 *     text_elements?: object[]
 *   }>,
 *   startedAt?: number | null,
 *   completedAt?: number | null,
 *   resultSummary?: string | null,
 *   error?: { message: string } | null
 * }} SessionTurn
 */

/**
 * @typedef {{
 *   timestamp: number,
 *   eventId?: string,
 *   sequence?: number,
 *   runId: string,
 *   type: RunEventType,
 *   nodeId?: string,
 *   sessionId?: string,
 *   turnId?: string,
 *   runtimeSessionId?: string,
 *   planVersion?: number,
 *   artifactHash?: string,
 *   payload?: unknown
 * }} RunEvent
 */

export class SemantixError extends Error {
  constructor(message, code = "SEMANTIX_ERROR", details = undefined) {
    super(message);
    this.name = "SemantixError";
    this.code = code;
    this.details = details;
  }
}

export class StaleStateError extends SemantixError {
  constructor(message, details) {
    super(message, "STALE_STATE", details);
    this.name = "StaleStateError";
  }
}

export class NotFoundError extends SemantixError {
  constructor(message, details) {
    super(message, "NOT_FOUND", details);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends SemantixError {
  constructor(message, details) {
    super(message, "VALIDATION_ERROR", details);
    this.name = "ValidationError";
  }
}

export function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
    .join(",")}}`;
}

export function createArtifactHash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function createConstraintIR({
  id,
  sourceRef,
  target,
  version = CONSTRAINT_IR_VERSION,
  schema,
  pathPolicy,
  capabilities,
  approval = { required: false },
  retry = { maxAttempts: 0 },
  verifier = { mode: "none" },
  provenance = { required: false },
  failure = {
    defaultSeverity: "hard",
    classes: [],
  },
  compiledArtifacts = {},
} = {}) {
  if (!id || typeof id !== "string") {
    throw new ValidationError("createConstraintIR requires a string id.");
  }
  if (!sourceRef || typeof sourceRef !== "string") {
    throw new ValidationError("createConstraintIR requires a sourceRef.");
  }
  if (!target || typeof target !== "object" || !target.kind) {
    throw new ValidationError("createConstraintIR requires a target.kind.");
  }

  return {
    id,
    version,
    sourceRef,
    target: cloneJson(target),
    ...(schema ? { schema: cloneJson(schema) } : {}),
    ...(pathPolicy ? { pathPolicy: cloneJson(pathPolicy) } : {}),
    ...(capabilities ? { capabilities: cloneJson(capabilities) } : {}),
    approval: cloneJson(approval),
    retry: cloneJson(retry),
    verifier: cloneJson(verifier),
    provenance: cloneJson(provenance),
    failure: cloneJson(failure),
    compiledArtifacts: cloneJson(compiledArtifacts),
  };
}

export function createConstraintIRIdentity(ir) {
  if (!ir || typeof ir !== "object") {
    throw new ValidationError("createConstraintIRIdentity requires a ConstraintIR object.");
  }
  return createArtifactHash(ir);
}

const VERIFIER_CHECK_KINDS = new Set([
  "groundedness",
  "entailment",
  "contradiction",
  "similarity",
  "custom",
]);

function normalizeVerifierCheckKind(kind, details = {}) {
  if (!VERIFIER_CHECK_KINDS.has(kind)) {
    throw new ValidationError("Verifier check kind is not supported.", {
      ...details,
      kind,
      supportedKinds: [...VERIFIER_CHECK_KINDS],
    });
  }
  return kind;
}

function defaultVerifierComparator(kind) {
  return kind === "contradiction" ? "lte" : "gte";
}

function defaultVerifierThreshold(kind) {
  return kind === "contradiction" ? 0.2 : 0.7;
}

function normalizeConstraintVerifierCheck(check, index = 0, details = {}) {
  if (!check || typeof check !== "object") {
    throw new ValidationError("Verifier checks must be objects.", {
      ...details,
      index,
    });
  }
  if (!check.id || typeof check.id !== "string") {
    throw new ValidationError("Verifier checks require a string id.", {
      ...details,
      index,
    });
  }

  const kind = normalizeVerifierCheckKind(check.kind, {
    ...details,
    checkId: check.id,
  });
  const comparator = check.comparator ?? defaultVerifierComparator(kind);
  if (!["gte", "lte"].includes(comparator)) {
    throw new ValidationError("Verifier check comparator must be gte or lte.", {
      ...details,
      checkId: check.id,
      comparator,
    });
  }
  const threshold = check.threshold ?? defaultVerifierThreshold(kind);
  if (typeof threshold !== "number" || Number.isNaN(threshold)) {
    throw new ValidationError("Verifier check threshold must be numeric.", {
      ...details,
      checkId: check.id,
      threshold,
    });
  }

  return {
    id: check.id,
    kind,
    threshold,
    comparator,
    failureSeverity: check.failureSeverity === "hard" ? "hard" : "soft",
    ...(check.description ? { description: check.description } : {}),
  };
}

function normalizeConstraintVerifierPolicy(policy = { mode: "none" }, details = {}) {
  const mode = policy?.mode ?? "none";
  if (!["none", "advisory", "required"].includes(mode)) {
    throw new ValidationError("Verifier policy mode must be none, advisory, or required.", {
      ...details,
      mode,
    });
  }

  return {
    mode,
    checks: (policy?.checks ?? []).map((check, index) =>
      normalizeConstraintVerifierCheck(check, index, details),
    ),
  };
}

function findVerifierCheckResult(providerResult, policyCheck) {
  const checks = Array.isArray(providerResult?.checks) ? providerResult.checks : [];
  return (
    checks.find((check) => check?.id === policyCheck.id) ??
    checks.find((check) => check?.kind === policyCheck.kind) ??
    null
  );
}

function verifierCheckPassed(policyCheck, checkResult) {
  if (typeof checkResult?.score === "number") {
    if (Number.isNaN(checkResult.score)) {
      return false;
    }
    return policyCheck.comparator === "gte"
      ? checkResult.score >= policyCheck.threshold
      : checkResult.score <= policyCheck.threshold;
  }

  if (typeof checkResult?.passed === "boolean") {
    return checkResult.passed;
  }

  return false;
}

function verifierFailurePolicyState(mode, failureSeverity) {
  if (mode === "none") {
    return "pass";
  }
  if (mode === "required" && failureSeverity === "hard") {
    return "block";
  }
  return "review_required";
}

/**
 * Builds the direct provider hook payload. The provider can only return evidence;
 * callers must feed the result through applyVerifierPolicy before affecting plan state.
 */
export function createVerifierInput({
  runId,
  node,
  constraintIR,
  subject,
  reference,
  context = {},
  checks,
} = {}) {
  const policy = normalizeConstraintVerifierPolicy(
    constraintIR?.verifier ?? { mode: "advisory", checks: checks ?? [] },
    {
      runId,
      nodeId: node?.id ?? constraintIR?.target?.nodeId,
      constraintIrId: constraintIR?.id,
    },
  );
  const verifierChecks = (checks ?? policy.checks).map((check, index) =>
    normalizeConstraintVerifierCheck(check, index, {
      runId,
      nodeId: node?.id ?? constraintIR?.target?.nodeId,
      constraintIrId: constraintIR?.id,
    }),
  );

  if (verifierChecks.length === 0) {
    throw new ValidationError("Verifier input requires at least one check.", {
      runId,
      nodeId: node?.id ?? constraintIR?.target?.nodeId,
      constraintIrId: constraintIR?.id,
    });
  }

  return {
    runId,
    nodeId: node?.id ?? constraintIR?.target?.nodeId,
    constraintIrId: constraintIR?.id,
    target: cloneJson(constraintIR?.target),
    subject: cloneJson(subject),
    reference: cloneJson(reference),
    context: cloneJson(context),
    checks: cloneJson(verifierChecks),
  };
}

/**
 * Converts provider verifier output into Semantix-owned policy evidence.
 * Provider advisory states never directly set policyState.
 */
export function applyVerifierPolicy({
  policy = { mode: "none" },
  providerResult,
  providerId = providerResult?.providerId,
  details = {},
} = {}) {
  const verifierPolicy = normalizeConstraintVerifierPolicy(policy, details);
  const resolvedProviderId = providerId ?? "unknown_verifier";

  if (verifierPolicy.mode === "none") {
    return {
      status: "pass",
      policyState: "pass",
      enforcement: {
        owner: "policy",
        status: "pass",
        details: "Verifier policy is disabled; provider evidence is ignored.",
      },
      evidence: [],
      riskFlags: [],
      advisory: true,
    };
  }

  if (!providerResult || ["unavailable", "error"].includes(providerResult.status)) {
    const policyState = verifierFailurePolicyState(verifierPolicy.mode, "hard");
    return {
      status: "unavailable",
      policyState,
      enforcement: {
        owner: "policy",
        status: policyState,
        details: `Verifier provider '${resolvedProviderId}' was unavailable; Semantix policy selected ${policyState}.`,
      },
      evidence: [
        {
          kind: "verifier_unavailable",
          source: "verifier",
          providerId: resolvedProviderId,
          providerStatus: providerResult?.status ?? "unavailable",
          message: providerResult?.error ?? "Verifier provider unavailable.",
          policyState,
        },
      ],
      riskFlags: ["verifier_unavailable"],
      advisory: true,
    };
  }

  const evidence = [];
  let policyState = "pass";

  for (const policyCheck of verifierPolicy.checks) {
    const checkResult = findVerifierCheckResult(providerResult, policyCheck);
    const passed = checkResult ? verifierCheckPassed(policyCheck, checkResult) : false;
    const nextPolicyState = passed
      ? "pass"
      : verifierFailurePolicyState(verifierPolicy.mode, policyCheck.failureSeverity);
    if (nextPolicyState === "block" || (nextPolicyState === "review_required" && policyState === "pass")) {
      policyState = nextPolicyState;
    }

    evidence.push({
      kind: "verifier_check",
      source: "verifier",
      providerId: resolvedProviderId,
      checkId: policyCheck.id,
      checkKind: policyCheck.kind,
      score: checkResult?.score,
      threshold: policyCheck.threshold,
      comparator: policyCheck.comparator,
      passed,
      failureSeverity: policyCheck.failureSeverity,
      providerAdvisoryState:
        checkResult?.advisoryState ?? checkResult?.severity ?? (passed ? "pass" : "concern"),
      policyState: nextPolicyState,
      message:
        checkResult?.message ??
        (checkResult ? "Verifier check evaluated by Semantix policy." : "Verifier check result was missing."),
      providerEvidence: cloneJson(checkResult?.evidence ?? []),
    });
  }

  return {
    status:
      policyState === "block"
        ? "block"
        : policyState === "review_required"
          ? "concern"
          : "pass",
    policyState,
    enforcement: {
      owner: "policy",
      status: policyState,
      details: `Verifier provider '${resolvedProviderId}' supplied advisory evidence; Semantix policy selected ${policyState}.`,
    },
    evidence,
    riskFlags:
      policyState === "block"
        ? ["verifier_block"]
        : policyState === "review_required"
          ? ["verifier_concern"]
          : [],
    advisory: true,
  };
}

export function makeEvent({
  runId,
  type,
  timestamp = Date.now(),
  eventId,
  sequence,
  nodeId,
  sessionId,
  turnId,
  runtimeSessionId,
  planVersion,
  artifactHash,
  payload,
}) {
  return {
    eventId,
    sequence,
    timestamp,
    runId,
    type,
    nodeId,
    sessionId,
    turnId,
    runtimeSessionId,
    planVersion,
    artifactHash,
    payload,
  };
}

export function createIntentContract({
  runId,
  primaryDirective,
  strictBoundaries = [],
  successState,
  status = "draft",
  planVersion = 0,
  contractVersion = 1,
  artifactHash = "pending",
}) {
  return {
    id: `intent.${runId}`,
    primaryDirective,
    strictBoundaries,
    successState,
    status,
    planVersion,
    contractVersion,
    artifactHash,
  };
}

export function createCheckpoint({
  runId,
  planVersion,
  artifactHash,
  afterNodeId,
  reason,
  createdAt = Date.now(),
  status = "available",
  id = `checkpoint.${runId}.${afterNodeId ?? "root"}.${createdAt}`,
}) {
  return {
    id,
    runId,
    planVersion,
    artifactHash,
    afterNodeId,
    createdAt,
    reason,
    status,
  };
}

export function createRuntimeSession({
  sessionId = `session.${randomUUID()}`,
  runId,
  nodeId,
  runtimeId = DEFAULT_RUNTIME_ID,
  runtimeSessionId,
  planVersion,
  artifactHash,
  nodeRevision,
  status = "waiting_for_input",
  activeTurnId = null,
  turnCount = 0,
  createdAt = Date.now(),
  updatedAt = createdAt,
  completedAt = null,
  error = null,
  preview = "",
  lastTurnSummary = null,
}) {
  return {
    sessionId,
    runId,
    nodeId,
    runtimeId,
    runtimeSessionId,
    planVersion,
    artifactHash,
    nodeRevision,
    status,
    activeTurnId,
    turnCount,
    createdAt,
    updatedAt,
    completedAt,
    error,
    preview,
    lastTurnSummary,
  };
}

export function createSessionTurn({
  turnId,
  sessionId,
  runId,
  sequence,
  clientTurnId,
  runtimeTurnId = null,
  status = "accepted",
  role = "user",
  input = [],
  startedAt = null,
  completedAt = null,
  resultSummary = null,
  error = null,
}) {
  return {
    turnId: turnId ?? `turn.${sessionId}.${sequence}`,
    sessionId,
    runId,
    sequence,
    clientTurnId,
    runtimeTurnId,
    status,
    role,
    input: cloneJson(input),
    startedAt,
    completedAt,
    resultSummary,
    error,
  };
}

export function createRiskSignal({
  id = randomUUID(),
  nodeId,
  severity,
  message,
  source,
}) {
  return {
    id,
    nodeId,
    severity,
    message,
    source,
  };
}

export function stateEffectToProposedChange(effect) {
  return {
    id: effect.id,
    kind: effect.kind,
    operation: effect.operation,
    target: effect.target,
    summary: effect.summary,
    previewRef: effect.previewRef,
    policyState: effect.policyState,
    riskFlags: [...effect.riskFlags],
    reversibility: cloneJson(effect.reversibility),
    enforcement: cloneJson(effect.enforcement),
  };
}

export function buildArtifactIdentity({
  runId,
  planVersion,
  graphVersion,
  intent,
  nodes,
  approvalGates,
  stateEffects,
  checkpoints,
}) {
  return createArtifactHash({
    runId,
    planVersion,
    graphVersion,
    intent,
    nodes,
    approvalGates,
    stateEffects,
    checkpoints,
  });
}

function scoreConfidence(signals) {
  const provenanceStrength = signals.provenanceStrength ?? 0;
  const verifierAgreement = signals.verifierAgreement ?? 0;
  const retryStability = signals.retryStability ?? 0;
  const changeSafety = signals.changeSafety ?? 0;

  const score =
    0.4 * provenanceStrength +
    0.25 * verifierAgreement +
    0.2 * retryStability +
    0.15 * changeSafety;

  if (score >= 0.8) {
    return {
      confidenceScore: Number(score.toFixed(2)),
      confidenceBand: "high",
    };
  }

  if (score >= 0.55) {
    return {
      confidenceScore: Number(score.toFixed(2)),
      confidenceBand: "medium",
    };
  }

  return {
    confidenceScore: Number(score.toFixed(2)),
    confidenceBand: "low",
  };
}

function buildNode({
  id,
  title,
  nodeType,
  dependsOn = [],
  reviewStatus,
  executionStatus,
  gatingOwner = "semantix",
  contributingSystems = ["semantix"],
  grounding = "grounded",
  confidenceSignals,
  sourceCount = 1,
  riskFlags = [],
  approvalRequired = false,
  inputSummary,
  outputSummary,
  constraints,
  capabilityScope,
  runtimeBinding,
  revision = 1,
}) {
  const confidence = scoreConfidence(
    confidenceSignals ?? {
      provenanceStrength: 0.82,
      verifierAgreement: 0.76,
      retryStability: 0.72,
      changeSafety: 0.7,
    },
  );

  return {
    id,
    title,
    nodeType,
    revision,
    dependsOn,
    gatingOwner,
    contributingSystems,
    reviewStatus,
    executionStatus,
    grounding,
    confidenceBand: confidence.confidenceBand,
    confidenceScore: confidence.confidenceScore,
    confidenceSignals: confidenceSignals ?? {
      provenanceStrength: 0.82,
      verifierAgreement: 0.76,
      retryStability: 0.72,
      changeSafety: 0.7,
    },
    sourceCount,
    riskFlags,
    approvalRequired,
    inputSummary,
    outputSummary,
    constraints,
    capabilityScope,
    runtimeBinding,
  };
}

function inferEffectBlueprint(intent) {
  const text = `${intent.primaryDirective} ${intent.successState} ${intent.strictBoundaries.join(" ")}`.toLowerCase();

  if (text.includes("database") || text.includes("sql")) {
    return {
      kind: "database",
      operation: "mutate",
      target: "database://primary",
      reversibility: {
        status: "reversible_within_window",
        mechanism: "transactional_rollback",
        windowSeconds: 900,
      },
      riskFlags: ["database_mutation"],
    };
  }

  if (text.includes("api") || text.includes("http") || text.includes("webhook")) {
    return {
      kind: "api",
      operation: "call",
      target: "api://external",
      reversibility: {
        status: "irreversible",
      },
      riskFlags: ["external_side_effect"],
    };
  }

  if (text.includes("email") || text.includes("message") || text.includes("notify")) {
    return {
      kind: "external_action",
      operation: "send",
      target: "external://notification",
      reversibility: {
        status: "irreversible",
      },
      riskFlags: ["irreversible_action"],
    };
  }

  return {
    kind: "file",
    operation: "modify",
    target: "workspace://control-plane",
    reversibility: {
      status: "reversible",
      mechanism: "local_vcs",
    },
    riskFlags: ["workspace_mutation"],
  };
}

export function inferStateEffects(intent, runId) {
  const blueprint = inferEffectBlueprint(intent);

  return [
    {
      id: `effect.${runId}.planned`,
      kind: blueprint.kind,
      operation: blueprint.operation,
      target: blueprint.target,
      summary: `Planned ${blueprint.kind} ${blueprint.operation} required to satisfy the approved Semantix intent.`,
      previewRef: `preview://${runId}/planned/1`,
      policyState: blueprint.reversibility.status === "irreversible" ? "review_required" : "pass",
      riskFlags: [...blueprint.riskFlags],
      reversibility: blueprint.reversibility,
      enforcement: {
        owner: "policy",
        status: blueprint.reversibility.status === "irreversible" ? "review_required" : "pass",
        details: "Phase-1 preview inferred from the reviewed Semantix intent contract.",
      },
    },
  ];
}

export function inferRiskSignals(plan, runId) {
  const signals = [];

  for (const effect of plan.stateEffects) {
    if (effect.policyState === "review_required") {
      signals.push(
        createRiskSignal({
          id: `risk.${runId}.${effect.id}.policy`,
          severity: "medium",
          message: `Effect ${effect.id} requires review before execution.`,
          source: "policy",
          nodeId: plan.nodes.find((node) => node.nodeType === "tool")?.id,
        }),
      );
    }

    if (effect.reversibility.status === "irreversible") {
      signals.push(
        createRiskSignal({
          id: `risk.${runId}.${effect.id}.irreversible`,
          severity: "high",
          message: `Effect ${effect.id} is irreversible.`,
          source: "system",
          nodeId: plan.nodes.find((node) => node.nodeType === "tool")?.id,
        }),
      );
    }
  }

  return signals;
}

export function buildExecutionPlan({
  runId,
  intent,
  planVersion,
  graphVersion,
  artifactHash = "pending",
  generatedAt = Date.now(),
}) {
  const stateEffects = inferStateEffects(intent, runId);
  const capabilityScope = {
    tools: ["shell", "filesystem"],
    permissions: ["workspace_write"],
    runtimeIds: [DEFAULT_RUNTIME_ID],
  };
  const sharedConstraints = {
    hard: [...intent.strictBoundaries],
    soft: ["Keep browser and stx aligned to the same backend contract."],
  };

  const nodes = [
    buildNode({
      id: "node.intent.review",
      title: "Review Intent Contract",
      nodeType: "semantic",
      reviewStatus: "ready",
      executionStatus: "not_started",
      contributingSystems: ["semantix"],
      riskFlags: [],
      approvalRequired: false,
      inputSummary: intent.primaryDirective,
      outputSummary: intent.successState,
      constraints: sharedConstraints,
      capabilityScope,
      confidenceSignals: {
        provenanceStrength: 0.92,
        verifierAgreement: 0.82,
        retryStability: 0.84,
        changeSafety: 0.88,
      },
      sourceCount: Math.max(intent.strictBoundaries.length, 1),
    }),
    buildNode({
      id: "node.state.preview",
      title: "Preview State Effects",
      nodeType: "deterministic",
      dependsOn: ["node.intent.review"],
      reviewStatus: "ready",
      executionStatus: "not_started",
      contributingSystems: ["semantix", "guardrail"],
      riskFlags: stateEffects.flatMap((effect) => effect.riskFlags),
      approvalRequired: false,
      inputSummary: "Summarize the state effects that must be reviewed before runtime dispatch.",
      outputSummary: `${stateEffects.length} state effect(s) are ready for review.`,
      constraints: sharedConstraints,
      capabilityScope,
      confidenceSignals: {
        provenanceStrength: 0.88,
        verifierAgreement: 0.76,
        retryStability: 0.82,
        changeSafety: 0.78,
      },
    }),
    buildNode({
      id: "node.approval.execute",
      title: "Approve Execution Gate",
      nodeType: "approval",
      dependsOn: ["node.state.preview"],
      reviewStatus: "warning",
      executionStatus: "paused",
      contributingSystems: ["semantix", "guardrail"],
      riskFlags: stateEffects.flatMap((effect) => effect.riskFlags),
      approvalRequired: true,
      inputSummary: "Human approval is required before Codex CLI compiles a strict execution proposal.",
      outputSummary: "Awaiting approval on a fresh artifact.",
      constraints: sharedConstraints,
      capabilityScope,
      confidenceSignals: {
        provenanceStrength: 0.86,
        verifierAgreement: 0.7,
        retryStability: 0.8,
        changeSafety: 0.74,
      },
    }),
    buildNode({
      id: "node.codex.execute",
      title: "Compile Approved Work Into Strict Execution IR",
      nodeType: "tool",
      dependsOn: ["node.approval.execute"],
      reviewStatus: "ready",
      executionStatus: "not_started",
      contributingSystems: ["semantix"],
      riskFlags: stateEffects.flatMap((effect) => effect.riskFlags),
      approvalRequired: true,
      inputSummary: intent.primaryDirective,
      outputSummary: "Waiting for an approved approval gate and strict semantic compilation.",
      constraints: sharedConstraints,
      capabilityScope,
      runtimeBinding: {
        runtimeId: DEFAULT_RUNTIME_ID,
        family: DEFAULT_RUNTIME_KIND,
        displayName: "Codex CLI Runtime Adapter",
      },
      confidenceSignals: {
        provenanceStrength: 0.84,
        verifierAgreement: 0.74,
        retryStability: 0.72,
        changeSafety: 0.7,
      },
    }),
    buildNode({
      id: "node.verify.complete",
      title: "Verify Completion And Refresh Artifact",
      nodeType: "deterministic",
      dependsOn: ["node.codex.execute"],
      reviewStatus: "ready",
      executionStatus: "not_started",
      contributingSystems: ["semantix", "guardrail"],
      riskFlags: [],
      approvalRequired: false,
      inputSummary: "Merge runtime output into the Semantix review artifact.",
      outputSummary: "Pending checkpoint resume for final verification.",
      constraints: sharedConstraints,
      capabilityScope,
      confidenceSignals: {
        provenanceStrength: 0.88,
        verifierAgreement: 0.8,
        retryStability: 0.84,
        changeSafety: 0.83,
      },
    }),
  ];

  const approvalGates = [
    {
      id: "gate.codex.execute",
      targetNodeId: "node.codex.execute",
      required: true,
      status: "pending",
      planVersion,
      artifactHash,
      nodeRevision: nodes.find((node) => node.id === "node.codex.execute")?.revision,
      reason: "Fresh human approval is required before Codex CLI compiles a strict execution proposal.",
    },
  ];

  const checkpoints = [
    createCheckpoint({
      runId,
      planVersion,
      artifactHash,
      afterNodeId: "node.approval.execute",
      reason: "awaiting_approval",
      createdAt: generatedAt,
    }),
  ];

  const plan = {
    id: `plan.${runId}`,
    runtimeKind: DEFAULT_RUNTIME_ID,
    planVersion,
    graphVersion,
    artifactHash,
    intent,
    nodes,
    edges: buildEdges(nodes),
    approvalGates,
    stateEffects,
    checkpoints,
    status: "pending_review",
  };

  return plan;
}

export function buildEdges(nodes) {
  return nodes.flatMap((node) =>
    node.dependsOn.map((dependency) => ({
      from: dependency,
      to: node.id,
    })),
  );
}

export function finalizePlanArtifact({ runId, intent, plan, generatedAt = Date.now() }) {
  const artifactHash = buildArtifactIdentity({
    runId,
    planVersion: plan.planVersion,
    graphVersion: plan.graphVersion,
    intent,
    nodes: plan.nodes,
    approvalGates: plan.approvalGates,
    stateEffects: plan.stateEffects,
    checkpoints: plan.checkpoints,
  });

  const finalizedIntent = {
    ...intent,
    status: "pending_review",
    planVersion: plan.planVersion,
    artifactHash,
  };

  const finalizedPlan = {
    ...plan,
    artifactHash,
    intent: finalizedIntent,
    approvalGates: plan.approvalGates.map((gate) => ({
      ...gate,
      artifactHash,
      planVersion: plan.planVersion,
    })),
    checkpoints: plan.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      artifactHash,
      planVersion: plan.planVersion,
    })),
  };

  return {
    artifactId: `artifact.${runId}.${plan.planVersion}.${generatedAt}`,
    runId,
    planVersion: finalizedPlan.planVersion,
    graphVersion: finalizedPlan.graphVersion,
    artifactHash,
    generatedAt,
    freshnessState: "fresh",
    intent: finalizedIntent,
    plan: finalizedPlan,
  };
}

export function buildInspectorPayloadMap(artifact) {
  const gateByNodeId = new Map(
    artifact.plan.approvalGates
      .filter((gate) => gate.targetNodeId)
      .map((gate) => [gate.targetNodeId, gate]),
  );
  const checkpointsByNodeId = new Map();

  for (const checkpoint of artifact.plan.checkpoints) {
    const list = checkpointsByNodeId.get(checkpoint.afterNodeId) ?? [];
    list.push(checkpoint);
    checkpointsByNodeId.set(checkpoint.afterNodeId, list);
  }

  return Object.fromEntries(
    artifact.plan.nodes.map((node) => {
      const gate = gateByNodeId.get(node.id);
      const proposedChanges =
        node.nodeType === "deterministic_execution"
          ? artifact.plan.stateEffects.map((effect) => stateEffectToProposedChange(effect))
          : [];

      return [
        node.id,
        {
          node,
          overview: {
            title: node.title,
            runtimeKind: artifact.plan.runtimeKind,
            freshnessState: artifact.freshnessState,
          },
          context: {
            primaryDirective: artifact.intent.primaryDirective,
            successState: artifact.intent.successState,
            strictBoundaries: artifact.intent.strictBoundaries,
          },
          constraints: node.constraints ?? {},
          outputPreview: {
            summary: node.outputSummary,
            structuredData: proposedChanges,
          },
          critique: {
            confidenceBand: node.confidenceBand,
            confidenceScore: node.confidenceScore,
            riskFlags: node.riskFlags,
          },
          tooling: {
            capabilityScope: node.capabilityScope,
            runtimeBinding: node.runtimeBinding,
            visibleTools: node.capabilityScope?.tools ?? [],
            permissionLevel: node.capabilityScope?.permissions?.join(", ") ?? null,
            approvalPreconditions: gate?.reason ? [gate.reason] : [],
          },
          proposedChanges,
          approvals: gate
            ? {
                gateId: gate.id,
                status: gate.status,
                planVersion: gate.planVersion,
                artifactHash: gate.artifactHash,
                nodeRevision: gate.nodeRevision,
                reason: gate.reason,
              }
            : undefined,
          replay: {
            checkpoints: checkpointsByNodeId.get(node.id) ?? [],
          },
          audit: {
            lastArtifactHash: artifact.artifactHash,
          },
        },
      ];
    }),
  );
}

export function getNodeById(artifact, nodeId) {
  return artifact.plan.nodes.find((node) => node.id === nodeId);
}

export function getApprovalGate(artifact, identifier) {
  if (!identifier) {
    return undefined;
  }

  return artifact.plan.approvalGates.find(
    (gate) => gate.id === identifier || gate.targetNodeId === identifier,
  );
}

export function collectDescendantNodeIds(plan, nodeId) {
  const descendants = new Set([nodeId]);
  let changed = true;

  while (changed) {
    changed = false;

    for (const node of plan.nodes) {
      if (descendants.has(node.id)) {
        continue;
      }
      if (node.dependsOn.some((dependency) => descendants.has(dependency))) {
        descendants.add(node.id);
        changed = true;
      }
    }
  }

  return descendants;
}

export function ensureFreshness({ artifact, planVersion, artifactHash, graphVersion, node, nodeRevision }) {
  if (artifact.planVersion !== planVersion || artifact.artifactHash !== artifactHash) {
    throw new StaleStateError("The submitted artifact is stale.", {
      currentPlanVersion: artifact.planVersion,
      currentGraphVersion: artifact.graphVersion,
      currentArtifactHash: artifact.artifactHash,
    });
  }

  if (graphVersion != null && artifact.graphVersion !== graphVersion) {
    throw new StaleStateError("The submitted graph version is stale.", {
      currentPlanVersion: artifact.planVersion,
      currentGraphVersion: artifact.graphVersion,
      currentArtifactHash: artifact.artifactHash,
    });
  }

  if (node && nodeRevision != null && node.revision !== nodeRevision) {
    throw new StaleStateError("The submitted node revision is stale.", {
      currentPlanVersion: artifact.planVersion,
      currentGraphVersion: artifact.graphVersion,
      currentArtifactHash: artifact.artifactHash,
      currentNodeRevision: node.revision,
      nodeId: node.id,
    });
  }
}

export function refreshArtifactFromPlan({ artifact, intent, plan, generatedAt = Date.now() }) {
  const artifactHash = buildArtifactIdentity({
    runId: artifact.runId,
    planVersion: plan.planVersion,
    graphVersion: plan.graphVersion,
    intent,
    nodes: plan.nodes,
    approvalGates: plan.approvalGates,
    stateEffects: plan.stateEffects,
    checkpoints: plan.checkpoints,
  });

  const refreshedIntent = {
    ...intent,
    artifactHash,
    planVersion: plan.planVersion,
  };

  const refreshedPlan = {
    ...plan,
    artifactHash,
    intent: refreshedIntent,
    approvalGates: plan.approvalGates.map((gate) => ({
      ...gate,
      artifactHash,
      planVersion: plan.planVersion,
    })),
    checkpoints: plan.checkpoints.map((checkpoint) => ({
      ...checkpoint,
      artifactHash,
      planVersion: plan.planVersion,
    })),
  };

  return {
    ...artifact,
    planVersion: refreshedPlan.planVersion,
    graphVersion: refreshedPlan.graphVersion,
    artifactHash,
    generatedAt,
    freshnessState: "fresh",
    intent: refreshedIntent,
    plan: refreshedPlan,
  };
}

export function markArtifactSuperseded(artifact) {
  return {
    ...artifact,
    freshnessState: "superseded",
    plan: {
      ...artifact.plan,
      status: "stale",
      nodes: artifact.plan.nodes.map((node) => ({
        ...node,
        reviewStatus: node.reviewStatus === "approved" ? "stale" : node.reviewStatus,
      })),
      approvalGates: artifact.plan.approvalGates.map((gate) => ({
        ...gate,
        status: gate.status === "approved" ? "stale" : gate.status,
      })),
    },
  };
}

export function createAuditRecord({
  runId,
  action,
  actor,
  planVersion,
  artifactHash,
  nodeId,
  gateId,
  details,
  timestamp = Date.now(),
}) {
  return {
    id: `audit.${runId}.${timestamp}.${randomUUID()}`,
    runId,
    action,
    actor,
    planVersion,
    artifactHash,
    nodeId,
    gateId,
    timestamp,
    details,
  };
}

export function defaultRunState(runId) {
  return {
    runId,
    runtimeId: DEFAULT_RUNTIME_ID,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    intent: null,
    artifact: null,
    inspectors: {},
    previewIndex: {},
    latestCheckpointId: null,
  };
}

export function isExecutableNode(node) {
  return (
    (node.nodeType === "semantic_generation" && Boolean(node.runtimeBinding?.runtimeId)) ||
    node.nodeType === "deterministic_execution"
  );
}

export function isCheckpointFresh(checkpoint, artifact, planVersion, artifactHash) {
  return (
    checkpoint &&
    checkpoint.planVersion === artifact.planVersion &&
    checkpoint.artifactHash === artifact.artifactHash &&
    checkpoint.planVersion === planVersion &&
    checkpoint.artifactHash === artifactHash
  );
}

export const SEMANTIX_RUNTIME_ID = DEFAULT_RUNTIME_ID;
