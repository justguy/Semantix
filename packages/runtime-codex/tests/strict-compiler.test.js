import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildDeterministicCodeChangeReview,
  classifyAdmissionError,
  compileConstraintBundle,
  normalizeStrictCompilerEnvelope,
  validateCandidateAgainstConstraintBundle,
} from "../src/strict-compiler.js";

const AUTH_TS_CONTENT =
  "export function loginHandler() { return true; }\nexport function verifyToken() { return true; }\n";

function sha256Text(content) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function createWorkspace(t) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "semantix-runtime-v05-"));
  await mkdir(join(workspaceRoot, "routes"), { recursive: true });
  await writeFile(
    join(workspaceRoot, "routes", "auth.ts"),
    AUTH_TS_CONTENT,
    "utf8",
  );

  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  return workspaceRoot;
}

test("flags a missing symbol reference deterministically", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const review = buildDeterministicCodeChangeReview({
    admittedOutput: {
      workspace_path: join(workspaceRoot, "routes", "auth.ts"),
      summary: "Add email verification endpoint.",
      diff_preview: "+ const claims = signToken.verify(token);",
      references: [
        {
          kind: "function",
          name: "signToken",
          required: true,
        },
      ],
      parameters: [],
      supporting_context: [
        {
          kind: "file",
          value: "routes/auth.ts",
        },
      ],
    },
    semanticFrameContext: {
      context: {
        workspace_root: workspaceRoot,
      },
    },
  });

  assert.equal(review.blocking, true);
  assert.equal(review.issues[0].code, "missing_symbol");
  assert.equal(review.issues[0].affectedSymbols[0], "signToken");
});

test("flags invented parameters with no support", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const review = buildDeterministicCodeChangeReview({
    admittedOutput: {
      workspace_path: join(workspaceRoot, "routes", "auth.ts"),
      summary: "Add email verification endpoint.",
      diff_preview: "+ const ttl = verificationWindowDays;",
      references: [
        {
          kind: "function",
          name: "verifyToken",
          required: true,
        },
      ],
      parameters: [
        {
          name: "verificationWindowDays",
          source: "invented",
        },
      ],
      supporting_context: [
        {
          kind: "file",
          value: "routes/auth.ts",
        },
      ],
    },
    semanticFrameContext: {
      context: {
        workspace_root: workspaceRoot,
      },
    },
  });

  assert.equal(review.blocking, true);
  assert.equal(review.issues[0].code, "invented_parameter");
});

test("flags target paths outside the allowed workspace", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const review = buildDeterministicCodeChangeReview({
    admittedOutput: {
      workspace_path: join(workspaceRoot, "..", "secrets.env"),
      summary: "Rewrite secrets file.",
      diff_preview: "- SECRET=prod\n+ SECRET=test\n",
      references: [
        {
          kind: "function",
          name: "verifyToken",
          required: true,
        },
      ],
      parameters: [],
      supporting_context: [
        {
          kind: "file",
          value: "routes/auth.ts",
        },
      ],
    },
    semanticFrameContext: {
      context: {
        workspace_root: workspaceRoot,
      },
    },
  });

  assert.equal(review.blocking, true);
  assert.equal(review.issues[0].code, "invalid_target_path");
});

test("flags invalid diff previews before approval", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const review = buildDeterministicCodeChangeReview({
    admittedOutput: {
      workspace_path: join(workspaceRoot, "routes", "auth.ts"),
      summary: "Update the login handler.",
      diff_preview: "@@ loginHandler\n+ const claims = verifyToken(\"demo\");\n",
      references: [
        {
          kind: "function",
          name: "verifyToken",
          required: true,
        },
      ],
      parameters: [],
      supporting_context: [
        {
          kind: "file",
          value: "routes/auth.ts",
        },
        {
          kind: "symbol",
          value: "verifyToken",
        },
      ],
    },
    semanticFrameContext: {
      context: {
        workspace_root: workspaceRoot,
      },
    },
  });

  assert.equal(review.blocking, true);
  assert.equal(review.issues[0].code, "invalid_diff_preview");
  assert.match(review.issues[0].detail, /numeric ranges/);
});

