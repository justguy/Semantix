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
          diff_preview: "+ stale();",
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
          name: "routes/auth.ts",
          path: "routes/auth.ts",
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
