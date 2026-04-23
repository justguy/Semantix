import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import test from "node:test";

import { HostFunctionRegistry } from "../../packages/core/src/host-function-registry.js";
import { ControlPlaneService } from "../src/control-plane-service.js";
import { CodexCliRuntimeAdapter } from "../src/runtime-adapters/codex-cli-runtime-adapter.js";
import { RuntimeRegistry } from "../src/runtime-registry.js";
import { FileRunStore } from "../src/storage/file-run-store.js";

const DEFAULT_TARGET_SYMBOL = "semantix.host.apply_admitted_semantic";

class FakeSessionConnector {
  onNotification() {
    return () => {};
  }

  async healthCheck() {
    return {
      healthy: true,
      transport: "fake-app-server",
    };
  }
}

function createRunnerResult(value) {
  return {
    exitCode: 0,
    stdout: typeof value === "string" ? value : JSON.stringify(value),
    stderr: "",
  };
}

function createBlueprint({
  allowedRoot,
  forbiddenRoots = ["/root"],
  targetSymbol = DEFAULT_TARGET_SYMBOL,
  extraHardConstraints = [],
} = {}) {
  return {
    intent_contract: {
      primary_directive: "Implement the Semantix v0 governed execution slice.",
      strict_boundaries: ["No transcript-derived authority."],
      success_state: "A deterministic host function receives only admitted semantic output.",
    },
    semantic_frames: [
      {
        frame_id: "frame.semantic.generate",
        node_id: "node.semantic.generate",
        prompt: "Compile a strict JSON proposal for deterministic execution.",
        context: {
          phase: "v0",
        },
        hard_constraints: [
          {
            kind: "path_policy",
            field: "workspace_path",
            required: true,
            allowed_roots: [allowedRoot],
            forbidden_roots: forbiddenRoots,
          },
          ...extraHardConstraints,
        ],
      },
    ],
    execution_graph: {
      nodes: [
        {
          node_id: "node.semantic.generate",
          kind: "semantic_generation",
          title: "Compile Semantic Output",
          depends_on: [],
          frame_id: "frame.semantic.generate",
          base_validation_schema: {
            type: "object",
            additionalProperties: false,
            required: ["workspace_path", "summary"],
            properties: {
              workspace_path: {
                type: "string",
              },
              summary: {
                type: "string",
              },
            },
          },
        },
        {
          node_id: "node.approval.execute",
          kind: "approval_gate",
          title: "Approve Deterministic Dispatch",
          depends_on: ["node.semantic.generate"],
          target_node_id: "node.execute.host",
          reason: "Fresh approval is required after semantic admission.",
        },
        {
          node_id: "node.execute.host",
          kind: "deterministic_execution",
          title: "Dispatch Host Function",
          depends_on: ["node.semantic.generate", "node.approval.execute"],
          input_node_id: "node.semantic.generate",
          target_symbol: targetSymbol,
          state_effect_preview: {
            id: "effect.preview.host",
            kind: "file",
            operation: "modify",
            target: targetSymbol,
            summary: `Preview for ${targetSymbol}.`,
            previewRef: "preview://host/1",
            policyState: "review_required",
            riskFlags: ["advisory_preview"],
            reversibility: {
              status: "reversible",
              mechanism: "host_defined",
            },
            enforcement: {
              owner: "policy",
              status: "review_required",
              details: "Advisory only in v0.",
            },
          },
        },
      ],
    },
  };
}