test("flags diff previews that do not match current file bytes before approval", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const review = buildDeterministicCodeChangeReview({
    admittedOutput: {
      workspace_path: join(workspaceRoot, "routes", "auth.ts"),
      summary: "Update the login handler.",
      diff_preview: " loginHandler\n+ const claims = verifyToken(\"demo\");\n",
      references: [
        {
          kind: "function",
          name: "verifyToken",
          required: true,
        },
      ],
      parameters: [],
      supporting_context: [
        {
          kind: "file",
          value: "routes/auth.ts",
        },
        {
          kind: "symbol",
          value: "verifyToken",
        },
      ],
    },
    semanticFrameContext: {
      context: {
        workspace_root: workspaceRoot,
      },
    },
  });

  assert.equal(review.blocking, true);
  assert.equal(review.issues[0].code, "invalid_diff_preview");
  assert.match(review.issues[0].detail, /context line did not match/);
});

test("flags full-file content that differs from exact prompt content", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const exactContent =
    "export function loginHandler() {\n  const claims = verifyToken(\"demo\");\n  return Boolean(claims);\n}\nexport function verifyToken() { return true; }\n";
  const alteredContent =
    "export function loginHandler() {\n const claims = verifyToken(\"demo\");\n return Boolean(claims);\n}\nexport function verifyToken() { return true; }\n";

  const review = buildDeterministicCodeChangeReview({
    admittedOutput: {
      summary: "Replace auth route exactly.",
      changes: [
        {
          operation: "modify_file",
          workspace_path: "routes/auth.ts",
          content: alteredContent,
        },
      ],
      references: [
        {
          kind: "function",
          name: "verifyToken",
          required: true,
        },
      ],
      parameters: [],
      supporting_context: [
        {
          kind: "file",
          value: "routes/auth.ts",
        },
        {
          kind: "symbol",
          value: "verifyToken",
        },
      ],
    },
    semanticFrameContext: {
      prompt: `Replace routes/auth.ts with this exact content: ${JSON.stringify(exactContent)}`,
      context: {
        workspace_root: workspaceRoot,
      },
    },
  });

  assert.equal(review.blocking, true);
  assert.equal(review.issues[0].code, "content_mismatch");
});

test("flags diff previews whose final file differs from exact prompt content", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const exactContent =
    "export function loginHandler() {\n  const claims = verifyToken(\"demo\");\n  return true;\n}\nexport function verifyToken() { return true; }\n";

  const review = buildDeterministicCodeChangeReview({
    admittedOutput: {
      workspace_path: join(workspaceRoot, "routes", "auth.ts"),
      summary: "Patch auth route exactly.",
      diff_preview: "+ const claims = verifyToken(\"demo\");\n",
      references: [
        {
          kind: "function",
          name: "verifyToken",
          required: true,
        },
      ],
      parameters: [],
      supporting_context: [
        {
          kind: "file",
          value: "routes/auth.ts",
        },
        {
          kind: "symbol",
          value: "verifyToken",
        },
      ],
    },
    semanticFrameContext: {
      prompt: `Replace routes/auth.ts with this exact content: ${JSON.stringify(exactContent)}`,
      context: {
        workspace_root: workspaceRoot,
      },
    },
  });

  assert.equal(review.blocking, true);
  assert.equal(review.issues[0].code, "content_mismatch");
});

test("accepts full-file content that matches exact prompt content", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const exactContent =
    "export function loginHandler() {\n  const claims = verifyToken(\"demo\");\n  return Boolean(claims);\n}\nexport function verifyToken() { return true; }\n";

  const review = buildDeterministicCodeChangeReview({
    admittedOutput: {
      summary: "Replace auth route exactly.",
      changes: [
        {
          operation: "modify_file",
          workspace_path: "routes/auth.ts",
          content: exactContent,
        },
      ],
      references: [
        {
          kind: "function",
          name: "verifyToken",
          required: true,
        },
      ],
      parameters: [],
      supporting_context: [
        {
          kind: "file",
          value: "routes/auth.ts",
        },
        {
          kind: "symbol",
          value: "verifyToken",
        },
      ],
    },
    semanticFrameContext: {
      prompt: `Replace routes/auth.ts with this exact content: ${JSON.stringify(exactContent)}`,
      context: {
        workspace_root: workspaceRoot,
      },
    },
  });

  assert.equal(review.blocking, false);
  assert.equal(review.issues.length, 0);
});

