import { randomUUID } from "node:crypto";

import {
  SEMANTIX_RUNTIME_ID,
  ValidationError,
  NotFoundError,
  createAuditRecord,
  createCheckpoint,
  createIntentContract,
  createRuntimeSession,
  createSessionTurn,
  defaultRunState,
  buildInspectorPayloadMap,
  ensureFreshness,
  getApprovalGate,
  getNodeById,
  collectDescendantNodeIds,
  makeEvent,
  markArtifactSuperseded,
  isCheckpointFresh,
  cloneJson,
} from "./contracts.js";
import { HostFunctionRegistry } from "./host-function-registry.js";
import {
  admitSemanticOutput,
  buildSemantixV0Artifact,
  isDeterministicExecutionNode,
  isRuntimeNode,
  refreshSemantixV0Artifact,
  validateArtifactDocument,
} from "./v0-artifact.js";

function mergeRiskFlags(existing, incoming) {
  return [...new Set([...(existing ?? []), ...(incoming ?? [])])];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeInspectorPayload(base = {}, patch = {}) {
  const next = {
    ...base,
  };

  for (const [key, value] of Object.entries(patch ?? {})) {
    if (isPlainObject(value) && isPlainObject(base?.[key])) {
      next[key] = mergeInspectorPayload(base[key], value);
      continue;
    }

    next[key] = cloneJson(value);
  }

  return next;
}

function createEmitterSet(map, runId) {
  const listeners = map.get(runId) ?? new Set();
  map.set(runId, listeners);
  return listeners;
}

function createLockKey(runId, sessionId) {
  return sessionId ? `${runId}:${sessionId}` : runId;
}

function queueExclusive(map, key, work) {
  const previous = map.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(work)
    .finally(() => {
      if (map.get(key) === next) {
        map.delete(key);
      }
    });

  map.set(key, next);
  return next;
}

function stringifyPreviewValue(value) {
  if (typeof value === "string" && value.trim()) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return "";
  }

  if (typeof value.content === "string" && value.content.trim()) {
    return value.content;
  }

  if (typeof value.text === "string" && value.text.trim()) {
    return value.text;
  }

  if (typeof value.body === "string" && value.body.trim()) {
    return value.body;
  }

  return "";
}

function synthesizePreviewContent(effect) {
  const reversibility = effect.reversibility?.mechanism
    ? `${effect.reversibility.status} via ${effect.reversibility.mechanism}`
    : effect.reversibility?.status ?? "unknown";
  const lines = [
    `! previewRef ${effect.previewRef ?? "none"}`,
    `! kind ${effect.kind} · ${effect.operation}`,
    `! target ${effect.target}`,
    `! summary ${effect.summary}`,
    `! policy ${effect.policyState}`,
    `! reversibility ${reversibility}`,
    `! enforcement ${effect.enforcement?.owner ?? "unknown"} · ${effect.enforcement?.status ?? "unknown"}`,
  ];

  for (const riskFlag of effect.riskFlags ?? []) {
    lines.push(`! risk ${riskFlag}`);
  }

  if (effect.enforcement?.details) {
    lines.push(`! details ${effect.enforcement.details}`);
  }

  return lines.join("\n");
}

function resolvePreviewRecord(effect, previousRecord) {
  if (!effect?.previewRef) {
    return null;
  }

  const explicitContent = [
    effect.preview,
    effect.diff,
    effect.diffPreview,
    effect.content,
    effect.body,
  ]
    .map((value) => stringifyPreviewValue(value))
    .find(Boolean);

  const content = explicitContent || previousRecord?.content || synthesizePreviewContent(effect);
  const mediaType =
    effect.mediaType ??
    effect.previewMediaType ??
    effect.contentType ??
    previousRecord?.mediaType ??
    "text/plain; charset=utf-8";

  return {
    previewRef: effect.previewRef,
    mediaType,
    content,
    source:
      explicitContent
        ? "runtime"
        : previousRecord?.source ?? "artifact",
  };
}

function buildPreviewIndex(artifact, currentIndex = {}) {
  const nextIndex = {};

  for (const effect of artifact?.plan?.stateEffects ?? []) {
    if (!effect?.previewRef) {
      continue;
    }

    const record = resolvePreviewRecord(effect, currentIndex[effect.previewRef]);
    if (record) {
      nextIndex[effect.previewRef] = record;
    }
  }

  return nextIndex;
}

function findStateEffectsForNode(artifact, node) {
  if (!artifact?.plan || !node || !isDeterministicExecutionNode(node)) {
    return [];
  }

  const matched = artifact.plan.stateEffects.filter(
    (effect) =>
      (node.stateEffectPreview?.id && effect.id === node.stateEffectPreview.id) ||
      (node.stateEffectPreview?.previewRef && effect.previewRef === node.stateEffectPreview.previewRef),
  );

  if (matched.length > 0) {
    return matched.map((effect) => cloneJson(effect));
  }

  const deterministicNodes = artifact.plan.nodes.filter((candidate) => isDeterministicExecutionNode(candidate));
  if (deterministicNodes.length === 1 && deterministicNodes[0]?.id === node.id) {
    return artifact.plan.stateEffects.map((effect) => cloneJson(effect));
  }

  return [];
}

function normalizeReviewMetadataList(value) {
  return Array.isArray(value) ? value.map((entry) => cloneJson(entry)) : [];
}

function issueRequiresEscalation(issue) {
  if (!issue || typeof issue !== "object") {
    return false;
  }

  return (
    issue.blocking === true ||
    issue.escalationRequired === true ||
    issue.requiresIntervention === true ||
    ["block", "blocked", "escalate", "escalated"].includes(issue.status) ||
    ["block", "blocked", "escalate", "escalated"].includes(issue.disposition) ||
    ["block", "blocked", "escalate", "escalated"].includes(issue.recommendedAction)
  );
}

function collectDeterministicReviewMetadata(effects = []) {
  const issues = [];
  const evidence = [];
  const interventions = [];

  for (const effect of effects) {
    const effectIssues = normalizeReviewMetadataList(effect?.issues);
    const effectEvidence = normalizeReviewMetadataList(effect?.evidence);
    const effectInterventions = normalizeReviewMetadataList(effect?.interventions);

    issues.push(...effectIssues);
    evidence.push(...effectEvidence);
    interventions.push(...effectInterventions);

    for (const issue of effectIssues) {
      evidence.push(...normalizeReviewMetadataList(issue?.evidence));
      interventions.push(...normalizeReviewMetadataList(issue?.interventions));
    }
  }

  const blockingEffect = effects.find(
    (effect) =>
      effect?.policyState === "block" ||
      effect?.enforcement?.status === "block" ||
      normalizeReviewMetadataList(effect?.issues).some(issueRequiresEscalation),
  );
  const blockingIssue =
    normalizeReviewMetadataList(blockingEffect?.issues).find(issueRequiresEscalation) ??
    issues.find(issueRequiresEscalation) ??
    null;

  const blockingReason =
    blockingIssue?.message ??
    blockingIssue?.summary ??
    blockingIssue?.title ??
    blockingEffect?.summary ??
    blockingEffect?.enforcement?.details ??
    null;

  return {
    issues,
    evidence,
    interventions,
    blocking:
      effects.some(
        (effect) =>
          effect?.policyState === "block" ||
          effect?.enforcement?.status === "block" ||
          normalizeReviewMetadataList(effect?.issues).some(issueRequiresEscalation),
      ) || issues.some(issueRequiresEscalation),
    blockingReason,
  };
}

function buildDeterministicInspectorPayloadMap(artifact) {
  const inspectors = buildInspectorPayloadMap(artifact);

  for (const node of artifact?.plan?.nodes ?? []) {
    if (!isDeterministicExecutionNode(node)) {
      continue;
    }

    const stateEffects = findStateEffectsForNode(artifact, node);
    const review = collectDeterministicReviewMetadata(stateEffects);
    const primaryEffect = stateEffects[0] ?? node.stateEffectPreview ?? null;

    inspectors[node.id] = mergeInspectorPayload(inspectors[node.id], {
      outputPreview: {
        ...(primaryEffect?.previewRef ? { previewRef: primaryEffect.previewRef } : {}),
        ...(primaryEffect?.preview !== undefined ? { preview: primaryEffect.preview } : {}),
        ...(primaryEffect?.diff !== undefined ? { diff: primaryEffect.diff } : {}),
        ...(primaryEffect?.diffPreview !== undefined ? { diffPreview: primaryEffect.diffPreview } : {}),
        ...(primaryEffect?.mediaType ? { mediaType: primaryEffect.mediaType } : {}),
        stateEffects,
      },
      critique: {
        issues: review.issues,
        evidence: review.evidence,
        interventions: review.interventions,
        blocking: review.blocking,
        ...(review.blockingReason ? { blockingReason: review.blockingReason } : {}),
      },
      issues: review.issues,
      evidence: review.evidence,
      interventions: review.interventions,
    });
  }

  return inspectors;
}