async function createHarness(t, options = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), "semantix-v0-"));
  const workspaceRoot = join(rootDir, "workspace");
  await mkdir(workspaceRoot, { recursive: true });

  const store = new FileRunStore({
    rootDir,
  });
  const runtimeRegistry = new RuntimeRegistry();
  const hostInvocations = [];
  const hostFunctionRegistry =
    options.hostFunctionRegistry ??
    new HostFunctionRegistry([
      {
        targetSymbol: DEFAULT_TARGET_SYMBOL,
        async preview(input) {
          return {
            id: "effect.preview.host",
            kind: "file",
            operation: "modify",
            target: input.workspace_path,
            summary: `Would modify ${input.workspace_path}.`,
            previewRef: "preview://host/1",
            policyState: "review_required",
            riskFlags: ["advisory_preview"],
            reversibility: {
              status: "reversible",
              mechanism: "local_vcs",
            },
            enforcement: {
              owner: "policy",
              status: "review_required",
              details: "Advisory only in v0.",
            },
          };
        },
        async invoke(input) {
          hostInvocations.push(input);
          return {
            outputSummary: `Applied ${input.summary}.`,
          };
        },
      },
    ]);

  const adapter = new CodexCliRuntimeAdapter({
    sessionConnector: new FakeSessionConnector(),
    runner:
      options.runner ??
      (async () =>
        createRunnerResult({
          workspace_path: join(workspaceRoot, "notes.txt"),
          summary: "Write the governed output.",
        })),
  });
  runtimeRegistry.registerRuntimeAdapter(adapter);

  const service = new ControlPlaneService({
    store,
    runtimeRegistry,
    hostFunctionRegistry,
    now: options.now,
  });

  t.after(async () => {
    await service.close();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await rm(rootDir, { recursive: true, force: true });
        break;
      } catch (error) {
        if (error?.code !== "ENOTEMPTY" || attempt === 4) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  });

  return {
    rootDir,
    workspaceRoot,
    store,
    service,
    hostInvocations,
  };
}

function createFreshnessEnvelope(artifact, node, gate) {
  return {
    planVersion: artifact.planVersion,
    graphVersion: artifact.graphVersion,
    artifactHash: artifact.artifactHash,
    nodeId: node.id,
    nodeRevision: node.revision,
    gateId: gate?.id,
  };
}

async function compileRun(service, runId, workspaceRoot, overrides = {}) {
  return service.compilePlan({
    runId,
    actor: "test",
    cwd: workspaceRoot,
    blueprint:
      overrides.blueprint ??
      createBlueprint({
        allowedRoot: workspaceRoot,
        targetSymbol: overrides.targetSymbol,
        forbiddenRoots: overrides.forbiddenRoots,
        extraHardConstraints: overrides.extraHardConstraints,
      }),
  });
}

test("admits valid strict JSON, pauses for approval, and passes admitted output to a host function", async (t) => {
  const { service, workspaceRoot, hostInvocations } = await createHarness(t);
  const artifact = await compileRun(service, "run-semantic-flow", workspaceRoot);

  const pausedArtifact = await service.executeApprovedNodes({
    runId: "run-semantic-flow",
    actor: "operator",
  });
  const semanticNode = pausedArtifact.plan.nodes.find((node) => node.id === "node.semantic.generate");
  const deterministicNode = pausedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const approvalGate = pausedArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === deterministicNode.id);

  assert.equal(pausedArtifact.plan.status, "paused");
  assert.equal(semanticNode.executionStatus, "succeeded");
  assert.equal(
    semanticNode.admittedOutput.workspace_path,
    join(workspaceRoot, "notes.txt"),
  );
  assert.equal(deterministicNode.revision, 2);

  await service.submitApprovalAction({
    runId: "run-semantic-flow",
    actor: "reviewer",
    action: "approve",
    ...createFreshnessEnvelope(pausedArtifact, deterministicNode, approvalGate),
  });

  const completedArtifact = await service.resumeFromCheckpoint({
    runId: "run-semantic-flow",
    checkpointId: pausedArtifact.plan.checkpoints.at(-1).id,
    actor: "operator",
    ...createFreshnessEnvelope(pausedArtifact, deterministicNode, approvalGate),
  });

  assert.equal(completedArtifact.plan.status, "completed");
  assert.equal(hostInvocations.length, 1);
  assert.deepEqual(hostInvocations[0], semanticNode.admittedOutput);
});

