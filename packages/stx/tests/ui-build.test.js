import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { transform } from "esbuild";
import { buildUi } from "../src/ui/build.js";

const DEFAULT_TARGET_SYMBOL = "semantix.host.apply_admitted_semantic";
const testDir = dirname(fileURLToPath(import.meta.url));

async function loadUiGlobals() {
  const source = await readFile(
    join(testDir, "..", "ui", "control-surface", "ui.jsx"),
    "utf8",
  );
  const { code } = await transform(source, {
    loader: "jsx",
    format: "iife",
  });
  const sandbox = {
    window: {},
    React: {
      useState() {},
      useEffect() {},
      useMemo() {},
      useRef() {},
      createElement() {
        return {};
      },
    },
  };
  vm.runInNewContext(code, sandbox);
  return sandbox.window;
}

test("buildUi emits the bundled Semantix control-surface assets", async (t) => {
  const uiDistDir = await mkdtemp(join(tmpdir(), "semantix-stx-ui-build-"));

  t.after(async () => {
    await rm(uiDistDir, { recursive: true, force: true });
  });

  const result = await buildUi({
    sourcemap: false,
    uiDistDir,
  });

  assert.equal(result.uiDistDir, uiDistDir);

  const indexHtml = await readFile(join(uiDistDir, "index.html"), "utf8");
  assert.match(indexHtml, /Semantix - Control Surface/);
  assert.match(indexHtml, /assets\/app\.js/);

  const bundle = await readFile(join(uiDistDir, "assets", "app.js"), "utf8");
  assert.match(bundle, /SemantixApp/);
  assert.match(bundle, /createRoot/);

  const manifest = JSON.parse(await readFile(join(uiDistDir, "asset-manifest.json"), "utf8"));
  assert.equal(manifest.entrypoint, "/assets/app.js");
});

test("control surface exposes real CodeChangeSet file targets while hiding advisory host placeholders", async () => {
  const ui = await loadUiGlobals();
  const artifact = ui.decorateArtifact({
    plan: {
      nodes: [
        {
          id: "node.semantic.generate",
          admittedOutput: {
            summary: "Update auth and session files.",
            changes: [
              {
                operation: "modify_file",
                workspace_path: "routes/auth.ts",
                diff_preview: "+ verifyEmail();\n",
              },
              {
                operation: "create_file",
                workspace_path: "routes/session.ts",
                content: "export const session = true;\n",
              },
            ],
          },
        },
        {
          id: "node.execute.host",
          nodeType: "deterministic_execution",
          approvalRequired: true,
          inputNodeId: "node.semantic.generate",
        },
      ],
      approvalGates: [
        {
          id: "gate.execute",
          targetNodeId: "node.execute.host",
          required: true,
        },
      ],
      stateEffects: [
        {
          id: "effect.real.changeset",
          kind: "file",
          operation: "modify",
          target: DEFAULT_TARGET_SYMBOL,
          summary: "Preview a multi-file CodeChangeSet.",
          policyState: "pass",
          riskFlags: [],
          reversibility: {
            status: "reversible",
          },
          enforcement: {
            owner: "policy",
            status: "pass",
          },
        },
        {
          id: "effect.advisory.placeholder",
          kind: "external_action",
          operation: "preview",
          target: DEFAULT_TARGET_SYMBOL,
          summary: "Advisory preview for deterministic host target.",
          policyState: "review_required",
          riskFlags: ["advisory_preview"],
          reversibility: {
            status: "reversible",
          },
          enforcement: {
            owner: "policy",
            status: "review_required",
            details: "state_effect_preview is advisory only in Semantix v0.",
          },
        },
      ],
    },
  });

  const displayable = ui.getDisplayableProposedChanges(artifact);
  const advisory = ui.getAdvisoryProposedChanges(artifact);

  assert.equal(displayable.length, 1);
  assert.equal(advisory.length, 1);
  assert.deepEqual(Array.from(ui.getChangeAffectedFiles(displayable[0])), [
    "routes/auth.ts",
    "routes/session.ts",
  ]);
  assert.equal(ui.getChangeTargetLabel(displayable[0]), "2 files: routes/auth.ts, routes/session.ts");
  assert.match(displayable[0].preview, /modify file .*routes\/auth\.ts/);
  assert.match(displayable[0].preview, /create file .*routes\/session\.ts/);
});