function collectDeterministicExecutionReview(artifact, node) {
  const stateEffects = findStateEffectsForNode(artifact, node);
  return {
    stateEffects,
    ...collectDeterministicReviewMetadata(stateEffects),
  };
}

function buildRunSummary(run, sessions = []) {
  const artifact = run.artifact;
  const pendingApprovalCount = artifact
    ? artifact.plan.approvalGates.filter((gate) => gate.required && gate.status === "pending").length
    : 0;
  const blockedActionCount = artifact
    ? artifact.plan.stateEffects.filter(
        (effect) => effect.policyState === "block" || effect.enforcement?.status === "block",
      ).length
    : 0;
  const activeSessionCount = sessions.filter((session) =>
    ["starting", "running"].includes(session?.status),
  ).length;

  return {
    runId: run.runId,
    runtimeId: run.runtimeId,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    latestCheckpointId: run.latestCheckpointId,
    intent: run.intent ? cloneJson(run.intent) : null,
    artifact: artifact
      ? {
          artifactId: artifact.artifactId,
          runId: artifact.runId,
          planVersion: artifact.planVersion,
          graphVersion: artifact.graphVersion,
          artifactHash: artifact.artifactHash,
          generatedAt: artifact.generatedAt,
          freshnessState: artifact.freshnessState,
        }
      : null,
    summary: artifact
      ? {
          planStatus: artifact.plan.status,
          nodeCount: artifact.plan.nodes.length,
          stateEffectCount: artifact.plan.stateEffects.length,
          checkpointCount: artifact.plan.checkpoints.length,
          approvalCount: artifact.plan.approvalGates.length,
          pendingApprovalCount,
          blockedActionCount,
          sessionCount: sessions.length,
          activeSessionCount,
        }
      : {
          planStatus: null,
          nodeCount: 0,
          stateEffectCount: 0,
          checkpointCount: 0,
          approvalCount: 0,
          pendingApprovalCount: 0,
          blockedActionCount: 0,
          sessionCount: sessions.length,
          activeSessionCount,
        },
  };
}

function latestSessionTurns(turns) {
  const byTurnId = new Map();
  for (const turn of turns) {
    byTurnId.set(turn.turnId, turn);
  }

  return [...byTurnId.values()].sort((left, right) => left.sequence - right.sequence);
}

function findNextReadyNode(plan) {
  return plan.nodes.find((node) => {
    if (node.nodeType === "approval_gate") {
      return false;
    }

    return ["not_started", "paused"].includes(node.executionStatus);
  });
}

function syncApprovalGateNode(plan, targetNodeId, patch = {}) {
  const gate = plan.approvalGates.find((entry) => entry.targetNodeId === targetNodeId);
  if (!gate) {
    return null;
  }

  Object.assign(gate, patch);
  return gate;
}

function updatePlanNode(plan, nodeId, updater) {
  let updatedNode = null;
  plan.nodes = plan.nodes.map((node) => {
    if (node.id !== nodeId) {
      return node;
    }

    updatedNode = updater({
      ...node,
    });
    return updatedNode;
  });

  return updatedNode;
}

function replaceStateEffectPreview(plan, preview) {
  const nextPreview = cloneJson(preview);
  const existingIndex = plan.stateEffects.findIndex((effect) => effect.id === nextPreview.id);
  if (existingIndex === -1) {
    plan.stateEffects.push(nextPreview);
    return;
  }

  plan.stateEffects[existingIndex] = nextPreview;
}

async function safeMaybePromise(fn, payload) {
  try {
    await fn(payload);
  } catch {
    // Subscribers should not break the control plane.
  }
}

export class ControlPlaneService {
  constructor({
    store,
    runtimeRegistry,
    hostFunctionRegistry = new HostFunctionRegistry(),
    now = () => Date.now(),
  }) {
    if (!store) {
      throw new ValidationError("ControlPlaneService requires a file-backed store.");
    }

    if (!runtimeRegistry) {
      throw new ValidationError("ControlPlaneService requires a runtime registry.");
    }

    this.store = store;
    this.runtimeRegistry = runtimeRegistry;
    this.hostFunctionRegistry = hostFunctionRegistry;
    this.now = typeof now === "function" ? now : () => now;
    this.subscribers = new Map();
    this.eventLocks = new Map();
    this.sessionLocks = new Map();
    this.runtimeRelays = new Map();
  }

