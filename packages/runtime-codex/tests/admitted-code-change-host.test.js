import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { applyAdmittedCodeChange } from "../src/admitted-code-change-host.js";

async function createWorkspace(t) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), "semantix-admitted-host-"));
  await mkdir(join(workspaceRoot, "routes"), { recursive: true });
  await mkdir(join(workspaceRoot, "src", "auth"), { recursive: true });
  await writeFile(
    join(workspaceRoot, "routes", "auth.ts"),
    "export function loginHandler() { return true; }\nexport function verifyToken() { return true; }\n",
    "utf8",
  );
  await writeFile(
    join(workspaceRoot, "src", "auth", "verifyToken.js"),
    "export function verifyToken(token) {\n  return Boolean(token);\n}\n",
    "utf8",
  );

  t.after(async () => {
    await rm(workspaceRoot, { recursive: true, force: true });
  });

  return workspaceRoot;
}

function createSemanticFrameContext(workspaceRoot) {
  return {
    context: {
      workspace_root: workspaceRoot,
    },
  };
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function assertMissing(path) {
  await assert.rejects(() => readFile(path, "utf8"), {
    code: "ENOENT",
  });
}

test("applies a simple admitted code-change diff to disk", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const targetPath = join(workspaceRoot, "routes", "auth.ts");

  const result = await applyAdmittedCodeChange({
    admittedOutput: {
      workspace_path: targetPath,
      summary: "Add email verification route with verifyToken().",
      diff_preview: "+ const claims = verifyToken(token);\n",
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
    semanticFrameContext: createSemanticFrameContext(workspaceRoot),
    runId: "run-simple-apply",
    nodeId: "node.execute.host",
  });

  const nextContent = await readFile(targetPath, "utf8");
  assert.match(result.outputSummary, /Recorded approved code change/);
  assert.equal(result.stateEffect.execution.mode, "simple_diff");
  assert.match(nextContent, /const claims = verifyToken\(token\);/);
});

test("records review-only semantic output without writing files", async (t) => {
  const workspaceRoot = await createWorkspace(t);

  const result = await applyAdmittedCodeChange({
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
      parameters: [],
      supporting_context: [
        {
          kind: "note",
          value: "User-stated scope is only to tell a sand and not funny joke.",
        },
      ],
    },
    semanticFrameContext: createSemanticFrameContext(workspaceRoot),
    runId: "run-semantic-only",
    nodeId: "node.execute.host",
  });

  assert.match(result.outputSummary, /Recorded approved semantic output/);
  assert.equal(result.stateEffect.kind, "semantic_output");
  assert.equal(result.stateEffect.operation, "record");
  assert.equal(result.stateEffect.execution.semanticOnly, true);
});

test("applies a CodeChangeSet transaction with modify, create, delete, and rename operations", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const authPath = join(workspaceRoot, "routes", "auth.ts");
  const verifyPath = join(workspaceRoot, "src", "auth", "verifyToken.js");
  const renamedVerifyPath = join(workspaceRoot, "src", "auth", "verify.js");
  const createdPath = join(workspaceRoot, "src", "created.js");
  const deletePath = join(workspaceRoot, "routes", "legacy.ts");
  const verifyContent = await readFile(verifyPath, "utf8");
  await writeFile(deletePath, "export const legacy = true;\n", "utf8");

  const result = await applyAdmittedCodeChange({
    admittedOutput: {
      summary: "Apply a multi-file admitted code change.",
      changes: [
        {
          operation: "modify_file",
          workspace_path: "routes/auth.ts",
          diff_preview: "+ const claims = verifyToken(token);\n",
        },
        {
          operation: "create_file",
          workspace_path: "src/created.js",
          content: "export const created = true;\n",
        },
        {
          operation: "delete_file",
          workspace_path: "routes/legacy.ts",
        },
        {
          operation: "rename_file",
          workspace_path: "src/auth/verifyToken.js",
          new_workspace_path: "src/auth/verify.js",
          precondition_sha256: sha256(verifyContent),
        },
      ],
      references: [],
      parameters: [],
      supporting_context: [],
    },
    semanticFrameContext: createSemanticFrameContext(workspaceRoot),
    runId: "run-changeset-apply",
    nodeId: "node.execute.host",
  });

  assert.equal(result.stateEffect.kind, "file_set");
  assert.equal(result.stateEffect.operation, "changeset");
  assert.equal(result.stateEffect.execution.operationCount, 4);
  assert.deepEqual(
    result.stateEffect.effects.map((effect) => effect.operation),
    ["modify_file", "create_file", "delete_file", "rename_file"],
  );
  assert.match(await readFile(authPath, "utf8"), /const claims = verifyToken\(token\);/);
  assert.equal(await readFile(createdPath, "utf8"), "export const created = true;\n");
  assert.equal(await readFile(renamedVerifyPath, "utf8"), verifyContent);
  await assertMissing(deletePath);
  await assertMissing(verifyPath);
});

