import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ControlPlaneService, HostFunctionRegistry, RuntimeRegistry } from "../../core/src/index.js";
import {
  applyAdmittedCodeChange,
  buildDeterministicCodeChangeReview,
  CodexCliConnector,
  CodexCliRuntimeAdapter,
} from "../../runtime-codex/src/index.js";
import { createControlPlaneServer } from "./http/server.js";
import { FileRunStore } from "./storage/file-run-store.js";

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_WORKSPACE_ROOT = resolve(packageDir, "..", "..");
const DEFAULT_TARGET_SYMBOL = "semantix.host.apply_admitted_semantic";

export function getDefaultDataDir() {
  return (
    process.env.SEMANTIX_STX_DATA_DIR ??
    process.env.SEMANTIX_CONTROL_PLANE_DATA_DIR ??
    join(process.cwd(), "data")
  );
}

export function getDefaultUiDir() {
  return process.env.SEMANTIX_UI_DIR ?? join(packageDir, "dist", "ui");
}

export function getDefaultWorkspaceRoot() {
  return resolve(process.env.SEMANTIX_WORKSPACE_ROOT ?? DEFAULT_WORKSPACE_ROOT);
}

function resolveSemanticFrameContext(artifact, inputNode) {
  return (
    artifact?.semantic_frames?.find(
      (frame) =>
        frame?.node_id === inputNode?.id ||
        frame?.nodeId === inputNode?.id,
    ) ?? {
      context: {
        workspace_root: getDefaultWorkspaceRoot(),
      },
    }
  );
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizePreviewChanges(input) {
  if (Array.isArray(input?.changes)) {
    return input.changes
      .filter(isObject)
      .map((change, index) => ({
        index,
        operation: change.operation,
        target: change.workspace_path,
        newTarget: change.new_workspace_path,
        summary: change.summary ?? input.summary,
        diffPreview: change.diff_preview ?? "",
      }));
  }

  if (input?.workspace_path || input?.diff_preview) {
    return [
      {
        index: 0,
        operation: "modify_file",
        target: input.workspace_path,
        summary: input.summary,
        diffPreview: input.diff_preview ?? "",
      },
    ];
  }

  return [];
}

function buildAggregateDiffPreview(input, changes) {
  if (typeof input?.diff_preview === "string" && input.diff_preview.trim()) {
    return input.diff_preview;
  }

  return changes
    .map((change) => change.diffPreview)
    .filter((diffPreview) => typeof diffPreview === "string" && diffPreview.trim())
    .join("\n");
}

function buildDefaultCodeChangePreview(input, { runId, artifact, inputNode } = {}) {
  const semanticFrameContext = resolveSemanticFrameContext(artifact, inputNode);
  const review = buildDeterministicCodeChangeReview({
    admittedOutput: input,
    semanticFrameContext,
  });
  const changes = normalizePreviewChanges(input);
  const targets = changes
    .flatMap((change) => [change.target, change.newTarget])
    .filter((target) => typeof target === "string" && target.trim());
  const target =
    targets.length === 1
      ? targets[0]
      : targets.length > 1
        ? `${targets.length} files`
        : input?.target_file ?? DEFAULT_TARGET_SYMBOL;
  const diffPreview = buildAggregateDiffPreview(input, changes);
  const policyState = review.blocking ? "block" : review.issues.length > 0 ? "review_required" : "pass";

  return {
    id: `effect.${runId ?? "run"}.code_change_preview`,
    kind: targets.length > 1 ? "file_set" : "file",
    operation: Array.isArray(input?.changes) ? "changeset" : "modify",
    target,
    targets,
    summary: input?.summary ?? "Semantix proposed a code change.",
    previewRef: `preview://${runId ?? "run"}/code-change/1`,
    diff: diffPreview,
    diffPreview,
    policyState,
    riskFlags: review.issues.map((issue) => issue.code || issue.type).filter(Boolean),
    issues: review.issues,
    evidence: review.evidence,
    interventions: review.interventions,
    effects: changes.map((change) => ({
      operation: change.operation,
      target: change.target,
      ...(change.newTarget ? { newTarget: change.newTarget } : {}),
      summary: change.summary,
      diffPreview: change.diffPreview,
    })),
    reversibility: {
      status: "reversible",
      mechanism: targets.length > 1 ? "local_file_transaction" : "local_vcs",
    },
    enforcement: {
      owner: "policy",
      status: policyState,
      details:
        review.blockingReason ??
        "Preview synthesized from the admitted Semantix code-change proposal.",
    },
  };
}

function createDefaultHostFunctionRegistry() {
  return new HostFunctionRegistry([
    {
      targetSymbol: DEFAULT_TARGET_SYMBOL,
      async preview(input, context) {
        return buildDefaultCodeChangePreview(input, context);
      },
      async invoke(input, context) {
        return applyAdmittedCodeChange({
          admittedOutput: input,
          semanticFrameContext: resolveSemanticFrameContext(context?.artifact, context?.inputNode),
          runId: context?.runId,
          nodeId: context?.node?.id,
        });
      },
    },
  ]);
}

export function createStxApplication({
  dataDir = getDefaultDataDir(),
  uiDir = getDefaultUiDir(),
  workspaceRoot = getDefaultWorkspaceRoot(),
  adapterOptions,
  connectorOptions,
} = {}) {
  const effectiveWorkspaceRoot = resolve(workspaceRoot);
  const store = new FileRunStore({
    rootDir: dataDir,
  });
  const runtimeRegistry = new RuntimeRegistry();
  const connector = new CodexCliConnector({
    codexHome:
      connectorOptions?.codexHome ??
      process.env.SEMANTIX_CODEX_HOME ??
      join(dataDir, "codex-home"),
    cwd: effectiveWorkspaceRoot,
    ...connectorOptions,
  });
  const adapter = new CodexCliRuntimeAdapter({
    connector,
    cwd: effectiveWorkspaceRoot,
    ...adapterOptions,
  });
  runtimeRegistry.registerRuntimeAdapter(adapter);

  const service = new ControlPlaneService({
    store,
    runtimeRegistry,
    hostFunctionRegistry: createDefaultHostFunctionRegistry(),
  });

  const server = createControlPlaneServer({
    service,
    uiDir,
    defaultRunCwd: effectiveWorkspaceRoot,
  });

  return {
    dataDir,
    uiDir,
    workspaceRoot: effectiveWorkspaceRoot,
    store,
    runtimeRegistry,
    connector,
    adapter,
    service,
    server,
  };
}

export const createControlPlaneApplication = createStxApplication;

export async function startStxServer({
  port = Number(process.env.PORT ?? 4401),
  host = process.env.HOST ?? "127.0.0.1",
  ...options
} = {}) {
  const application = createStxApplication(options);

  await new Promise((resolveListen, rejectListen) => {
    application.server.once("error", rejectListen);
    application.server.listen(port, host, () => {
      application.server.off("error", rejectListen);
      resolveListen();
    });
  });

  return {
    ...application,
    host,
    port,
  };
}

export async function startControlPlaneServer(options = {}) {
  return startStxServer(options);
}

async function start() {
  const application = await startStxServer();
  process.stdout.write(
    `${JSON.stringify({
      status: "listening",
      host: application.host,
      port: application.port,
      dataDir: application.dataDir,
      uiDir: application.uiDir,
    })}\n`,
  );
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (entryPath) {
  start().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
