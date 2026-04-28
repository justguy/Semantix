import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  buildDeterministicCodeChangeReview,
  normalizeStrictCompilerEnvelope,
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