test("rejects a CodeChangeSet without writing any staged changes when validation fails", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const authPath = join(workspaceRoot, "routes", "auth.ts");
  const createdPath = join(workspaceRoot, "src", "should-not-exist.js");
  const originalAuth = await readFile(authPath, "utf8");

  await assert.rejects(
    () =>
      applyAdmittedCodeChange({
        admittedOutput: {
          summary: "This should fail before writing.",
          changes: [
            {
              operation: "modify_file",
              workspace_path: "routes/auth.ts",
              diff_preview: "+ const staged = true;\n",
            },
            {
              operation: "modify_file",
              workspace_path: "routes/auth.ts",
              diff_preview: "- missing line\n",
            },
            {
              operation: "create_file",
              workspace_path: "src/should-not-exist.js",
              content: "export const shouldNotExist = true;\n",
            },
          ],
          references: [],
          parameters: [],
          supporting_context: [],
        },
        semanticFrameContext: createSemanticFrameContext(workspaceRoot),
        runId: "run-changeset-reject",
        nodeId: "node.execute.host",
      }),
    /diff_preview removal did not match/,
  );

  assert.equal(await readFile(authPath, "utf8"), originalAuth);
  await assertMissing(createdPath);
});

test("rejects CodeChangeSet path escapes", async (t) => {
  const workspaceRoot = await createWorkspace(t);

  await assert.rejects(
    () =>
      applyAdmittedCodeChange({
        admittedOutput: {
          summary: "Attempt to write outside the workspace.",
          changes: [
            {
              operation: "create_file",
              workspace_path: "../outside.js",
              content: "export const outside = true;\n",
            },
          ],
          references: [],
          parameters: [],
          supporting_context: [],
        },
        semanticFrameContext: createSemanticFrameContext(workspaceRoot),
        runId: "run-changeset-path-escape",
        nodeId: "node.execute.host",
      }),
    /outside the allowed workspace scope/,
  );
});

test("rejects unsafe create_file overwrites and allows preconditioned full-file replacement", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const targetPath = join(workspaceRoot, "routes", "auth.ts");
  const originalContent = await readFile(targetPath, "utf8");

  await assert.rejects(
    () =>
      applyAdmittedCodeChange({
        admittedOutput: {
          summary: "Attempt to overwrite without a precondition.",
          changes: [
            {
              operation: "create_file",
              workspace_path: "routes/auth.ts",
              content: "export const overwritten = true;\n",
            },
          ],
          references: [],
          parameters: [],
          supporting_context: [],
        },
        semanticFrameContext: createSemanticFrameContext(workspaceRoot),
        runId: "run-create-overwrite-reject",
        nodeId: "node.execute.host",
      }),
    /without precondition_sha256/,
  );
  assert.equal(await readFile(targetPath, "utf8"), originalContent);

  const result = await applyAdmittedCodeChange({
    admittedOutput: {
      summary: "Replace with a strict precondition.",
      changes: [
        {
          operation: "create_file",
          workspace_path: "routes/auth.ts",
          content: "export const overwritten = true;\n",
          precondition_sha256: sha256(originalContent),
        },
      ],
      references: [],
      parameters: [],
      supporting_context: [],
    },
    semanticFrameContext: createSemanticFrameContext(workspaceRoot),
    runId: "run-create-overwrite-accept",
    nodeId: "node.execute.host",
  });

  assert.equal(result.stateEffect.effects[0].mode, "preconditioned_overwrite");
  assert.equal(await readFile(targetPath, "utf8"), "export const overwritten = true;\n");
});