test("accepts a strict CodeChangeSet proposal with top-level grounding", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const review = buildDeterministicCodeChangeReview({
    admittedOutput: {
      summary: "Update auth route and add a session route.",
      changes: [
        {
          operation: "modify_file",
          workspace_path: "routes/auth.ts",
          diff_preview: "+ verifyToken();",
          precondition_sha256: sha256Text(AUTH_TS_CONTENT),
        },
        {
          operation: "create_file",
          workspace_path: "routes/session.ts",
          content: "export function sessionHandler() { return true; }\n",
        },
        {
          operation: "rename_file",
          workspace_path: "routes/auth.ts",
          new_workspace_path: "routes/authentication.ts",
          diff_preview: "rename routes/auth.ts to routes/authentication.ts",
        },
      ],
      references: [
        {
          kind: "function",
          name: "verifyToken",
          required: true,
        },
      ],
      parameters: [],
      supporting_context: [
        {
          kind: "file",
          value: "routes/auth.ts",
        },
      ],
    },
    semanticFrameContext: {
      context: {
        workspace_root: workspaceRoot,
      },
    },
  });

  assert.equal(review.blocking, false);
  assert.equal(review.issues.length, 0);
  assert.equal(review.targetPaths.length, 3);
  assert.match(review.diffPreview, /\+ verifyToken\(\);/);
});

test("accepts generated artifact targets and Semantix metadata references", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const review = buildDeterministicCodeChangeReview({
    admittedOutput: {
      summary: "Create a review-only joke artifact.",
      changes: [
        {
          operation: "create_file",
          workspace_path: ".semantix/review/run-1.json",
          summary: "Create the requested sand joke artifact.",
          content: "{\n  \"joke\": \"Why did the sand stay on the beach? Because it was sand.\"\n}\n",
        },
      ],
      references: [
        {
          kind: "file",
          name: "run-1.json",
          path: ".semantix/review/run-1.json",
          source: "transformed",
          required: true,
          supporting_context: [
            "This file path is explicitly created by the proposed create_file change.",
          ],
        },
        {
          kind: "module",
          name: "workspace_root",
          path: workspaceRoot,
          source: "grounded",
          required: true,
        },
        {
          kind: "symbol",
          name: "effect.run-1.planned",
          source: "grounded",
          required: true,
        },
        {
          kind: "dependency",
          name: "semantix.host.apply_admitted_semantic",
          source: "grounded",
          required: true,
        },
      ],
      parameters: [
        {
          name: "joke",
          source: "invented",
        },
      ],
      supporting_context: [
        {
          kind: "note",
          value: "User prompt requests a sand and not funny joke.",
        },
      ],
    },
    semanticFrameContext: {
      context: {
        workspace_root: workspaceRoot,
      },
    },
  });

  assert.equal(review.blocking, false);
  assert.equal(review.issues.length, 0);
  assert.deepEqual(review.targetPaths, [join(workspaceRoot, ".semantix/review/run-1.json")]);
});

test("accepts review-only semantic output with no repository file modifications", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const review = buildDeterministicCodeChangeReview({
    admittedOutput: {
      summary: "A dry sand joke review artifact is ready for approval.",
      workspace_path: workspaceRoot,
      diff_preview:
        "No repository file modifications are proposed. Execution is deferred pending fresh approval. Proposed target output: \"Why did the sand refuse to laugh? Because it was too dry.\"",
      references: [
        {
          kind: "file",
          name: "workspace_root",
          path: workspaceRoot,
          source: "grounded",
          required: true,
        },
      ],
      parameters: [
        {
          name: "prompt",
          source: "grounded",
          evidence: "tell me a sand and not funny joke",
        },
      ],
      supporting_context: [
        {
          kind: "note",
          value: "User-stated scope is only to tell a sand and not funny joke.",
        },
      ],
    },
    semanticFrameContext: {
      context: {
        workspace_root: workspaceRoot,
      },
    },
  });

  assert.equal(review.blocking, false);
  assert.equal(review.semanticOnly, true);
  assert.equal(review.targetPath, null);
  assert.deepEqual(review.targetPaths, []);
  assert.equal(review.issues.length, 0);
});