test("preserves deterministic diff and issue metadata and blocks approval for flagged code changes", async (t) => {
  const issue = {
    code: "unsafe-target",
    summary: "The proposed edit targets a credential file outside the intended module.",
    blocking: true,
    evidence: [
      {
        kind: "path_match",
        detail: "workspace_path resolves to credentials/secrets.txt",
      },
    ],
    interventions: [
      {
        kind: "rewrite",
        detail: "Retarget the change to src/config/runtime.json only.",
      },
    ],
  };
  const topLevelEvidence = [
    {
      kind: "diff_hunk",
      detail: "@@ -1 +1 @@",
    },
  ];
  const topLevelInterventions = [
    {
      kind: "pause_and_review",
      detail: "Require manual review before deterministic execution.",
    },
  ];
  const { service, workspaceRoot, hostInvocations } = await createHarness(t, {
    hostFunctionRegistry: new HostFunctionRegistry([
      {
        targetSymbol: DEFAULT_TARGET_SYMBOL,
        async preview(input) {
          return {
            id: "effect.preview.host",
            kind: "file",
            operation: "modify",
            target: input.workspace_path,
            summary: `Would modify ${input.workspace_path}.`,
            previewRef: "preview://host/1",
            diff: `diff --git a/${input.workspace_path} b/${input.workspace_path}\n@@ -1 +1 @@\n-secret\n+patched\n`,
            diffPreview: "@@ -1 +1 @@\n-secret\n+patched\n",
            policyState: "block",
            riskFlags: ["unsafe_code_change"],
            issues: [issue],
            evidence: topLevelEvidence,
            interventions: topLevelInterventions,
            reversibility: {
              status: "reversible",
              mechanism: "local_vcs",
            },
            enforcement: {
              owner: "policy",
              status: "block",
              details: "Semantix flagged a high-risk target before execution.",
            },
          };
        },
        async invoke(input) {
          hostInvocations.push(input);
          return {
            outputSummary: `Applied ${input.summary}.`,
          };
        },
      },
    ]),
  });

  await compileRun(service, "run-flagged-review", workspaceRoot);
  const pausedArtifact = await service.executeApprovedNodes({
    runId: "run-flagged-review",
    actor: "operator",
  });
  const deterministicNode = pausedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const approvalGate = pausedArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === deterministicNode.id);
  const effect = pausedArtifact.plan.stateEffects.find((entry) => entry.id === "effect.preview.host");

  assert.equal(pausedArtifact.plan.status, "paused");
  assert.equal(effect.policyState, "block");
  assert.equal(effect.enforcement.status, "block");
  assert.equal(effect.diffPreview, "@@ -1 +1 @@\n-secret\n+patched\n");
  assert.deepEqual(effect.issues, [issue]);
  assert.deepEqual(effect.evidence, topLevelEvidence);
  assert.deepEqual(effect.interventions, topLevelInterventions);

  const inspector = await service.getNodeInspectorPayload({
    runId: "run-flagged-review",
    nodeId: deterministicNode.id,
  });
  const inspectorEffect = inspector.outputPreview.stateEffects.find((entry) => entry.previewRef === "preview://host/1");
  assert.ok(inspectorEffect);
  assert.equal(inspectorEffect.target, effect.target);
  assert.notEqual(inspectorEffect.target, DEFAULT_TARGET_SYMBOL);
  assert.equal(inspector.outputPreview.diff, effect.diff);
  assert.deepEqual(inspectorEffect.issues, [issue]);
  assert.deepEqual(inspector.issues, [issue]);
  assert.deepEqual(inspector.evidence, [...topLevelEvidence, ...issue.evidence]);
  assert.deepEqual(inspector.interventions, [...topLevelInterventions, ...issue.interventions]);
  assert.equal(inspector.critique.blocking, true);

  await assert.rejects(
    service.submitApprovalAction({
      runId: "run-flagged-review",
      actor: "reviewer",
      action: "approve",
      ...createFreshnessEnvelope(pausedArtifact, deterministicNode, approvalGate),
    }),
    (error) =>
      error?.code === "VALIDATION_ERROR" &&
      error?.details?.issues?.[0]?.code === "unsafe-target" &&
      error?.details?.blockingReason === issue.summary,
  );

  assert.equal(hostInvocations.length, 0);
});