test("applies a unified admitted code-change diff to disk", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const targetPath = join(workspaceRoot, "src", "auth", "verifyToken.js");

  const result = await applyAdmittedCodeChange({
    admittedOutput: {
      workspace_path: targetPath,
      summary: "Normalize the token before verification.",
      diff_preview: [
        "@@ -1,3 +1,4 @@",
        " export function verifyToken(token) {",
        "+  const normalized = String(token || \"\");",
        "-  return Boolean(token);",
        "+  return Boolean(normalized);",
        " }",
      ].join("\n"),
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
          value: "src/auth/verifyToken.js",
        },
        {
          kind: "symbol",
          value: "verifyToken",
        },
      ],
    },
    semanticFrameContext: createSemanticFrameContext(workspaceRoot),
    runId: "run-unified-apply",
    nodeId: "node.execute.host",
  });

  const nextContent = await readFile(targetPath, "utf8");
  assert.equal(result.stateEffect.execution.mode, "unified_diff");
  assert.match(nextContent, /const normalized = String\(token \|\| ""\);/);
  assert.match(nextContent, /return Boolean\(normalized\);/);
});

test("applies a metadata-wrapped bare hunk diff from Codex", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const targetPath = join(workspaceRoot, "routes", "auth.ts");

  const result = await applyAdmittedCodeChange({
    admittedOutput: {
      workspace_path: targetPath,
      summary: "Add a harmless verification comment.",
      diff_preview: [
        "--- a/routes/auth.ts",
        "+++ b/routes/auth.ts",
        "@@",
        "+// Verification smoke check: keep auth verification routed through existing verifyToken only.",
      ].join("\n"),
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
    semanticFrameContext: createSemanticFrameContext(workspaceRoot),
    runId: "run-bare-hunk-apply",
    nodeId: "node.execute.host",
  });

  const nextContent = await readFile(targetPath, "utf8");
  assert.equal(result.stateEffect.execution.mode, "simple_diff");
  assert.match(nextContent, /Verification smoke check/);
});

test("applies a CodeChangeSet metadata-wrapped bare hunk diff from Codex", async (t) => {
  const workspaceRoot = await createWorkspace(t);
  const targetPath = join(workspaceRoot, "routes", "auth.ts");

  const result = await applyAdmittedCodeChange({
    admittedOutput: {
      summary: "Add a harmless verification comment.",
      changes: [
        {
          operation: "modify_file",
          workspace_path: "routes/auth.ts",
          diff_preview: [
            "--- a/routes/auth.ts",
            "+++ b/routes/auth.ts",
            "@@",
            "+// Verification smoke check: keep auth verification routed through existing verifyToken only.",
          ].join("\n"),
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
    semanticFrameContext: createSemanticFrameContext(workspaceRoot),
    runId: "run-changeset-bare-hunk-apply",
    nodeId: "node.execute.host",
  });

  const nextContent = await readFile(targetPath, "utf8");
  assert.equal(result.stateEffect.kind, "file_set");
  assert.equal(result.stateEffect.effects[0].mode, "simple_diff");
  assert.match(nextContent, /Verification smoke check/);
});