test("flags invalid strict CodeChangeSet proposals deterministically", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const review = buildDeterministicCodeChangeReview({
    admittedOutput: {
      summary: "Apply unsupported auth changes.",
      changes: [
        {
          operation: "patch_file",
          workspace_path: "../secrets.env",
          diff_preview: "+ SECRET=test",
        },
        {
          operation: "modify_file",
          workspace_path: "routes/auth.ts",
          diff_preview: "+ signToken();\n+ const ttl = verificationWindowDays;\n+ stale();",
          precondition_sha256: "0".repeat(64),
        },
        {
          operation: "modify_file",
          workspace_path: "routes/auth.ts",
        },
        {
          operation: "create_file",
          workspace_path: "routes/auth.ts",
          content: "export const overwritten = true;\n",
        },
      ],
      references: [
        {
          kind: "function",
          name: "signToken",
          required: true,
        },
        {
          kind: "file",
          name: "routes/missing.ts",
          path: "routes/missing.ts",
          required: true,
        },
      ],
      parameters: [
        {
          name: "verificationWindowDays",
          source: "invented",
        },
      ],
      supporting_context: [],
    },
    semanticFrameContext: {
      context: {
        workspace_root: workspaceRoot,
      },
    },
  });

  const issueCodes = new Set(review.issues.map((issue) => issue.code));
  assert.equal(review.blocking, true);
  assert.equal(issueCodes.has("invalid_target_path"), true);
  assert.equal(issueCodes.has("missing_symbol"), true);
  assert.equal(issueCodes.has("invented_parameter"), true);
  assert.equal(issueCodes.has("missing_supporting_context"), true);
  assert.equal(issueCodes.has("unsupported_change_shape"), true);
  assert.equal(issueCodes.has("stale_precondition"), true);
  assert.equal(issueCodes.has("unsupported_assumption"), true);
});

test("accepts strict CodeChangeSet create_file overwrite with matching precondition", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const review = buildDeterministicCodeChangeReview({
    admittedOutput: {
      summary: "Replace auth route with a precondition.",
      changes: [
        {
          operation: "create_file",
          workspace_path: "routes/auth.ts",
          content: "export const overwritten = true;\n",
          precondition_sha256: sha256Text(AUTH_TS_CONTENT),
        },
      ],
      references: [],
      parameters: [],
      supporting_context: [],
    },
    semanticFrameContext: {
      context: {
        workspace_root: workspaceRoot,
      },
    },
  });

  assert.equal(review.blocking, false);
  assert.equal(review.issues.length, 0);
});

test("hard-fails schema mismatch during strict compiler admission", () => {
  assert.throws(
    () =>
      normalizeStrictCompilerEnvelope({
        runId: "run-schema-mismatch",
        node: {
          id: "node.semantic.generate",
        },
        stdout: JSON.stringify({
          summary: 42,
        }),
        hardValidationSchema: {
          type: "object",
          additionalProperties: false,
          required: ["summary"],
          properties: {
            summary: {
              type: "string",
            },
          },
        },
        semanticFrameContext: {
          context: {
            workspace_root: process.cwd(),
          },
        },
      }),
    (error) => error?.code === "VALIDATION_ERROR",
  );
});