test("re-pauses deterministic execution if blocking Semantix issues slip past approval state", async (t) => {
  const issue = {
    code: "unsafe-target",
    summary: "The proposal still points at a blocked file target.",
    blocking: true,
  };
  const { service, store, workspaceRoot, hostInvocations } = await createHarness(t, {
    hostFunctionRegistry: new HostFunctionRegistry([
      {
        targetSymbol: DEFAULT_TARGET_SYMBOL,
        async preview(input) {
          return {
            id: "effect.preview.host",
            kind: "file",
            operation: "modify",
            target: input.workspace_path,
            summary: `Would modify ${input.workspace_path}.`,
            previewRef: "preview://host/1",
            policyState: "block",
            riskFlags: ["unsafe_code_change"],
            issues: [issue],
            reversibility: {
              status: "reversible",
              mechanism: "local_vcs",
            },
            enforcement: {
              owner: "policy",
              status: "block",
              details: issue.summary,
            },
          };
        },
        async invoke(input) {
          hostInvocations.push(input);
          return {
            outputSummary: `Applied ${input.summary}.`,
          };
        },
      },
    ]),
  });

  await compileRun(service, "run-blocked-resume", workspaceRoot);
  const pausedArtifact = await service.executeApprovedNodes({
    runId: "run-blocked-resume",
    actor: "operator",
  });

  const run = await store.getRun("run-blocked-resume");
  const deterministicNode = run.artifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const approvalNode = run.artifact.plan.nodes.find((node) => node.id === "node.approval.execute");
  const approvalGate = run.artifact.plan.approvalGates.find((gate) => gate.targetNodeId === deterministicNode.id);
  approvalGate.status = "approved";
  deterministicNode.reviewStatus = "approved";
  approvalNode.reviewStatus = "approved";
  approvalNode.executionStatus = "succeeded";
  await store.saveRun(run);

  const resumedArtifact = await service.resumeFromCheckpoint({
    runId: "run-blocked-resume",
    checkpointId: pausedArtifact.plan.checkpoints.at(-1).id,
    actor: "operator",
    ...createFreshnessEnvelope(run.artifact, deterministicNode, approvalGate),
  });

  const resumedNode = resumedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const latestCheckpoint = resumedArtifact.plan.checkpoints.at(-1);
  assert.equal(resumedArtifact.plan.status, "paused");
  assert.equal(resumedNode.executionStatus, "paused");
  assert.equal(resumedNode.reviewStatus, "blocked");
  assert.equal(latestCheckpoint.reason, "awaiting_issue_resolution");
  assert.equal(hostInvocations.length, 0);
});

test("hard-fails semantic output with extra fields", async (t) => {
  const { service, workspaceRoot } = await createHarness(t, {
    runner: async () =>
      createRunnerResult({
        workspace_path: join(workspaceRoot, "notes.txt"),
        summary: "Write the governed output.",
        extra_field: "not allowed",
      }),
  });
  await compileRun(service, "run-extra-field", workspaceRoot);

  await assert.rejects(
    service.executeApprovedNodes({
      runId: "run-extra-field",
      actor: "operator",
    }),
    (error) => error?.code === "VALIDATION_ERROR",
  );

  const failedArtifact = await service.getCurrentArtifact("run-extra-field");
  const semanticNode = failedArtifact.plan.nodes.find((node) => node.id === "node.semantic.generate");
  assert.equal(failedArtifact.plan.status, "failed");
  assert.equal(semanticNode.executionStatus, "failed");
});