  subscribe(runId, listener) {
    const listeners = createEmitterSet(this.subscribers, runId);
    listeners.add(listener);

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.subscribers.delete(runId);
      }
    };
  }

  async emit(runId, event) {
    return queueExclusive(this.eventLocks, runId, async () => {
      const existingEvents = await this.store.listRunEvents(runId);
      const nextSequence = (existingEvents.at(-1)?.sequence ?? 0) + 1;
      const sequencedEvent = {
        ...event,
        eventId: event.eventId ?? `${runId}:${nextSequence}`,
        sequence: event.sequence ?? nextSequence,
      };

      await this.store.appendRunEvent(runId, sequencedEvent);
      const listeners = this.subscribers.get(runId);

      if (!listeners) {
        return sequencedEvent;
      }

      await Promise.all(
        [...listeners].map((listener) => safeMaybePromise(listener, sequencedEvent)),
      );
      return sequencedEvent;
    });
  }

  async appendAudit(runId, record) {
    await this.store.appendAuditRecord(runId, record);
    return record;
  }

  async relayRuntimeEvents({ runId, adapter }) {
    for await (const event of adapter.streamEvents({ runId })) {
      await this.applyRuntimeEvent(runId, event);
    }
  }

  ensureRuntimeRelay({ runId, adapter }) {
    if (this.runtimeRelays.has(runId)) {
      return this.runtimeRelays.get(runId);
    }

    const relay = this.relayRuntimeEvents({
      runId,
      adapter,
    })
      .catch(() => {})
      .finally(() => {
        this.runtimeRelays.delete(runId);
      });

    this.runtimeRelays.set(runId, relay);
    return relay;
  }

  async getRunState(runId) {
    const run = await this.store.getRun(runId);
    if (!run) {
      throw new NotFoundError(`Run '${runId}' does not exist.`, { runId });
    }
    return this.reconcileRunStateFromEvents(run);
  }

  async reconcileRunStateFromEvents(run) {
    if (run?.artifact?.plan?.status !== "running") {
      return run;
    }
    if (typeof this.store.listRunEvents !== "function") {
      return run;
    }

    const events = await this.store.listRunEvents(run.runId);
    const failedEvent = events
      .slice()
      .reverse()
      .find((event) =>
        event?.type === "run.failed" ||
        event?.payload?.executionStatus === "failed",
      );
    if (!failedEvent?.nodeId) {
      return run;
    }

    const failedNode = getNodeById(run.artifact, failedEvent.nodeId);
    if (!failedNode || failedNode.executionStatus === "failed") {
      return run;
    }

    updatePlanNode(run.artifact.plan, failedEvent.nodeId, (node) => ({
      ...node,
      executionStatus: "failed",
      reviewStatus: "blocked",
      outputSummary:
        failedEvent.payload?.outputSummary ??
        failedEvent.payload?.message ??
        node.outputSummary,
      riskFlags: mergeRiskFlags(node.riskFlags, ["runtime_connector_failure"]),
    }));
    run.artifact.plan.status = "failed";
    await this.saveRunState(run);
    return run;
  }

  async ensureRunState(runId) {
    const existing = await this.store.getRun(runId);
    if (existing) {
      return existing;
    }

    const run = defaultRunState(runId);
    await this.store.saveRun(run);

    await this.emit(
      runId,
      makeEvent({
        runId,
        type: "run.created",
        timestamp: this.now(),
        payload: {
          runtimeId: SEMANTIX_RUNTIME_ID,
        },
      }),
    );

    return run;
  }

  async saveRunState(run) {
    if (run.artifact) {
      run.previewIndex = buildPreviewIndex(run.artifact, run.previewIndex);
    } else {
      run.previewIndex = {};
    }
    run.updatedAt = this.now();
    await this.store.saveRun(run);
    return run;
  }

  withSessionLock(runId, sessionId, work) {
    return queueExclusive(this.sessionLocks, createLockKey(runId, sessionId), work);
  }

  async listEvents({ runId, afterSequence = 0, sessionId } = {}) {
    const events = await this.store.listRunEvents(runId);
    return events.filter(
      (event) =>
        (event.sequence ?? 0) > afterSequence && (!sessionId || event.sessionId === sessionId),
    );
  }

  async getSessionState(runId, sessionId) {
    const session = await this.store.getSession(runId, sessionId);
    if (!session) {
      throw new NotFoundError(`Session '${sessionId}' does not exist.`, {
        runId,
        sessionId,
      });
    }

    return session;
  }

  getExecutableNode(artifact, nodeId) {
    if (nodeId) {
      const node = getNodeById(artifact, nodeId);
      if (!node) {
        throw new NotFoundError(`Node '${nodeId}' does not exist.`, {
          nodeId,
        });
      }
      if (!isRuntimeNode(node)) {
        throw new ValidationError(`Node '${nodeId}' is not bound to a runtime adapter.`, {
          nodeId,
        });
      }
      return node;
    }

    const executableNode = artifact.plan.nodes.find((candidate) => isRuntimeNode(candidate));
    if (!executableNode) {
      throw new ValidationError("No executable runtime node exists for this run.", {
        runId: artifact.runId,
      });
    }

    return executableNode;
  }

  ensureExecutableApproval(artifact, node) {
    const gate = getApprovalGate(artifact, node.id);
    if (gate?.required && gate.status !== "approved") {
      throw new ValidationError("Starting or continuing a runtime session requires approval.", {
        nodeId: node.id,
        gateId: gate.id,
        gateStatus: gate.status,
      });
    }

    return gate;
  }

  async applyRuntimeEvent(runId, event) {
    const run = await this.store.getRun(runId);
    const artifact = run?.artifact;
    const runtimeEvent = {
      ...event,
      planVersion: event.planVersion ?? artifact?.planVersion,
      artifactHash: event.artifactHash ?? artifact?.artifactHash,
    };

    if (runtimeEvent.sessionId) {
      const session = await this.store.getSession(runId, runtimeEvent.sessionId);
      if (session) {
        session.updatedAt = runtimeEvent.timestamp;

        if (runtimeEvent.type === "session.updated") {
          session.status = runtimeEvent.payload?.status ?? session.status;
          session.preview = runtimeEvent.payload?.thread?.preview ?? session.preview;
        }

        if (runtimeEvent.type === "turn.started") {
          session.status = "running";
          session.activeTurnId = runtimeEvent.turnId ?? session.activeTurnId;
        }

        if (runtimeEvent.type === "turn.completed") {
          session.status = "waiting_for_input";
          session.activeTurnId = null;
          session.turnCount = Math.max(session.turnCount ?? 0, 1);
          session.lastTurnSummary =
            runtimeEvent.payload?.turn?.status ?? runtimeEvent.payload?.status ?? session.lastTurnSummary;
        }

        if (runtimeEvent.type === "turn.interrupted") {
          session.status = "paused";
          session.activeTurnId = null;
          session.lastTurnSummary = "interrupted";
        }

        if (runtimeEvent.type === "turn.failed") {
          session.status = "failed";
          session.activeTurnId = null;
          session.error = {
            message:
              runtimeEvent.payload?.error?.message ??
              runtimeEvent.payload?.message ??
              "Codex session turn failed.",
          };
        }

        await this.store.saveSession(session);
      }

      if (runtimeEvent.turnId) {
        const turns = await this.store.listSessionTurns(runId, runtimeEvent.sessionId);
        const turn = turns.find((candidate) => candidate.turnId === runtimeEvent.turnId);

        if (turn) {
          if (runtimeEvent.type === "turn.started") {
            turn.status = "running";
            turn.startedAt = runtimeEvent.payload?.turn?.startedAt ?? runtimeEvent.timestamp;
            turn.runtimeTurnId = runtimeEvent.payload?.turn?.id ?? turn.runtimeTurnId;
          }

          if (runtimeEvent.type === "turn.completed") {
            turn.status = "completed";
            turn.completedAt =
              runtimeEvent.payload?.turn?.completedAt ?? runtimeEvent.timestamp;
            turn.resultSummary = runtimeEvent.payload?.turn?.status ?? "completed";
          }

          if (runtimeEvent.type === "turn.interrupted") {
            turn.status = "interrupted";
            turn.completedAt =
              runtimeEvent.payload?.turn?.completedAt ?? runtimeEvent.timestamp;
            turn.resultSummary = "interrupted";
          }

          if (runtimeEvent.type === "turn.failed") {
            turn.status = "failed";
            turn.completedAt = runtimeEvent.timestamp;
            turn.error = {
              message:
                runtimeEvent.payload?.error?.message ??
                runtimeEvent.payload?.message ??
                "Codex session turn failed.",
            };
          }

          await this.store.appendSessionTurn(runId, runtimeEvent.sessionId, turn);
        }
      }
    }

    return this.emit(runId, runtimeEvent);
  }

  requireArtifact(run) {
    if (!run.artifact) {
      throw new ValidationError(`Run '${run.runId}' does not have a compiled artifact yet.`, {
        runId: run.runId,
      });
    }
    return run.artifact;
  }

  resolveNodeAndGate(artifact, { nodeId, gateId }) {
    const node =
      getNodeById(artifact, nodeId) ??
      (gateId ? getNodeById(artifact, getApprovalGate(artifact, gateId)?.targetNodeId) : undefined);

    if (!node) {
      throw new NotFoundError("The referenced execution node does not exist.", {
        nodeId,
        gateId,
      });
    }

    const gate = getApprovalGate(
      artifact,
      gateId ?? node.targetNodeId ?? node.id,
    );
    return { node, gate };
  }

  assertIntentFreshness(run, payload) {
    if (!run.artifact) {
      return;
    }

    const { planVersion, artifactHash, graphVersion } = payload ?? {};
    if (planVersion == null || !artifactHash) {
      throw new ValidationError(
        "Mutating an existing intent requires planVersion and artifactHash freshness metadata.",
      );
    }

    ensureFreshness({
      artifact: run.artifact,
      planVersion,
      artifactHash,
      graphVersion,
    });
  }

  async createOrUpdateIntent({
    runId,
    primaryDirective,
    strictBoundaries = [],
    successState,
    actor = "system",
    planVersion,
    artifactHash,
    graphVersion,
  }) {
    if (!primaryDirective || !successState) {
      throw new ValidationError("Intent creation requires primaryDirective and successState.");
    }

    const run = await this.ensureRunState(runId);
    this.assertIntentFreshness(run, { planVersion, artifactHash, graphVersion });

    const previousIntent = run.intent;
    const nextContractVersion = (previousIntent?.contractVersion ?? 0) + 1;

    run.intent = createIntentContract({
      runId,
      primaryDirective,
      strictBoundaries,
      successState,
      status: previousIntent ? "modified" : "draft",
      planVersion: run.artifact?.planVersion ?? 0,
      contractVersion: nextContractVersion,
      artifactHash: run.artifact?.artifactHash ?? "pending",
    });

    if (run.artifact) {
      run.artifact = markArtifactSuperseded(run.artifact);
      run.inspectors = buildDeterministicInspectorPayloadMap(run.artifact);
    }

    await this.saveRunState(run);
    await this.appendAudit(
      runId,
      createAuditRecord({
        runId,
        action: "intent.updated",
        actor,
        planVersion: run.artifact?.planVersion,
        artifactHash: run.artifact?.artifactHash,
        details: {
          contractVersion: nextContractVersion,
        },
        timestamp: this.now(),
      }),
    );

    return run.intent;
  }

  async compilePlan({ runId, actor = "system", blueprint, cwd } = {}) {
    const run = await this.ensureRunState(runId);
    if (!run.intent && !blueprint?.intent_contract) {
      throw new ValidationError("Cannot compile a plan before an intent contract exists.", {
        runId,
      });
    }

    const generatedAt = this.now();
    const planVersion = (run.artifact?.planVersion ?? 0) + 1;
    const graphVersion = (run.artifact?.graphVersion ?? 0) + 1;
    const sourceIntent =
      run.intent ??
      createIntentContract({
        runId,
        primaryDirective: blueprint.intent_contract.primary_directive,
        strictBoundaries: blueprint.intent_contract.strict_boundaries ?? [],
        successState: blueprint.intent_contract.success_state,
      });
    const artifact = buildSemantixV0Artifact({
      runId,
      intent: {
        ...sourceIntent,
        status: "pending_review",
      },
      blueprint,
      planVersion,
      graphVersion,
      generatedAt,
      cwd,
    });

    run.intent = artifact.intent;
    run.artifact = artifact;
    run.inspectors = buildDeterministicInspectorPayloadMap(artifact);
    run.latestCheckpointId = artifact.plan.checkpoints.at(-1)?.id ?? null;

    await this.saveRunState(run);

    await this.appendAudit(
      runId,
      createAuditRecord({
        runId,
        action: "artifact.generated",
        actor,
        planVersion: artifact.planVersion,
        artifactHash: artifact.artifactHash,
        details: {
          graphVersion: artifact.graphVersion,
        },
        timestamp: generatedAt,
      }),
    );

    await this.emit(
      runId,
      makeEvent({
        runId,
        type: "artifact.generated",
        timestamp: generatedAt,
        planVersion: artifact.planVersion,
        artifactHash: artifact.artifactHash,
        payload: {
          graphVersion: artifact.graphVersion,
        },
      }),
    );

    return artifact;
  }

  async ingestArtifact({ runId, actor = "system", artifact, cwd } = {}) {
    validateArtifactDocument({
      artifact,
      cwd,
    });

    const runtimeIntent = createIntentContract({
      runId,
      primaryDirective: artifact.intent_contract.primary_directive,
      strictBoundaries: artifact.intent_contract.strict_boundaries ?? [],
      successState: artifact.intent_contract.success_state,
      contractVersion: artifact.intent_contract.contract_version ?? 1,
    });

    return this.compilePlan({
      runId,
      actor,
      blueprint: artifact,
      cwd,
      intent: runtimeIntent,
    });
  }

  async getCurrentArtifact(runId) {
    const run = await this.getRunState(runId);
    return this.requireArtifact(run);
  }

  async getPreviewByRef({ runId, previewRef }) {
    if (!previewRef) {
      throw new ValidationError("A previewRef is required to resolve preview content.", {
        runId,
      });
    }

    const run = await this.getRunState(runId);
    const artifact = this.requireArtifact(run);
    const previewIndex = buildPreviewIndex(artifact, run.previewIndex);
    const record = previewIndex[previewRef];

    if (!record) {
      throw new NotFoundError(`Preview '${previewRef}' does not exist for run '${runId}'.`, {
        runId,
        previewRef,
      });
    }

    return {
      ...record,
      runId,
      planVersion: artifact.planVersion,
      graphVersion: artifact.graphVersion,
      artifactHash: artifact.artifactHash,
    };
  }

  async bootstrapRun({
    runId = `run-${randomUUID()}`,
    actor = "system",
    primaryDirective,
    strictBoundaries = [],
    successState,
    cwd,
    autoExecuteSemanticAdmission = true,
  }) {
    await this.createOrUpdateIntent({
      runId,
      actor,
      primaryDirective,
      strictBoundaries,
      successState,
    });

    const artifact = await this.compilePlan({
      runId,
      actor,
      cwd,
    });

    if (!autoExecuteSemanticAdmission) {
      return artifact;
    }

    const nextRuntimeNode = artifact.plan.nodes.find(
      (node) =>
        isRuntimeNode(node) &&
        ["not_started", "paused"].includes(node.executionStatus) &&
        this.dependenciesSatisfied(artifact.plan, node),
    );

    if (!nextRuntimeNode) {
      return artifact;
    }

    try {
      return await this.executeApprovedNodes({
        runId,
        actor,
      });
    } catch (error) {
      const latestRun = await this.getRunState(runId);
      if (latestRun.artifact?.plan?.status === "failed") {
        return latestRun.artifact;
      }
      throw error;
    }
  }

  async listRuns() {
    const runs = await this.store.listRuns();

    const orderedRuns = runs
      .filter(Boolean)
      .sort((left, right) => {
        const leftUpdatedAt = left.updatedAt ?? left.createdAt ?? 0;
        const rightUpdatedAt = right.updatedAt ?? right.createdAt ?? 0;
        return rightUpdatedAt - leftUpdatedAt;
      });

    return Promise.all(
      orderedRuns.map(async (rawRun) => {
        const run = await this.reconcileRunStateFromEvents(rawRun);
        const sessions = (await this.store.listSessions(run.runId)).filter(Boolean);
        return buildRunSummary(run, sessions);
      }),
    );
  }

  async getNodeInspectorPayload({ runId, nodeId }) {
    const run = await this.getRunState(runId);
    const payload = run.inspectors?.[nodeId];
    if (!payload) {
      throw new NotFoundError(`Inspector payload for node '${nodeId}' does not exist.`, {
        runId,
        nodeId,
      });
    }

    const sessions = (await this.store.listSessions(runId)).filter(
      (session) => session?.nodeId === nodeId,
    );

    return {
      ...payload,
      runtimeSessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        runtimeSessionId: session.runtimeSessionId,
        status: session.status,
        turnCount: session.turnCount,
        activeTurnId: session.activeTurnId,
        updatedAt: session.updatedAt,
      })),
    };
  }

  async submitIntervention({
    runId,
    actor = "reviewer",
    planVersion,
    graphVersion,
    artifactHash,
    nodeId,
    nodeRevision,
    changes = {},
  }) {
    const run = await this.getRunState(runId);
    const artifact = this.requireArtifact(run);
    const { node } = this.resolveNodeAndGate(artifact, { nodeId });

    ensureFreshness({
      artifact,
      planVersion,
      artifactHash,
      graphVersion,
      node,
      nodeRevision,
    });

    const affected = collectDescendantNodeIds(artifact.plan, node.id);
    const nextPlan = cloneJson(artifact.plan);
    const generatedAt = this.now();

    nextPlan.planVersion += 1;
    nextPlan.graphVersion += 1;
    nextPlan.status = "pending_review";

    nextPlan.nodes = nextPlan.nodes.map((currentNode) => {
      if (!affected.has(currentNode.id)) {
        return currentNode;
      }

      const nextNode = {
        ...currentNode,
        revision: currentNode.revision + 1,
        reviewStatus: currentNode.approvalRequired ? "warning" : "stale",
        executionStatus:
          currentNode.executionStatus === "running" ? "paused" : "not_started",
        riskFlags: mergeRiskFlags(currentNode.riskFlags, ["freshness_invalidated"]),
      };

      if (currentNode.id === node.id) {
        if (changes.title) {
          nextNode.title = changes.title;
        }
        if (changes.inputSummary) {
          nextNode.inputSummary = changes.inputSummary;
        }
        if (changes.outputSummary) {
          nextNode.outputSummary = changes.outputSummary;
        }
        if (typeof changes.approvalRequired === "boolean") {
          nextNode.approvalRequired = changes.approvalRequired;
        }
        if (changes.constraintPatch) {
          nextNode.constraints = {
            ...(nextNode.constraints ?? {}),
            ...changes.constraintPatch,
          };
        }
      }

      return nextNode;
    });

    nextPlan.approvalGates = nextPlan.approvalGates.map((gate) => {
      const targetNode = nextPlan.nodes.find((candidate) => candidate.id === gate.targetNodeId);
      return {
        ...gate,
        status: "pending",
        nodeRevision: targetNode?.revision,
      };
    });

    nextPlan.checkpoints = [
      ...nextPlan.checkpoints,
      createCheckpoint({
        runId,
        planVersion: nextPlan.planVersion,
        artifactHash: artifact.artifactHash,
        afterNodeId: node.id,
        reason: "intervention_applied",
        createdAt: generatedAt,
      }),
    ];

    const nextIntent = {
      ...run.intent,
      status: "modified",
    };

    const refreshedArtifact = refreshSemantixV0Artifact({
      artifact,
      intent: nextIntent,
      plan: nextPlan,
      generatedAt,
    });

    run.intent = refreshedArtifact.intent;
    run.artifact = refreshedArtifact;
    run.inspectors = buildDeterministicInspectorPayloadMap(refreshedArtifact);

    if (changes.contextPatch) {
      run.inspectors[node.id] = {
        ...run.inspectors[node.id],
        context: {
          ...(run.inspectors[node.id]?.context ?? {}),
          ...changes.contextPatch,
        },
      };
    }

    if (changes.constraintPatch) {
      run.inspectors[node.id] = {
        ...run.inspectors[node.id],
        constraints: {
          ...(run.inspectors[node.id]?.constraints ?? {}),
          ...changes.constraintPatch,
        },
      };
    }

    run.latestCheckpointId = refreshedArtifact.plan.checkpoints.at(-1)?.id ?? run.latestCheckpointId;

    await this.saveRunState(run);

    await this.appendAudit(
      runId,
      createAuditRecord({
        runId,
        action: "intervention.applied",
        actor,
        planVersion: refreshedArtifact.planVersion,
        artifactHash: refreshedArtifact.artifactHash,
        nodeId: node.id,
        details: {
          affectedNodes: [...affected],
          changes,
        },
        timestamp: generatedAt,
      }),
    );

    await this.emit(
      runId,
      makeEvent({
        runId,
        type: "approval.stale",
        timestamp: generatedAt,
        nodeId: node.id,
        planVersion: refreshedArtifact.planVersion,
        artifactHash: refreshedArtifact.artifactHash,
        payload: {
          reason: "Node intervention invalidated prior approvals.",
          affectedNodes: [...affected],
        },
      }),
    );

    await this.emit(
      runId,
      makeEvent({
        runId,
        type: "artifact.generated",
        timestamp: generatedAt,
        planVersion: refreshedArtifact.planVersion,
        artifactHash: refreshedArtifact.artifactHash,
        payload: {
          graphVersion: refreshedArtifact.graphVersion,
          reason: "intervention",
        },
      }),
    );

    return refreshedArtifact;
  }

  async submitApprovalAction({
    runId,
    actor = "reviewer",
    action,
    planVersion,
    graphVersion,
    artifactHash,
    gateId,
    nodeId,
    nodeRevision,
    reason,
  }) {
    const run = await this.getRunState(runId);
    const artifact = this.requireArtifact(run);

    try {
      const { node, gate } = this.resolveNodeAndGate(artifact, { nodeId, gateId });

      ensureFreshness({
        artifact,
        planVersion,
        artifactHash,
        graphVersion,
        node,
        nodeRevision,
      });

      if (!gate) {
        throw new NotFoundError("Approval action requires a matching ApprovalGate.", {
          runId,
          nodeId,
          gateId,
        });
      }

      if (!["approve", "reject"].includes(action)) {
        throw new ValidationError("Approval action must be either 'approve' or 'reject'.", {
          action,
        });
      }

      const targetNode = artifact.plan.nodes.find((currentNode) => currentNode.id === gate.targetNodeId);
      if (
        action === "approve" &&
        targetNode &&
        targetNode.dependsOn.some((dependencyId) => {
          const dependency = artifact.plan.nodes.find((currentNode) => currentNode.id === dependencyId);
          return dependency && dependency.nodeType !== "approval_gate" && dependency.executionStatus !== "succeeded";
        })
      ) {
        throw new ValidationError("Approval requires fresh upstream semantic output and preview materialization.", {
          runId,
          gateId: gate.id,
          nodeId: gate.targetNodeId,
        });
      }

      if (action === "approve" && targetNode && isDeterministicExecutionNode(targetNode)) {
        const review = collectDeterministicExecutionReview(artifact, targetNode);
        if (review.blocking) {
          throw new ValidationError(
            "Approval cannot advance a deterministic code change while Semantix issues remain unresolved.",
            {
              runId,
              gateId: gate.id,
              nodeId: gate.targetNodeId,
              blockingReason: review.blockingReason,
              issues: review.issues,
              evidence: review.evidence,
              interventions: review.interventions,
            },
          );
        }
      }

      artifact.plan.approvalGates = artifact.plan.approvalGates.map((currentGate) =>
        currentGate.id !== gate.id
          ? currentGate
          : {
              ...currentGate,
              status: action === "approve" ? "approved" : "rejected",
            },
      );

      const approvalGateNode = artifact.plan.nodes.find(
        (currentNode) =>
          currentNode.nodeType === "approval_gate" && currentNode.targetNodeId === gate.targetNodeId,
      );

      artifact.plan.nodes = artifact.plan.nodes.map((currentNode) => {
        if (currentNode.id === gate.targetNodeId) {
          return {
            ...currentNode,
            reviewStatus: action === "approve" ? "approved" : "blocked",
          };
        }

        if (currentNode.id === approvalGateNode?.id) {
          return {
            ...currentNode,
            reviewStatus: action === "approve" ? "approved" : "blocked",
            executionStatus: action === "approve" ? "succeeded" : "paused",
          };
        }

        return currentNode;
      });

      artifact.plan.status =
        action === "approve" &&
        artifact.plan.approvalGates.every((currentGate) => !currentGate.required || currentGate.status === "approved")
          ? "approved_for_execution"
          : "paused";

      run.inspectors = buildDeterministicInspectorPayloadMap(artifact);
      await this.saveRunState(run);

      const eventType = action === "approve" ? "approval.accepted" : "approval.rejected";
      const timestamp = this.now();

      await this.appendAudit(
        runId,
        createAuditRecord({
          runId,
          action: eventType,
          actor,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          nodeId: gate.targetNodeId,
          gateId: gate.id,
          details: { reason },
          timestamp,
        }),
      );

      await this.emit(
        runId,
        makeEvent({
          runId,
          type: eventType,
          timestamp,
          nodeId: gate.targetNodeId,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          payload: {
            gateId: gate.id,
            action,
            reason,
          },
        }),
      );

      return {
        gate: artifact.plan.approvalGates.find((currentGate) => currentGate.id === gate.id),
        artifact,
      };
    } catch (error) {
      if (error?.code === "STALE_STATE") {
        const timestamp = this.now();
        await this.appendAudit(
          runId,
          createAuditRecord({
            runId,
            action: "approval.stale",
            actor,
            planVersion: artifact.planVersion,
            artifactHash: artifact.artifactHash,
            nodeId,
            gateId,
            details: error.details,
            timestamp,
          }),
        );

        await this.emit(
          runId,
          makeEvent({
            runId,
            type: "approval.stale",
            timestamp,
            nodeId,
            planVersion: artifact.planVersion,
            artifactHash: artifact.artifactHash,
            payload: error.details,
          }),
        );
      }

      throw error;
    }
  }

  async createSession({
    runId,
    actor = "operator",
    sessionId,
    planVersion,
    graphVersion,
    artifactHash,
    nodeId,
    nodeRevision,
  }) {
    const run = await this.getRunState(runId);
    const artifact = this.requireArtifact(run);
    const node = this.getExecutableNode(artifact, nodeId);

    ensureFreshness({
      artifact,
      planVersion,
      artifactHash,
      graphVersion,
      node,
      nodeRevision,
    });
    this.ensureExecutableApproval(artifact, node);

    if (sessionId) {
      const existing = await this.store.getSession(runId, sessionId);
      if (existing) {
        return existing;
      }
    }

    const createdAt = this.now();
    const resolvedSessionId = sessionId ?? `session.${runId}.${randomUUID()}`;
    const adapter = this.runtimeRegistry.selectRuntimeForNode(node);

    this.ensureRuntimeRelay({
      runId,
      adapter,
    });

    const started = await adapter.startSession({
      runId,
      sessionId: resolvedSessionId,
      node,
      artifact,
      intent: run.intent,
    });

    const session = createRuntimeSession({
      sessionId: resolvedSessionId,
      runId,
      nodeId: node.id,
      runtimeId: node.runtimeBinding?.runtimeId ?? SEMANTIX_RUNTIME_ID,
      runtimeSessionId: started.runtimeSessionId,
      planVersion: artifact.planVersion,
      artifactHash: artifact.artifactHash,
      nodeRevision: node.revision,
      createdAt,
      updatedAt: createdAt,
      preview: started.thread?.preview ?? "",
    });

    await this.store.saveSession(session);
    await this.appendAudit(
      runId,
      createAuditRecord({
        runId,
        action: "session.created",
        actor,
        planVersion: artifact.planVersion,
        artifactHash: artifact.artifactHash,
        nodeId: node.id,
        details: {
          sessionId: session.sessionId,
          runtimeSessionId: session.runtimeSessionId,
        },
        timestamp: createdAt,
      }),
    );

    await this.emit(
      runId,
      makeEvent({
        runId,
        type: "session.created",
        timestamp: createdAt,
        nodeId: node.id,
        sessionId: session.sessionId,
        runtimeSessionId: session.runtimeSessionId,
        planVersion: artifact.planVersion,
        artifactHash: artifact.artifactHash,
        payload: {
          status: session.status,
        },
      }),
    );

    return session;
  }

  async listSessions({ runId }) {
    await this.getRunState(runId);
    return (await this.store.listSessions(runId))
      .filter(Boolean)
      .sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
  }

  async getSession({ runId, sessionId, includeTurns = false, sync = false }) {
    const session = await this.getSessionState(runId, sessionId);
    const run = await this.getRunState(runId);
    const artifact = this.requireArtifact(run);
    const node = this.getExecutableNode(artifact, session.nodeId);
    const adapter = this.runtimeRegistry.selectRuntimeForNode(node);
    adapter.registerSession(session);

    let runtimeThread = null;
    if (sync) {
      runtimeThread = await adapter.readSession({
        session,
      });
      session.preview = runtimeThread?.preview ?? session.preview;
      session.updatedAt = this.now();
      await this.store.saveSession(session);
    }

    const response = {
      session,
      runtimeThread,
    };

    if (includeTurns) {
      response.turns = latestSessionTurns(await this.store.listSessionTurns(runId, sessionId));
    }

    return response;
  }

  async listSessionTurns({ runId, sessionId }) {
    await this.getSessionState(runId, sessionId);
    return latestSessionTurns(await this.store.listSessionTurns(runId, sessionId));
  }

  async submitSessionTurn({
    runId,
    sessionId,
    actor = "operator",
    clientTurnId,
    input,
    planVersion,
    graphVersion,
    artifactHash,
    nodeId,
    nodeRevision,
  }) {
    return this.withSessionLock(runId, sessionId, async () => {
      const session = await this.getSessionState(runId, sessionId);
      const run = await this.getRunState(runId);
      const artifact = this.requireArtifact(run);
      const node = this.getExecutableNode(artifact, nodeId ?? session.nodeId);

      ensureFreshness({
        artifact,
        planVersion,
        artifactHash,
        graphVersion,
        node,
        nodeRevision: nodeRevision ?? session.nodeRevision,
      });
      this.ensureExecutableApproval(artifact, node);

      if (["failed", "cancelled", "completed"].includes(session.status)) {
        throw new ValidationError("This session is no longer accepting turns.", {
          runId,
          sessionId,
          status: session.status,
        });
      }

      const turns = latestSessionTurns(await this.store.listSessionTurns(runId, sessionId));
      if (clientTurnId) {
        const existingTurn = turns.find((turn) => turn.clientTurnId === clientTurnId);
        if (existingTurn) {
          return {
            session,
            turn: existingTurn,
          };
        }
      }

      if (session.activeTurnId) {
        const activeTurn = turns.find((turn) => turn.turnId === session.activeTurnId);
        if (activeTurn && ["accepted", "running"].includes(activeTurn.status)) {
          throw new ValidationError("A session may only have one active turn at a time.", {
            runId,
            sessionId,
            activeTurnId: session.activeTurnId,
          });
        }
      }

      const createdAt = this.now();
      const normalizedInput = Array.isArray(input)
        ? input
        : typeof input === "string"
          ? [
              {
                type: "text",
                text: input,
                text_elements: [],
              },
            ]
          : input
            ? [input]
            : [];
      const turn = createSessionTurn({
        sessionId,
        runId,
        sequence: (turns.at(-1)?.sequence ?? 0) + 1,
        clientTurnId,
        input: normalizedInput,
      });
      await this.store.appendSessionTurn(runId, sessionId, turn);

      session.status = "starting";
      session.activeTurnId = turn.turnId;
      session.turnCount = turn.sequence;
      session.updatedAt = createdAt;
      session.planVersion = artifact.planVersion;
      session.artifactHash = artifact.artifactHash;
      session.nodeRevision = node.revision;
      await this.store.saveSession(session);

      await this.appendAudit(
        runId,
        createAuditRecord({
          runId,
          action: "turn.accepted",
          actor,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          nodeId: node.id,
          details: {
            sessionId,
            turnId: turn.turnId,
            clientTurnId,
          },
          timestamp: createdAt,
        }),
      );

      await this.emit(
        runId,
        makeEvent({
          runId,
          type: "turn.accepted",
          timestamp: createdAt,
          nodeId: node.id,
          sessionId,
          turnId: turn.turnId,
          runtimeSessionId: session.runtimeSessionId,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          payload: {
            sequence: turn.sequence,
          },
        }),
      );

      const adapter = this.runtimeRegistry.selectRuntimeForNode(node);
      adapter.registerSession(session);
      this.ensureRuntimeRelay({
        runId,
        adapter,
      });

      const startedTurn = await adapter.submitSessionTurn({
        runId,
        session,
        turn,
        input: normalizedInput,
      });

      session.status = "running";
      session.updatedAt = this.now();
      await this.store.saveSession(session);

      await this.store.appendSessionTurn(runId, sessionId, {
        ...turn,
        status: "running",
        runtimeTurnId: startedTurn.runtimeTurnId,
        startedAt: startedTurn.turn?.startedAt ?? createdAt,
      });

      return {
        session,
        turn: {
          ...turn,
          status: "running",
          runtimeTurnId: startedTurn.runtimeTurnId,
          startedAt: startedTurn.turn?.startedAt ?? createdAt,
        },
      };
    });
  }

  async interruptSession({ runId, sessionId, actor = "operator" }) {
    return this.withSessionLock(runId, sessionId, async () => {
      const session = await this.getSessionState(runId, sessionId);
      const run = await this.getRunState(runId);
      const artifact = this.requireArtifact(run);
      const node = this.getExecutableNode(artifact, session.nodeId);
      const adapter = this.runtimeRegistry.selectRuntimeForNode(node);
      adapter.registerSession(session);

      const turns = latestSessionTurns(await this.store.listSessionTurns(runId, sessionId));
      const activeTurn = turns.find((turn) => turn.turnId === session.activeTurnId);
      await adapter.interruptSession({
        session,
        turn: activeTurn,
      });

      session.status = "paused";
      session.activeTurnId = null;
      session.updatedAt = this.now();
      await this.store.saveSession(session);
      await this.appendAudit(
        runId,
        createAuditRecord({
          runId,
          action: "session.cancelled",
          actor,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          nodeId: node.id,
          details: {
            sessionId,
            turnId: activeTurn?.turnId,
          },
          timestamp: session.updatedAt,
        }),
      );

      return session;
    });
  }

  async close() {
    await Promise.all(
      this.runtimeRegistry
        .listRuntimeAdapters()
        .map((adapter) => adapter.close?.())
        .filter(Boolean),
    );
    this.runtimeRelays.clear();
    this.subscribers.clear();
  }

  dependenciesSatisfied(plan, node) {
    return node.dependsOn.every((dependencyId) => {
      const dependency = plan.nodes.find((candidate) => candidate.id === dependencyId);
      return dependency && (dependency.executionStatus === "succeeded" || dependency.reviewStatus === "approved");
    });
  }

  async executeApprovedNodes({ runId, actor = "operator" }) {
    const run = await this.getRunState(runId);
    const artifact = this.requireArtifact(run);
    const executableNode = artifact.plan.nodes.find(
      (node) =>
        (isRuntimeNode(node) || isDeterministicExecutionNode(node)) &&
        ["not_started", "paused"].includes(node.executionStatus) &&
        this.dependenciesSatisfied(artifact.plan, node),
    );

    if (!executableNode) {
      throw new ValidationError("No executable node is ready for runtime dispatch.", {
        runId,
      });
    }

    if (isDeterministicExecutionNode(executableNode)) {
      const semanticNode = artifact.plan.nodes.find((node) => node.id === executableNode.inputNodeId);
      if (!semanticNode?.admittedOutput) {
        throw new ValidationError("Deterministic execution requires admitted semantic output.", {
          runId,
          nodeId: executableNode.id,
          inputNodeId: executableNode.inputNodeId,
        });
      }

      const review = collectDeterministicExecutionReview(artifact, executableNode);
      if (review.blocking) {
        const pausedAt = this.now();
        updatePlanNode(artifact.plan, executableNode.id, (node) => ({
          ...node,
          executionStatus: "paused",
          reviewStatus: "blocked",
          riskFlags: mergeRiskFlags(node.riskFlags, ["deterministic_execution_blocked"]),
        }));
        const checkpoint = createCheckpoint({
          runId,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          afterNodeId: executableNode.id,
          reason: "awaiting_issue_resolution",
          createdAt: pausedAt,
        });
        artifact.plan.status = "paused";
        artifact.plan.checkpoints.push(checkpoint);
        run.latestCheckpointId = checkpoint.id;
        run.inspectors = buildDeterministicInspectorPayloadMap(artifact);
        await this.saveRunState(run);
        await this.appendAudit(
          runId,
          createAuditRecord({
            runId,
            action: "run.paused",
            actor,
            planVersion: artifact.planVersion,
            artifactHash: artifact.artifactHash,
            nodeId: executableNode.id,
            details: {
              checkpointId: checkpoint.id,
              reason: checkpoint.reason,
              blockingReason: review.blockingReason,
              issues: review.issues,
            },
            timestamp: pausedAt,
          }),
        );
        await this.emit(
          runId,
          makeEvent({
            runId,
            type: "risk.detected",
            timestamp: pausedAt,
            nodeId: executableNode.id,
            planVersion: artifact.planVersion,
            artifactHash: artifact.artifactHash,
            payload: {
              blocking: true,
              blockingReason: review.blockingReason,
              issues: review.issues,
              evidence: review.evidence,
              interventions: review.interventions,
            },
          }),
        );
        await this.emit(
          runId,
          makeEvent({
            runId,
            type: "checkpoint.created",
            timestamp: pausedAt,
            nodeId: executableNode.id,
            planVersion: artifact.planVersion,
            artifactHash: artifact.artifactHash,
            payload: checkpoint,
          }),
        );
        await this.emit(
          runId,
          makeEvent({
            runId,
            type: "run.paused",
            timestamp: pausedAt,
            nodeId: executableNode.id,
            planVersion: artifact.planVersion,
            artifactHash: artifact.artifactHash,
            payload: {
              checkpointId: checkpoint.id,
              reason: checkpoint.reason,
              blockingReason: review.blockingReason,
            },
          }),
        );
        return artifact;
      }

      const startedAt = this.now();
      artifact.plan.status = "running";
      updatePlanNode(artifact.plan, executableNode.id, (node) => ({
        ...node,
        executionStatus: "running",
      }));
      await this.saveRunState(run);
      await this.emit(
        runId,
        makeEvent({
          runId,
          type: "node.updated",
          timestamp: startedAt,
          nodeId: executableNode.id,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          payload: {
            executionStatus: "running",
          },
        }),
      );

      try {
        const hostResult = await this.hostFunctionRegistry.invoke(executableNode.targetSymbol, semanticNode.admittedOutput, {
          runId,
          artifact,
          node: executableNode,
          inputNode: semanticNode,
          intent: run.intent,
        });
        const completedAt = this.now();
        updatePlanNode(artifact.plan, executableNode.id, (node) => ({
          ...node,
          executionStatus: "succeeded",
          reviewStatus: "approved",
          outputSummary:
            hostResult?.outputSummary ??
            hostResult?.summary ??
            `Deterministic host function '${node.targetSymbol}' completed.`,
        }));
        if (hostResult?.stateEffect) {
          const nextStateEffect = {
            ...cloneJson(executableNode.stateEffectPreview ?? {}),
            ...cloneJson(hostResult.stateEffect),
            id:
              hostResult.stateEffect.id ??
              executableNode.stateEffectPreview?.id ??
              `effect.${runId}.applied`,
          };
          updatePlanNode(artifact.plan, executableNode.id, (node) => ({
            ...node,
            stateEffectPreview: nextStateEffect,
          }));
          replaceStateEffectPreview(artifact.plan, nextStateEffect);
        }
        artifact.plan.status = "completed";
        run.inspectors = buildDeterministicInspectorPayloadMap(artifact);
        if (hostResult?.inspectorPatch) {
          run.inspectors[executableNode.id] = mergeInspectorPayload(
            run.inspectors[executableNode.id],
            hostResult.inspectorPatch,
          );
        }
        await this.saveRunState(run);
        await this.appendAudit(
          runId,
          createAuditRecord({
            runId,
            action: "run.completed",
            actor,
            planVersion: artifact.planVersion,
            artifactHash: artifact.artifactHash,
            nodeId: executableNode.id,
            details: {
              targetSymbol: executableNode.targetSymbol,
              ...(hostResult?.auditDetails ?? {}),
            },
            timestamp: completedAt,
          }),
        );
        await this.emit(
          runId,
          makeEvent({
            runId,
            type: "node.updated",
            timestamp: completedAt,
            nodeId: executableNode.id,
            planVersion: artifact.planVersion,
            artifactHash: artifact.artifactHash,
            payload: {
              executionStatus: "succeeded",
            },
          }),
        );
        await this.emit(
          runId,
          makeEvent({
            runId,
            type: "run.completed",
            timestamp: completedAt,
            nodeId: executableNode.id,
            planVersion: artifact.planVersion,
            artifactHash: artifact.artifactHash,
            payload: {
              targetSymbol: executableNode.targetSymbol,
            },
          }),
        );
        return artifact;
      } catch (error) {
        updatePlanNode(artifact.plan, executableNode.id, (node) => ({
          ...node,
          executionStatus: "failed",
          reviewStatus: "blocked",
          riskFlags: mergeRiskFlags(node.riskFlags, ["deterministic_execution_failed"]),
        }));
        artifact.plan.status = "failed";
        run.inspectors = buildDeterministicInspectorPayloadMap(artifact);
        await this.saveRunState(run);
        const failedAt = this.now();
        await this.appendAudit(
          runId,
          createAuditRecord({
            runId,
            action: "run.failed",
            actor,
            planVersion: artifact.planVersion,
            artifactHash: artifact.artifactHash,
            nodeId: executableNode.id,
            details: {
              message: error.message,
              targetSymbol: executableNode.targetSymbol,
            },
            timestamp: failedAt,
          }),
        );
        await this.emit(
          runId,
          makeEvent({
            runId,
            type: "run.failed",
            timestamp: failedAt,
            nodeId: executableNode.id,
            planVersion: artifact.planVersion,
            artifactHash: artifact.artifactHash,
            payload: {
              message: error.message,
              targetSymbol: executableNode.targetSymbol,
            },
          }),
        );
        throw error;
      }
    }

    artifact.plan.status = "running";
    updatePlanNode(artifact.plan, executableNode.id, (node) => ({
      ...node,
      executionStatus: "running",
    }));

    const startedAt = this.now();
    await this.saveRunState(run);
    await this.emit(
      runId,
      makeEvent({
        runId,
        type: "node.updated",
        timestamp: startedAt,
        nodeId: executableNode.id,
        planVersion: artifact.planVersion,
        artifactHash: artifact.artifactHash,
        payload: {
          executionStatus: "running",
        },
      }),
    );

    const adapter = this.runtimeRegistry.selectRuntimeForNode(executableNode);
    this.ensureRuntimeRelay({
      runId,
      adapter,
    });
    let result;

    try {
      result = await adapter.executeNode({
        runId,
        node: artifact.plan.nodes.find((node) => node.id === executableNode.id),
        artifact,
        intent: run.intent,
      });
    } catch (error) {
      updatePlanNode(artifact.plan, executableNode.id, (node) => ({
        ...node,
        executionStatus: "failed",
        reviewStatus: "blocked",
        riskFlags: mergeRiskFlags(node.riskFlags, ["runtime_connector_failure"]),
      }));
      artifact.plan.status = "failed";
      run.inspectors = buildDeterministicInspectorPayloadMap(artifact);
      await this.saveRunState(run);

      const failedAt = this.now();
      await this.appendAudit(
        runId,
        createAuditRecord({
          runId,
          action: "run.failed",
          actor,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          nodeId: executableNode.id,
          details: {
            message: error.message,
          },
          timestamp: failedAt,
        }),
      );

      await this.emit(
        runId,
        makeEvent({
          runId,
          type: "run.failed",
          timestamp: failedAt,
          nodeId: executableNode.id,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          payload: {
            message: error.message,
          },
        }),
      );

      throw error;
    }

    if (result.executionStatus === "failed") {
      const failedAt = this.now();
      updatePlanNode(artifact.plan, executableNode.id, (node) => ({
        ...node,
        executionStatus: "failed",
        reviewStatus: "blocked",
        outputSummary: result.outputSummary ?? "Runtime execution failed before semantic admission.",
        riskFlags: mergeRiskFlags(node.riskFlags, ["runtime_connector_failure"]),
      }));
      artifact.plan.status = "failed";
      run.inspectors = buildDeterministicInspectorPayloadMap(artifact);
      await this.saveRunState(run);

      await this.appendAudit(
        runId,
        createAuditRecord({
          runId,
          action: "run.failed",
          actor,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          nodeId: executableNode.id,
          details: {
            message: result.outputSummary ?? "Runtime execution failed before semantic admission.",
          },
          timestamp: failedAt,
        }),
      );

      await this.emit(
        runId,
        makeEvent({
          runId,
          type: "run.failed",
          timestamp: failedAt,
          nodeId: executableNode.id,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          payload: {
            message: result.outputSummary ?? "Runtime execution failed before semantic admission.",
          },
        }),
      );

      throw new ValidationError("Runtime execution failed before semantic admission.", {
        runId,
        nodeId: executableNode.id,
        outputSummary: result.outputSummary,
      });
    }

    const admittedOutput = admitSemanticOutput({
      node: executableNode,
      output:
        result.admittedOutput == null
          ? result.raw?.stdout
          : JSON.stringify(result.admittedOutput),
      details: {
        runId,
        nodeId: executableNode.id,
      },
    });
    const emittedAt = this.now();
    updatePlanNode(artifact.plan, executableNode.id, (node) => ({
      ...node,
      executionStatus: "succeeded",
      reviewStatus: "approved",
      outputSummary: result.outputSummary ?? node.outputSummary,
      admittedOutput,
    }));

    const deterministicNode = artifact.plan.nodes.find(
      (node) => isDeterministicExecutionNode(node) && node.inputNodeId === executableNode.id,
    );
    let preview = deterministicNode?.stateEffectPreview ?? null;
    if (deterministicNode) {
      try {
        const previewResult = await this.hostFunctionRegistry.preview(deterministicNode.targetSymbol, admittedOutput, {
          runId,
          artifact,
          node: deterministicNode,
          inputNode: executableNode,
          intent: run.intent,
        });
        if (previewResult) {
          preview = {
            ...cloneJson(deterministicNode.stateEffectPreview ?? {}),
            ...cloneJson(previewResult),
            id:
              deterministicNode.stateEffectPreview?.id ??
              previewResult.id ??
              `effect.${runId}.planned`,
          };
        }
      } catch {
        preview = deterministicNode.stateEffectPreview;
      }

      const updatedDeterministicNode = updatePlanNode(artifact.plan, deterministicNode.id, (node) => ({
        ...node,
        revision: node.revision + 1,
        inputSummary: `Admitted semantic output is ready for ${node.targetSymbol}.`,
        stateEffectPreview: preview ?? node.stateEffectPreview,
      }));
      if (preview) {
        replaceStateEffectPreview(artifact.plan, preview);
      }
      syncApprovalGateNode(artifact.plan, deterministicNode.id, {
        status: "pending",
        nodeRevision: updatedDeterministicNode.revision,
      });
      const approvalNode = artifact.plan.nodes.find(
        (node) => node.nodeType === "approval_gate" && node.targetNodeId === deterministicNode.id,
      );
      if (approvalNode) {
        updatePlanNode(artifact.plan, approvalNode.id, (node) => ({
          ...node,
          reviewStatus: "warning",
          executionStatus: "paused",
        }));
      }
    }

    const checkpoint = createCheckpoint({
      runId,
      planVersion: artifact.planVersion,
      artifactHash: artifact.artifactHash,
      afterNodeId: executableNode.id,
      reason: "awaiting_approval",
      createdAt: emittedAt,
    });

    artifact.plan.checkpoints.push(checkpoint);
    artifact.plan.status = "paused";
    run.latestCheckpointId = checkpoint.id;
    run.inspectors = buildDeterministicInspectorPayloadMap(artifact);
    if (result.inspectorPatch) {
      run.inspectors[executableNode.id] = mergeInspectorPayload(
        run.inspectors[executableNode.id],
        result.inspectorPatch,
      );
    }

    await this.saveRunState(run);

    await this.appendAudit(
      runId,
      createAuditRecord({
        runId,
        action: "run.paused",
        actor,
        planVersion: artifact.planVersion,
        artifactHash: artifact.artifactHash,
        nodeId: executableNode.id,
        details: {
          checkpointId: checkpoint.id,
          reason: checkpoint.reason,
        },
        timestamp: emittedAt,
      }),
    );

    const deterministicReview = deterministicNode
      ? collectDeterministicExecutionReview(artifact, deterministicNode)
      : {
          issues: [],
          evidence: [],
          interventions: [],
          blocking: false,
          blockingReason: null,
        };

    if (
      deterministicNode &&
      (deterministicReview.issues.length > 0 ||
        deterministicReview.evidence.length > 0 ||
        deterministicReview.interventions.length > 0)
    ) {
      await this.emit(
        runId,
        makeEvent({
          runId,
          type: "risk.detected",
          timestamp: emittedAt,
          nodeId: deterministicNode.id,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          payload: {
            blocking: deterministicReview.blocking,
            blockingReason: deterministicReview.blockingReason,
            issues: deterministicReview.issues,
            evidence: deterministicReview.evidence,
            interventions: deterministicReview.interventions,
          },
        }),
      );
    }

    if (preview) {
      await this.emit(
        runId,
        makeEvent({
          runId,
          type: "state_effect.available",
          timestamp: emittedAt,
          nodeId: deterministicNode?.id,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          payload: preview,
        }),
      );
    }

    const approvalGate = deterministicNode ? getApprovalGate(artifact, deterministicNode.id) : null;
    if (approvalGate) {
      await this.emit(
        runId,
        makeEvent({
          runId,
          type: "approval.required",
          timestamp: emittedAt,
          nodeId: deterministicNode.id,
          planVersion: artifact.planVersion,
          artifactHash: artifact.artifactHash,
          payload: {
            gateId: approvalGate.id,
            reason: approvalGate.reason,
          },
        }),
      );
    }

    await this.emit(
      runId,
      makeEvent({
        runId,
        type: "checkpoint.created",
        timestamp: emittedAt,
        nodeId: executableNode.id,
        planVersion: artifact.planVersion,
        artifactHash: artifact.artifactHash,
        payload: checkpoint,
      }),
    );
    await this.emit(
      runId,
      makeEvent({
        runId,
        type: "run.paused",
        timestamp: emittedAt,
        nodeId: executableNode.id,
        planVersion: artifact.planVersion,
        artifactHash: artifact.artifactHash,
        payload: {
          checkpointId: checkpoint.id,
          reason: checkpoint.reason,
        },
      }),
    );

    return artifact;
  }

  async pauseRun({ runId, actor = "operator", reason = "manual_pause" }) {
    const run = await this.getRunState(runId);
    const artifact = this.requireArtifact(run);
    const runningNode = artifact.plan.nodes.find((node) => node.executionStatus === "running");
    if (runningNode && isRuntimeNode(runningNode)) {
      const adapter = this.runtimeRegistry.selectRuntimeForNode(runningNode);
      await adapter.pauseRun({
        runId,
        reason,
      });
    }

    const checkpoint = createCheckpoint({
      runId,
      planVersion: artifact.planVersion,
      artifactHash: artifact.artifactHash,
      afterNodeId: runningNode?.id,
      reason,
      createdAt: this.now(),
    });

    artifact.plan.status = "paused";
    artifact.plan.checkpoints.push(checkpoint);
    run.latestCheckpointId = checkpoint.id;
    await this.saveRunState(run);

    await this.appendAudit(
      runId,
      createAuditRecord({
        runId,
        action: "run.paused",
        actor,
        planVersion: artifact.planVersion,
        artifactHash: artifact.artifactHash,
        details: {
          checkpointId: checkpoint.id,
          reason,
        },
        timestamp: checkpoint.createdAt,
      }),
    );

    await this.emit(
      runId,
      makeEvent({
        runId,
        type: "checkpoint.created",
        timestamp: checkpoint.createdAt,
        planVersion: artifact.planVersion,
        artifactHash: artifact.artifactHash,
        payload: checkpoint,
      }),
    );

    await this.emit(
      runId,
      makeEvent({
        runId,
        type: "run.paused",
        timestamp: checkpoint.createdAt,
        planVersion: artifact.planVersion,
        artifactHash: artifact.artifactHash,
        payload: {
          checkpointId: checkpoint.id,
          reason,
        },
      }),
    );

    return artifact;
  }

  async resumeFromCheckpoint({
    runId,
    checkpointId,
    actor = "operator",
    planVersion,
    artifactHash,
    nodeId,
    nodeRevision,
  }) {
    const run = await this.getRunState(runId);
    const artifact = this.requireArtifact(run);
    const checkpoint = artifact.plan.checkpoints.find((candidate) => candidate.id === checkpointId);

    if (!isCheckpointFresh(checkpoint, artifact, planVersion, artifactHash)) {
      throw new ValidationError("Checkpoint resume requires a fresh checkpoint identity.", {
        runId,
        checkpointId,
        currentPlanVersion: artifact.planVersion,
        currentArtifactHash: artifact.artifactHash,
      });
    }

    if (checkpoint.status === "consumed") {
      throw new ValidationError("Checkpoint resume requires an available checkpoint.", {
        runId,
        checkpointId,
      });
    }

    const deterministicNode =
      (nodeId ? getNodeById(artifact, nodeId) : null) ??
      artifact.plan.nodes.find(
        (node) =>
          isDeterministicExecutionNode(node) &&
          ["not_started", "paused"].includes(node.executionStatus) &&
          this.dependenciesSatisfied(artifact.plan, node),
      );
    if (!deterministicNode) {
      throw new ValidationError("Checkpoint resume requires a ready deterministic_execution node.", {
        runId,
        checkpointId,
      });
    }

    ensureFreshness({
      artifact,
      planVersion,
      artifactHash,
      node: deterministicNode,
      nodeRevision,
    });

    const approvalGate = getApprovalGate(artifact, deterministicNode.id);
    if (approvalGate?.required && approvalGate.status !== "approved") {
      throw new ValidationError("Checkpoint resume requires a fresh approval for deterministic execution.", {
        runId,
        checkpointId,
        nodeId: deterministicNode.id,
        gateId: approvalGate.id,
        gateStatus: approvalGate.status,
      });
    }

    const resumedAt = this.now();
    checkpoint.status = "consumed";

    await this.emit(
      runId,
      makeEvent({
        runId,
        type: "run.resumed",
        timestamp: resumedAt,
        planVersion: artifact.planVersion,
        artifactHash: artifact.artifactHash,
        payload: {
          checkpointId,
        },
      }),
    );

    await this.appendAudit(
      runId,
      createAuditRecord({
        runId,
        action: "run.resumed",
        actor,
        planVersion: artifact.planVersion,
        artifactHash: artifact.artifactHash,
        details: {
          checkpointId,
        },
        timestamp: resumedAt,
      }),
    );
    await this.saveRunState(run);
    return this.executeApprovedNodes({
      runId,
      actor,
    });
  }
}

function mergeStateEffects(current, incoming) {
  const map = new Map(current.map((effect) => [effect.id, effect]));

  for (const effect of incoming) {
    map.set(effect.id, effect);
  }

  return [...map.values()];
}
