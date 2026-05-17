import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { HostFunctionRegistry } from "../../packages/core/src/host-function-registry.js";
import { ControlPlaneService } from "../src/control-plane-service.js";
import { CodexCliRuntimeAdapter } from "../src/runtime-adapters/codex-cli-runtime-adapter.js";
import { RuntimeRegistry } from "../src/runtime-registry.js";
import { FileRunStore } from "../src/storage/file-run-store.js";

const TARGET_SYMBOL = "semantix.host.audit_bundle_probe";

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
    stdout: JSON.stringify(value),
    stderr: "",
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

function createAuditBlueprint(workspaceRoot) {
  return {
    intent_contract: {
      primary_directive: "Prove a stale side-effect approval can be replayed from durable evidence.",
      strict_boundaries: ["Do not rely on conversational transcript memory."],
      success_state: "A deterministic audit bundle explains what was shown, approved, invalidated, and executed.",
    },
    semantic_frames: [
      {
        frame_id: "frame.semantic.generate",
        node_id: "node.semantic.generate",
        prompt: "Compile a strict JSON proposal for deterministic execution.",
        context: {
          workspace_root: workspaceRoot,
        },
        hard_constraints: [
          {
            kind: "path_policy",
            field: "workspace_path",
            required: true,
            allowed_roots: [join(workspaceRoot, "allowed")],
            forbidden_roots: [join(workspaceRoot, "private")],
          },
        ],
      },
    ],
    constraint_irs: [
      {
        id: "constraint.audit-bundle",
        version: 1,
        sourceRef: "constraint AuditBundleProof",
        target: {
          kind: "semantic_output",
          nodeId: "node.semantic.generate",
        },
        schema: {
          requiredFields: ["workspace_path", "summary"],
        },
        pathPolicy: {
          root: ".",
          allow: ["allowed"],
          deny: ["private"],
          operations: ["modify_file"],
        },
        verifier: {
          mode: "advisory",
          checks: [
            {
              id: "groundedness.review-preview",
              kind: "groundedness",
              threshold: 0.8,
              failureSeverity: "soft",
            },
          ],
        },
        retry: {
          maxAttempts: 1,
          retryOn: ["schema"],
          failOn: ["path_policy"],
        },
        provenance: {
          required: true,
          evidenceRefs: ["preview://audit/1"],
          attachToOutput: true,
        },
        failure: {
          defaultSeverity: "hard",
          classes: [
            {
              code: "path_outside_allowlist",
              class: "path_policy",
              severity: "hard",
              retryable: false,
              message: "Paths outside the compiled allowlist fail closed.",
            },
          ],
        },
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
          constraint_ir_refs: ["constraint.audit-bundle"],
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
          target_symbol: TARGET_SYMBOL,
          state_effect_preview: {
            id: "effect.audit.host",
            kind: "file",
            operation: "modify",
            target: "workspace://audit-target",
            summary: "Preview an auditable file change.",
            previewRef: "preview://audit/1",
            policyState: "review_required",
            riskFlags: ["audit_probe"],
            reversibility: {
              status: "reversible",
              mechanism: "test_harness",
            },
            enforcement: {
              owner: "policy",
              status: "review_required",
              details: "Review must bind to a fresh preview.",
            },
            constraintIrRefs: ["constraint.audit-bundle"],
          },
        },
      ],
    },
  };
}