test("hard-fails semantic output with missing required fields", async (t) => {
  const { service, workspaceRoot } = await createHarness(t, {
    runner: async () =>
      createRunnerResult({
        workspace_path: join(workspaceRoot, "notes.txt"),
      }),
  });
  await compileRun(service, "run-missing-field", workspaceRoot);

  await assert.rejects(
    service.executeApprovedNodes({
      runId: "run-missing-field",
      actor: "operator",
    }),
    (error) => error?.code === "VALIDATION_ERROR",
  );
});

test("hard-fails semantic output with schema mismatch", async (t) => {
  const { service, workspaceRoot } = await createHarness(t, {
    runner: async () =>
      createRunnerResult({
        workspace_path: join(workspaceRoot, "notes.txt"),
        summary: 42,
      }),
  });
  await compileRun(service, "run-schema-mismatch", workspaceRoot);

  await assert.rejects(
    service.executeApprovedNodes({
      runId: "run-schema-mismatch",
      actor: "operator",
    }),
    (error) => error?.code === "VALIDATION_ERROR",
  );
});

test("persists approval structurally and rejects stale approval identities", async (t) => {
  const { service, workspaceRoot } = await createHarness(t);
  const compiledArtifact = await compileRun(service, "run-approval", workspaceRoot);
  const initialDeterministicNode = compiledArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const initialGate = compiledArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === initialDeterministicNode.id);
  const staleEnvelope = createFreshnessEnvelope(compiledArtifact, initialDeterministicNode, initialGate);

  const pausedArtifact = await service.executeApprovedNodes({
    runId: "run-approval",
    actor: "operator",
  });
  const deterministicNode = pausedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const approvalGate = pausedArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === deterministicNode.id);

  await assert.rejects(
    service.submitApprovalAction({
      runId: "run-approval",
      actor: "reviewer",
      action: "approve",
      ...staleEnvelope,
    }),
    (error) => error?.code === "STALE_STATE",
  );

  const approvalResult = await service.submitApprovalAction({
    runId: "run-approval",
    actor: "reviewer",
    action: "approve",
    ...createFreshnessEnvelope(pausedArtifact, deterministicNode, approvalGate),
  });

  assert.equal(approvalResult.gate.status, "approved");
  const storedArtifact = await service.getCurrentArtifact("run-approval");
  const approvalNode = storedArtifact.plan.nodes.find((node) => node.id === "node.approval.execute");
  assert.equal(approvalNode.reviewStatus, "approved");
});

test("rejects stale resume and resumes only with fresh approval", async (t) => {
  const { service, workspaceRoot, hostInvocations } = await createHarness(t);
  const compiledArtifact = await compileRun(service, "run-resume", workspaceRoot);
  const pausedArtifact = await service.executeApprovedNodes({
    runId: "run-resume",
    actor: "operator",
  });
  const deterministicNode = pausedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const approvalGate = pausedArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === deterministicNode.id);

  await service.submitApprovalAction({
    runId: "run-resume",
    actor: "reviewer",
    action: "approve",
    ...createFreshnessEnvelope(pausedArtifact, deterministicNode, approvalGate),
  });

  await assert.rejects(
    service.resumeFromCheckpoint({
      runId: "run-resume",
      checkpointId: pausedArtifact.plan.checkpoints.at(-1).id,
      actor: "operator",
      ...createFreshnessEnvelope(compiledArtifact, compiledArtifact.plan.nodes.find((node) => node.id === "node.execute.host"), compiledArtifact.plan.approvalGates[0]),
    }),
    /fresh checkpoint identity|stale/i,
  );

  const completedArtifact = await service.resumeFromCheckpoint({
    runId: "run-resume",
    checkpointId: pausedArtifact.plan.checkpoints.at(-1).id,
    actor: "operator",
    ...createFreshnessEnvelope(pausedArtifact, deterministicNode, approvalGate),
  });

  assert.equal(completedArtifact.plan.status, "completed");
  assert.equal(hostInvocations.length, 1);
});