test("compiles ConstraintIR into deterministic strict compiler artifacts", () => {
  const jsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: {
      summary: {
        type: "string",
      },
      internalNotes: {
        type: "string",
      },
    },
  };
  const bundle = compileConstraintBundle({
    node: {
      id: "node.semantic.generate",
      constraintIrRefs: ["constraint.summary"],
    },
    hardValidationSchema: jsonSchema,
    constraintIRs: [
      {
        id: "constraint.summary",
        version: 1,
        sourceRef: "constraint SummaryOutput",
        target: {
          kind: "semantic_output",
          nodeId: "node.semantic.generate",
        },
        schema: {
          format: "json",
          jsonSchema,
          requiredFields: ["summary"],
          forbiddenFields: ["internalNotes"],
        },
        pathPolicy: {
          root: ".",
          allow: ["routes"],
          deny: ["routes/private"],
          operations: ["modify_file"],
        },
        capabilities: {
          required: ["read_workspace"],
          forbidden: ["network"],
          approvalRequired: ["modify_file"],
        },
        approval: {
          required: true,
          gateId: "approval.execute",
          reason: "modify_file",
        },
        retry: {
          maxAttempts: 1,
          retryOn: ["schema"],
          failOn: ["path_policy"],
        },
        verifier: {
          mode: "none",
        },
        provenance: {
          required: true,
          sources: ["semantic_frame"],
        },
        failure: {
          defaultSeverity: "hard",
          classes: [
            {
              code: "schema_mismatch",
              class: "schema",
              severity: "hard",
              retryable: true,
              message: "Retry once on schema mismatch.",
            },
          ],
        },
      },
    ],
  });

  assert.equal(bundle.version, 1);
  assert.equal(bundle.constraints.length, 1);
  assert.equal(bundle.identities.length, 1);
  assert.equal(bundle.constraints[0].compiledArtifacts.schemaValidatorRef, "constraint-artifact://constraint.summary/schema-validator");
  assert.equal(bundle.constraints[0].compiledArtifacts.fieldValidatorRef, "constraint-artifact://constraint.summary/field-validator");
  assert.equal(bundle.constraints[0].compiledArtifacts.pathPolicyRef, "constraint-artifact://constraint.summary/path-policy");
  assert.equal(bundle.constraints[0].compiledArtifacts.approvalMarkerRef, "constraint-artifact://constraint.summary/approval-marker");
  assert.equal(bundle.constraints[0].compiledArtifacts.retryPolicyRef, "constraint-artifact://constraint.summary/retry-policy");
  assert.equal(bundle.validators.structural.length, 1);
  assert.equal(bundle.validators.fields.length, 1);
  assert.equal(bundle.validators.pathPolicies.length, 1);
  assert.equal(bundle.validators.approvals.length, 1);
});

test("enforces inline node constraints alongside referenced plan constraints", () => {
  const inline = {
    id: "constraint.inline",
    sourceRef: "InlinePolicy",
    target: { kind: "semantic_output", nodeId: "node.semantic.generate" },
    schema: { forbiddenFields: ["internalNotes"] },
  };
  const planConstraint = {
    id: "constraint.plan",
    sourceRef: "PlanPolicy",
    target: { kind: "semantic_output", nodeId: "node.semantic.generate" },
    schema: { requiredFields: ["summary"] },
  };

  for (const planIRs of [[], [planConstraint]]) {
    const bundle = compileConstraintBundle({
      node: {
        id: "node.semantic.generate",
        constraintIRs: [inline],
        constraintIrRefs: planIRs.map((ir) => ir.id),
      },
      artifact: { plan: { constraintIRs: planIRs } },
    });
    assert.throws(
      () => validateCandidateAgainstConstraintBundle({
        candidate: { summary: "Ready", internalNotes: "private" },
        constraintBundle: bundle,
      }),
      (error) => error?.details?.reasonCode === "forbidden_field_present",
    );
  }
});

test("rejects unresolved constraint references instead of admitting with fallback policy", () => {
  assert.throws(
    () => compileConstraintBundle({
      node: { id: "node.semantic.generate", constraintIrRefs: ["constraint.missing"] },
      artifact: { plan: { constraintIRs: [] } },
      hardValidationSchema: { type: "object", additionalProperties: false },
    }),
    (error) => error?.code === "VALIDATION_ERROR" &&
      error?.details?.missingRefs?.[0] === "constraint.missing",
  );
});

test("does not apply another node's constraints to an unreferenced semantic node", () => {
  const bundle = compileConstraintBundle({
    node: { id: "node.summary" },
    artifact: {
      plan: {
        constraintIRs: [{
          id: "constraint.other",
          sourceRef: "OtherOutput",
          target: { kind: "semantic_output", nodeId: "node.other" },
          schema: { requiredFields: ["otherOutput"] },
        }],
      },
    },
    hardValidationSchema: {
      type: "object",
      additionalProperties: false,
      properties: { summary: { type: "string" } },
    },
  });
  assert.doesNotThrow(() => validateCandidateAgainstConstraintBundle({
    candidate: { summary: "Ready" },
    constraintBundle: bundle,
  }));
});