async function createHarness(t, options = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), "semantix-audit-bundle-"));
  const workspaceRoot = join(rootDir, "workspace");
  await mkdir(join(workspaceRoot, "allowed"), { recursive: true });

  const store = new FileRunStore({
    rootDir,
  });
  const runtimeRegistry = new RuntimeRegistry();
  const hostInvocations = [];
  const hostFunctionRegistry = new HostFunctionRegistry([
    {
      targetSymbol: TARGET_SYMBOL,
      async preview(input) {
        if (options.previewResult) {
          return options.previewResult(input);
        }
        return {
          id: "effect.audit.host",
          kind: "file",
          operation: "modify",
          target: input.workspace_path,
          summary: `Would modify ${input.workspace_path}.`,
          previewRef: "preview://audit/1",
          diff: `diff --git a/${input.workspace_path} b/${input.workspace_path}\n@@ -0,0 +1 @@\n+${input.summary}\n`,
          diffPreview: `@@ -0,0 +1 @@\n+${input.summary}\n`,
          policyState: "review_required",
          riskFlags: ["audit_probe"],
          reversibility: {
            status: "reversible",
            mechanism: "test_harness",
          },
          enforcement: {
            owner: "policy",
            status: "review_required",
            details: "Review must bind to a fresh preview.",
          },
          constraintIrRefs: ["constraint.audit-bundle"],
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
    runner: async () =>
      createRunnerResult(
        typeof options.runnerOutput === "function"
          ? options.runnerOutput({ workspaceRoot })
          : options.runnerOutput ?? {
              workspace_path: join(workspaceRoot, "allowed", "audit.txt"),
              summary: "write auditable output",
            },
      ),
  });
  runtimeRegistry.registerRuntimeAdapter(adapter);

  const service = new ControlPlaneService({
    store,
    runtimeRegistry,
    hostFunctionRegistry,
  });

  t.after(async () => {
    await service.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  return {
    service,
    workspaceRoot,
    hostInvocations,
  };
}

test("exports audit bundle with stale approval replay evidence and unsigned signing path", async (t) => {
  const { service, workspaceRoot, hostInvocations } = await createHarness(t);
  await service.compilePlan({
    runId: "run-audit-bundle",
    actor: "test",
    cwd: workspaceRoot,
    blueprint: createAuditBlueprint(workspaceRoot),
  });

  const pausedArtifact = await service.executeApprovedNodes({
    runId: "run-audit-bundle",
    actor: "operator",
  });
  const deterministicNode = pausedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const approvalGate = pausedArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === deterministicNode.id);
  const staleEnvelope = createFreshnessEnvelope(pausedArtifact, deterministicNode, approvalGate);

  await service.submitApprovalAction({
    runId: "run-audit-bundle",
    actor: "reviewer",
    action: "approve",
    reason: "initial approval",
    ...staleEnvelope,
  });

  const approvedArtifact = await service.getCurrentArtifact("run-audit-bundle");
  const approvedNode = approvedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const approvedGate = approvedArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === approvedNode.id);
  const intervenedArtifact = await service.submitIntervention({
    runId: "run-audit-bundle",
    actor: "reviewer",
    changes: {
      outputSummary: "Retargeted after reviewer mutation.",
    },
    ...createFreshnessEnvelope(approvedArtifact, approvedNode, approvedGate),
  });

  await assert.rejects(
    service.submitApprovalAction({
      runId: "run-audit-bundle",
      actor: "reviewer",
      action: "approve",
      reason: "stale approval attempt",
      ...staleEnvelope,
    }),
    (error) => error?.code === "STALE_STATE",
  );

  const freshNode = intervenedArtifact.plan.nodes.find((node) => node.id === "node.execute.host");
  const freshGate = intervenedArtifact.plan.approvalGates.find((gate) => gate.targetNodeId === freshNode.id);
  const freshApproval = await service.submitApprovalAction({
    runId: "run-audit-bundle",
    actor: "reviewer",
    action: "approve",
    reason: "fresh re-approval",
    ...createFreshnessEnvelope(intervenedArtifact, freshNode, freshGate),
  });
  const checkpoint = freshApproval.artifact.plan.checkpoints.at(-1);

  const completedArtifact = await service.resumeFromCheckpoint({
    runId: "run-audit-bundle",
    checkpointId: checkpoint.id,
    actor: "operator",
    ...createFreshnessEnvelope(freshApproval.artifact, freshNode, freshGate),
  });

  assert.equal(completedArtifact.plan.status, "completed");
  assert.equal(hostInvocations.length, 1);

  const bundle = await service.getAuditBundle({
    runId: "run-audit-bundle",
  });

  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.reviewedArtifact.artifactHash, completedArtifact.artifactHash);
  assert.equal(bundle.finalOutcome.planStatus, "completed");
  assert.equal(bundle.compiledConstraintIdentities.length, 1);
  assert.match(bundle.compiledConstraintIdentities[0].identityHash, /^[a-f0-9]{64}$/);
  assert.equal(bundle.validationResults[0].status, "admitted");
  assert.equal(bundle.verifierResults.authority, "advisory_evidence_only");
  assert.equal(bundle.verifierResults.configuredChecks[0].check.kind, "groundedness");
  assert.equal(bundle.shownStateEffects[0].preview.fidelity, "runtime_diff");
  assert.equal(bundle.shownStateEffects[0].preview.contentIsSynthetic, false);
  assert.equal(bundle.shownStateEffects[0].preview.content, undefined);
  assert.match(bundle.shownStateEffects[0].preview.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(bundle.shownStateEffects[0].preview.contentRetention, "hash_only");
  assert.match(bundle.shownStateEffects[0].preview.redactionReason, /operator-approved preview retention/);
  assert.match(bundle.validationResults[0].admittedOutputHash, /^[a-f0-9]{64}$/);
  assert.equal(bundle.validationResults[0].admittedOutputRef.retention, "hash_only");
  assert.equal(bundle.candidateMetadata[0].contextRef.retention, "hash_only");
  assert.equal(bundle.payloadPolicy.classifications.shownStateEffects.previewContent, "hash-only");
  assert.ok(bundle.sizeMetadata.previewContentBytes > 0);
  assert.ok(bundle.sizeMetadata.contextBytes > 0);
  assert.ok(bundle.sizeMetadata.admittedOutputBytes > 0);
  assert.ok(
    bundle.redactions.some((redaction) => redaction.path === "shownStateEffects.effect.audit.host.preview.content"),
  );
  assert.deepEqual(
    ["approval.accepted", "intervention.applied", "approval.stale", "run.resumed", "run.completed"].map((action) =>
      bundle.replayTimeline.some((entry) => entry.action === action),
    ),
    [true, true, true, true, true],
  );
  assert.equal(bundle.signature.status, "unsigned");
  assert.match(bundle.signature.canonicalPayloadHash, /^[a-f0-9]{64}$/);
  assert.ok(bundle.signature.signingPath.productionHardeningOutOfScope.includes("hardware or cloud KMS integration"));
});

test("audit bundle redacts oversized and disallowed payloads deterministically before export", async (t) => {
  const secretPreview = "SECRET_PREVIEW_CONTENT ".repeat(512);
  const secretVerifier = "SECRET_VERIFIER_CONTEXT ".repeat(256);
  const secretAdmittedOutput = "SECRET_ADMITTED_OUTPUT ".repeat(128);
  const { service, workspaceRoot } = await createHarness(t, {
    runnerOutput: ({ workspaceRoot }) => ({
      workspace_path: join(workspaceRoot, "allowed", "audit.txt"),
      summary: secretAdmittedOutput,
    }),
    previewResult(input) {
      return {
        id: "effect.audit.host",
        kind: "file",
        operation: "modify",
        target: input.workspace_path,
        summary: "Would modify a file with oversized preview content.",
        previewRef: "preview://audit/1",
        diff: `diff --git a/${input.workspace_path} b/${input.workspace_path}\n${secretPreview}`,
        policyState: "review_required",
        riskFlags: ["audit_probe"],
        reversibility: {
          status: "reversible",
          mechanism: "test_harness",
        },
        enforcement: {
          owner: "policy",
          status: "review_required",
        },
        constraintIrRefs: ["constraint.audit-bundle"],
      };
    },
  });
  await service.compilePlan({
    runId: "run-audit-redaction",
    actor: "test",
    cwd: workspaceRoot,
    blueprint: createAuditBlueprint(workspaceRoot),
  });

  await service.executeApprovedNodes({
    runId: "run-audit-redaction",
    actor: "operator",
  });

  const run = await service.getRunState("run-audit-redaction");
  const semanticNode = run.artifact.plan.nodes.find((node) => node.id === "node.semantic.generate");
  semanticNode.admissionEvidence.attempts[0].verifierResults = [
    {
      status: "pass",
      policyState: "pass",
      advisory: true,
      providerEvidence: [
        {
          content: secretVerifier,
          context: {
            excerpt: secretVerifier,
          },
        },
      ],
      subject: {
        raw: secretVerifier,
      },
      reference: {
        text: secretVerifier,
      },
    },
  ];
  await service.saveRunState(run);

  const firstBundle = await service.getAuditBundle({
    runId: "run-audit-redaction",
  });
  const secondBundle = await service.getAuditBundle({
    runId: "run-audit-redaction",
  });
  const serialized = JSON.stringify(firstBundle);

  assert.doesNotMatch(serialized, /SECRET_PREVIEW_CONTENT/);
  assert.doesNotMatch(serialized, /SECRET_VERIFIER_CONTEXT/);
  assert.doesNotMatch(serialized, /SECRET_ADMITTED_OUTPUT/);
  assert.equal(firstBundle.shownStateEffects[0].preview.contentRetention, "hash_only");
  assert.equal(firstBundle.verifierResults.reportedResults[0].resultRef.retention, "hash_only");
  assert.equal(firstBundle.validationResults[0].admittedOutputRef.retention, "hash_only");
  assert.equal(
    firstBundle.shownStateEffects[0].preview.contentHash,
    secondBundle.shownStateEffects[0].preview.contentHash,
  );
  assert.equal(
    firstBundle.verifierResults.reportedResults[0].resultRef.hash,
    secondBundle.verifierResults.reportedResults[0].resultRef.hash,
  );
  assert.ok(firstBundle.sizeMetadata.previewContentBytes > secretPreview.length);
  assert.ok(firstBundle.sizeMetadata.verifierEvidenceBytes > secretVerifier.length);
  assert.ok(firstBundle.redactions.some((redaction) => redaction.path.includes("verifierResults.reportedResults")));
});