test("rejects forbidden paths and canonicalizes absolute paths before admission", async (t) => {
  const { service, workspaceRoot } = await createHarness(t, {
    runner: async () =>
      createRunnerResult({
        workspace_path: normalize(join(workspaceRoot, "nested", "..", "allowed.txt")),
        summary: "Write the governed output.",
      }),
  });
  await compileRun(service, "run-path-ok", workspaceRoot);

  const pausedArtifact = await service.executeApprovedNodes({
    runId: "run-path-ok",
    actor: "operator",
  });
  const semanticNode = pausedArtifact.plan.nodes.find((node) => node.id === "node.semantic.generate");
  assert.equal(semanticNode.admittedOutput.workspace_path, join(workspaceRoot, "allowed.txt"));

  const forbiddenHarness = await createHarness(t, {
    runner: async () =>
      createRunnerResult({
        workspace_path: "/root/secret.txt",
        summary: "Write the governed output.",
      }),
  });
  await compileRun(forbiddenHarness.service, "run-path-forbidden", forbiddenHarness.workspaceRoot);

  await assert.rejects(
    forbiddenHarness.service.executeApprovedNodes({
      runId: "run-path-forbidden",
      actor: "operator",
    }),
    /forbidden/i,
  );
});

test("fails compilation on unsatisfiable hard-constraint merge", async (t) => {
  const { service, workspaceRoot } = await createHarness(t);
  await assert.rejects(
    compileRun(service, "run-unsat-constraints", workspaceRoot, {
      extraHardConstraints: [
        {
          kind: "schema_fragment",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["summary"],
            properties: {
              summary: {
                const: "alpha",
              },
            },
          },
        },
        {
          kind: "schema_fragment",
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["summary"],
            properties: {
              summary: {
                const: "beta",
              },
            },
          },
        },
      ],
    }),
    (error) => error?.code === "VALIDATION_ERROR",
  );
});

test("fails deterministic execution for unknown target_symbol", async (t) => {
  const { service, workspaceRoot } = await createHarness(t, {
    hostFunctionRegistry: new HostFunctionRegistry(),
  });
  const artifact = await compileRun(service, "run-unknown-target", workspaceRoot, {
    targetSymbol: "semantix.host.unknown",
  });

  const pausedArtifact = await service.executeApprovedNodes({
    runId: "run-unknown-target",
    actor: "operator",
  });
  const deterministicNode = pausedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const approvalGate = pausedArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === deterministicNode.id);

  await service.submitApprovalAction({
    runId: "run-unknown-target",
    actor: "reviewer",
    action: "approve",
    ...createFreshnessEnvelope(pausedArtifact, deterministicNode, approvalGate),
  });

  await assert.rejects(
    service.resumeFromCheckpoint({
      runId: "run-unknown-target",
      checkpointId: pausedArtifact.plan.checkpoints.at(-1).id,
      actor: "operator",
      ...createFreshnessEnvelope(pausedArtifact, deterministicNode, approvalGate),
    }),
    (error) => error?.code === "NOT_FOUND",
  );
});

test("rejects malformed artifact ingest", async (t) => {
  const { service, workspaceRoot } = await createHarness(t);

  await assert.rejects(
    service.ingestArtifact({
      runId: "run-malformed-ingest",
      actor: "operator",
      cwd: workspaceRoot,
      artifact: {
        artifact_metadata: {},
        intent_contract: {
          primary_directive: "broken",
        },
        semantic_frames: [],
        execution_graph: {},
      },
    }),
    (error) => error?.code === "VALIDATION_ERROR",
  );
});

test("invalid semantic JSON fails with no repair loop", async (t) => {
  let invocationCount = 0;
  const { service, workspaceRoot } = await createHarness(t, {
    runner: async () => {
      invocationCount += 1;
      return createRunnerResult("not-json");
    },
  });
  await compileRun(service, "run-invalid-json", workspaceRoot);

  await assert.rejects(
    service.executeApprovedNodes({
      runId: "run-invalid-json",
      actor: "operator",
    }),
    (error) => error?.code === "VALIDATION_ERROR",
  );

  assert.equal(invocationCount, 1);
});