test("rejects missing required capabilities when the candidate omits or empties its list", () => {
  const bundle = compileConstraintBundle({
    constraintIRs: [{
      id: "constraint.capabilities",
      sourceRef: "RequiredCapabilities",
      target: { kind: "semantic_output" },
      capabilities: { required: ["read_workspace"] },
    }],
  });
  for (const candidate of [{}, { capabilities: [] }]) {
    assert.throws(
      () => validateCandidateAgainstConstraintBundle({ candidate, constraintBundle: bundle }),
      (error) => error?.details?.reasonCode === "capability_missing",
    );
  }
});

test("classifies failures using the failing constraint and exact reason before class fallback", () => {
  const retryableFailure = {
    code: "required_field_missing",
    class: "schema",
    severity: "hard",
    retryable: true,
  };
  const bundle = compileConstraintBundle({
    constraintIRs: [
      {
        id: "constraint.first",
        sourceRef: "First",
        target: { kind: "semantic_output" },
        retry: { maxAttempts: 1, retryOn: ["schema"] },
        failure: { defaultSeverity: "hard", classes: [retryableFailure] },
      },
      {
        id: "constraint.second",
        sourceRef: "Second",
        target: { kind: "semantic_output" },
        retry: { maxAttempts: 1, retryOn: ["schema"] },
        failure: {
          defaultSeverity: "hard",
          classes: [retryableFailure, {
            code: "forbidden_field_present",
            class: "schema",
            severity: "hard",
            retryable: false,
          }],
        },
      },
    ],
  });
  const failure = classifyAdmissionError({
    constraintBundle: bundle,
    error: {
      message: "Forbidden field",
      details: {
        constraintId: "constraint.second",
        reasonCode: "forbidden_field_present",
        failureClass: "schema",
      },
    },
  });
  assert.equal(failure.constraintId, "constraint.second");
  assert.equal(failure.retryable, false);
});

test("rejects unsatisfiable ConstraintIR policies deterministically", () => {
  assert.throws(
    () =>
      compileConstraintBundle({
        node: {
          id: "node.semantic.generate",
        },
        hardValidationSchema: {
          type: "object",
          additionalProperties: false,
        },
        constraintIRs: [
          {
            id: "constraint.bad",
            version: 1,
            sourceRef: "constraint BadOutput",
            target: {
              kind: "semantic_output",
              nodeId: "node.semantic.generate",
            },
            schema: {
              format: "json",
              jsonSchema: {
                type: "object",
                additionalProperties: false,
              },
              requiredFields: ["summary"],
              forbiddenFields: ["summary"],
            },
          },
        ],
      }),
    (error) =>
      error?.code === "VALIDATION_ERROR" &&
      /require and forbid the same field/.test(error.message),
  );
});

test("strict compiler envelope carries a fallback constraint bundle", () => {
  const envelope = normalizeStrictCompilerEnvelope({
    runId: "run-constraint-bundle",
    node: {
      id: "node.semantic.generate",
    },
    stdout: JSON.stringify({
      summary: "Ready.",
    }),
    hardValidationSchema: {
      type: "object",
      additionalProperties: false,
      required: ["summary"],
      properties: {
        summary: {
          type: "string",
        },
      },
    },
    semanticFrameContext: {
      context: {
        workspace_root: process.cwd(),
      },
    },
  });

  const bundle = envelope.inspectorPatch.compiler.constraintBundle;
  assert.equal(bundle.version, 1);
  assert.equal(bundle.targetNodeId, "node.semantic.generate");
  assert.equal(bundle.constraints[0].id, "node.semantic.generate.hard-validation-schema");
  assert.equal(bundle.validators.structural.length, 1);
});

test("strict compiler envelope admits through an explicit compiled constraint bundle", () => {
  const hardValidationSchema = {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: {
      summary: {
        type: "string",
      },
    },
  };
  const constraintBundle = compileConstraintBundle({
    node: {
      id: "node.semantic.generate",
    },
    hardValidationSchema,
    constraintIRs: [
      {
        id: "constraint.summary.required",
        version: 1,
        sourceRef: "constraint SummaryRequired",
        target: {
          kind: "semantic_output",
          nodeId: "node.semantic.generate",
        },
        schema: {
          format: "json",
          jsonSchema: hardValidationSchema,
          requiredFields: ["summary"],
        },
        retry: {
          maxAttempts: 1,
          retryOn: ["schema"],
          failOn: ["path_policy"],
        },
        failure: {
          defaultSeverity: "hard",
          classes: [
            {
              code: "schema_mismatch",
              class: "schema",
              severity: "hard",
              retryable: true,
            },
          ],
        },
      },
    ],
  });

  const envelope = normalizeStrictCompilerEnvelope({
    runId: "run-explicit-constraint-bundle",
    node: {
      id: "node.semantic.generate",
    },
    stdout: JSON.stringify({
      summary: "Ready.",
    }),
    hardValidationSchema,
    semanticFrameContext: {
      context: {
        workspace_root: process.cwd(),
      },
    },
    constraintBundle,
  });

  assert.equal(envelope.admissionEvidence.status, "admitted");
  assert.equal(envelope.admissionEvidence.attempts.length, 1);
  assert.equal(envelope.admissionEvidence.retryPolicy.maxAttempts, 1);
  assert.equal(
    envelope.inspectorPatch.compiler.constraintBundle.constraints[0].id,
    "constraint.summary.required",
  );
});

test("strict compiler admission rejects compiled field constraints with deterministic evidence", () => {
  const hardValidationSchema = {
    type: "object",
    additionalProperties: false,
    required: ["summary"],
    properties: {
      summary: {
        type: "string",
      },
      internalNotes: {
        type: "string",
      },
    },
  };
  const constraintBundle = compileConstraintBundle({
    node: {
      id: "node.semantic.generate",
    },
    hardValidationSchema,
    constraintIRs: [
      {
        id: "constraint.no-internal-notes",
        version: 1,
        sourceRef: "constraint NoInternalNotes",
        target: {
          kind: "semantic_output",
          nodeId: "node.semantic.generate",
        },
        schema: {
          forbiddenFields: ["internalNotes"],
        },
        retry: {
          maxAttempts: 1,
          retryOn: ["schema"],
          failOn: ["path_policy"],
        },
      },
    ],
  });

  assert.throws(
    () =>
      normalizeStrictCompilerEnvelope({
        runId: "run-field-constraint-reject",
        node: {
          id: "node.semantic.generate",
        },
        stdout: JSON.stringify({
          summary: "Ready.",
          internalNotes: "must not become trusted state",
        }),
        hardValidationSchema,
        semanticFrameContext: {
          context: {
            workspace_root: process.cwd(),
          },
        },
        constraintBundle,
      }),
    (error) =>
      error?.code === "VALIDATION_ERROR" &&
      error?.details?.reasonCode === "forbidden_field_present" &&
      error?.details?.admissionEvidence?.status === "rejected",
  );
});

test("strict compiler admission rejects non-retryable compiled path policy failures", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const hardValidationSchema = {
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
  };
  const constraintBundle = compileConstraintBundle({
    node: {
      id: "node.semantic.generate",
    },
    hardValidationSchema,
    constraintIRs: [
      {
        id: "constraint.safe-paths",
        version: 1,
        sourceRef: "constraint SafePaths",
        target: {
          kind: "semantic_output",
          nodeId: "node.semantic.generate",
        },
        pathPolicy: {
          root: ".",
          allow: ["routes"],
          deny: ["routes/private"],
          operations: ["modify_file"],
        },
        retry: {
          maxAttempts: 1,
          retryOn: ["schema"],
          failOn: ["path_policy"],
        },
      },
    ],
  });

  assert.throws(
    () =>
      normalizeStrictCompilerEnvelope({
        runId: "run-path-policy-reject",
        node: {
          id: "node.semantic.generate",
        },
        stdout: JSON.stringify({
          workspace_path: "outside.txt",
          summary: "Write outside the allowed path.",
        }),
        hardValidationSchema,
        semanticFrameContext: {
          context: {
            workspace_root: workspaceRoot,
          },
        },
        constraintBundle,
      }),
    (error) =>
      error?.code === "VALIDATION_ERROR" &&
      error?.details?.reasonCode === "path_outside_allowlist" &&
      error?.details?.retryable === false,
  );
});
