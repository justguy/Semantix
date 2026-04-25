#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import {
  createStxApplication,
  getDefaultDataDir,
  getDefaultUiDir,
  startStxServer,
} from "./application.js";
import { buildUi } from "./ui/build.js";

export async function runCli(args = process.argv.slice(2)) {
  const command = args[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command === "serve") {
    await serveUi(args.slice(1));
    return;
  }

  const application = createCliApplication();
  const { service, codexLayer } = application;

  if (command === "run") {
    renderFlow(await startCodexFlow(codexLayer, args.slice(1)));
    return;
  }

  if (command === "flow") {
    const runId = await resolveRunId(service, args[1]);
    renderFlow(await codexLayer.getFlow({ runId }));
    return;
  }

  if (command === "approve") {
    const runId = await resolveRunId(service, args[1]);
    renderFlow(await codexLayer.approveAndRun({ runId, actor: "cli" }));
    return;
  }

  if (command === "list") {
    await printRunList(service);
    return;
  }

  if (command === "graph") {
    const runId = await resolveRunId(service, args[1]);
    const artifact = await getArtifact(service, runId);
    renderGraph(runId, artifact);
    return;
  }

  if (command === "inspect") {
    const { runRef, nodeId: requestedNodeId } = parseInspectArgs(args.slice(1));
    const runId = await resolveRunId(service, runRef);
    const artifact = await getArtifact(service, runId);
    const nodeId = requestedNodeId || getDefaultInspectNodeId(artifact);

    if (!nodeId) {
      throw new Error(`Run "${runId}" does not contain any execution nodes.`);
    }

    await renderInspect(service, runId, artifact, nodeId);
    return;
  }

  if (command === "diff") {
    const { runRef, changeId } = parseDiffArgs(args.slice(1));
    const runId = await resolveRunId(service, runRef);
    const artifact = await getArtifact(service, runId);
    await renderDiff(service, runId, artifact, changeId);
    return;
  }

  fail(`Unknown command "${command}".`);
}

async function main() {
  await runCli();
}

const entryPath = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (entryPath) {
  main().catch((error) => {
    fail(error && error.message ? error.message : String(error));
  });
}

function createCliApplication() {
  return createStxApplication({
    dataDir: getDefaultDataDir(),
    uiDir: getDefaultUiDir(),
  });
}

async function startCodexFlow(codexLayer, values) {
  return codexLayer.start({
    actor: "cli",
    ...parseRunArgs(values),
  });
}

async function serveUi(values) {
  const { host, port } = parseServeArgs(values);
  await buildUi();
  const application = await startStxServer({
    host,
    port,
    dataDir: getDefaultDataDir(),
    uiDir: getDefaultUiDir(),
  });

  print(
    [
      title("stx serve"),
      metaLine("host", application.host),
      metaLine("port", application.port),
      metaLine("dataDir", application.dataDir),
      metaLine("uiDir", application.uiDir),
      "",
      section("Routes"),
      `  http://${application.host}:${application.port}/`,
      "",
      section("Legacy Redirects"),
      `  http://${application.host}:${application.port}/chat`,
      `  http://${application.host}:${application.port}/canvas`,
      `  http://${application.host}:${application.port}/how-it-works`,
    ].join("\n"),
  );
}

async function printRunList(service) {
  const runs = await getRuns(service);
  const lines = [title("stx list"), metaLine("mode", "in-process core"), metaLine("dataDir", getDefaultDataDir()), "", section("Runs")];

  if (runs.length === 0) {
    lines.push("  none");
  } else {
    runs.forEach((run) => {
      const summary = run.summary ?? {};
      lines.push(
        `  ${accent(run.runId)} ${dim(
          `(${summary.planStatus ?? "unknown"}, ${summary.nodeCount ?? 0} nodes, ${
            summary.stateEffectCount ?? 0
          } effects, updated ${formatTimestamp(run.updatedAt)})`,
        )}`,
      );
      if (run.intent?.primaryDirective) {
        lines.push(`     ${run.intent.primaryDirective}`);
      }
      if (summary.pendingApprovalCount || summary.blockedActionCount) {
        lines.push(
          `     ${dim("pendingApprovals=")}${summary.pendingApprovalCount ?? 0}  ${dim(
            "blockedActions=",
          )}${summary.blockedActionCount ?? 0}`,
        );
      }
    });
  }

  print(lines.join("\n"));
}

function renderFlow(flow) {
  const lines = [];

  lines.push(title(`stx flow ${flow.runId}`));
  lines.push(metaLine("phase", flow.phase));
  lines.push(metaLine("planVersion", flow.artifact.planVersion));
  lines.push(metaLine("artifactHash", flow.artifact.artifactHash));
  lines.push(metaLine("directive", flow.input.primaryDirective));
  lines.push(
    metaLine(
      "classification",
      `${flow.classification.effort} effort · ${flow.classification.riskLevel} risk · ${Math.round(
        flow.classification.confidenceScore * 100,
      )}% confidence`,
    ),
  );

  lines.push("");
  lines.push(section("Plan"));
  for (const item of flow.plan.items) {
    lines.push(
      `  ${nodeBadge(item.reviewStatus)} ${accent(item.id)} ${item.title} ${dim(
        `${item.nodeType} · ${item.status}`,
      )}`,
    );
  }

  lines.push("");
  lines.push(section("Issues"));
  if (flow.issues.length === 0) {
    lines.push("  none");
  } else {
    for (const issue of flow.issues) {
      lines.push(`  ${errorText("!")} ${issue.summary} ${dim(issue.code)}`);
      const recommended = issue.fixOptions.find((option) => option.recommended);
      if (recommended) {
        lines.push(`     ${dim("suggested")} ${recommended.label}`);
      }
    }
  }

  lines.push("");
  lines.push(section("Approval"));
  if (!flow.approval.required) {
    lines.push("  none");
  } else {
    lines.push(
      `  ${dim("gate")} ${flow.approval.gateId} · ${flow.approval.status} · ${
        flow.approval.ready ? "ready" : "not ready"
      }`,
    );
    if (flow.approval.checkpointId) {
      lines.push(`  ${dim("checkpoint")} ${flow.approval.checkpointId}`);
    }
  }

  lines.push("");
  lines.push(section("State Effects"));
  if (flow.result.stateEffects.length === 0) {
    lines.push("  none");
  } else {
    for (const effect of flow.result.stateEffects) {
      lines.push(
        `  ${policyBadge(effect.policyState)} ${accent(effect.id)} ${effect.targets.join(", ")} ${dim(
          effect.summary,
        )}`,
      );
    }
  }

  lines.push("");
  lines.push(section("Commands"));
  lines.push(`  stx graph ${flow.runId}`);
  if (flow.advanced.selectedNodeId) {
    lines.push(`  stx inspect ${flow.runId} ${flow.advanced.selectedNodeId}`);
  }
  if (flow.result.stateEffects[0]) {
    lines.push(`  stx diff ${flow.runId} ${flow.result.stateEffects[0].id}`);
  }
  if (flow.approval.ready) {
    lines.push(`  stx approve ${flow.runId}`);
  }

  print(lines.join("\n"));
}

function renderGraph(runId, artifact) {
  const plan = artifact.plan;
  const lines = [];

  lines.push(title(`stx graph ${runId}`));
  lines.push(metaLine("ReviewArtifact", artifact.artifactId));
  lines.push(metaLine("runId", artifact.runId));
  lines.push(metaLine("runtimeKind", plan.runtimeKind));
  lines.push(metaLine("freshness", artifact.freshnessState));
  lines.push(metaLine("generatedAt", formatTimestamp(artifact.generatedAt)));
  lines.push(metaLine("artifactHash", artifact.artifactHash));
  lines.push(metaLine("directive", artifact.intent.primaryDirective));
  lines.push(
    metaLine(
      "status",
      `${plan.status} · ${plan.nodes.length} nodes · ${plan.edges.length} edges · ${plan.stateEffects.length} state effects`,
    ),
  );
  lines.push("");
  lines.push(section("Execution Graph"));

  plan.nodes.forEach((node) => {
    const gate = plan.approvalGates.find((entry) => entry.targetNodeId === node.id && entry.required);
    const deps = node.dependsOn.length > 0 ? node.dependsOn.join(", ") : "root";

    lines.push(
      `${nodeBadge(node.reviewStatus)} ${accent(node.id)} ${node.title} ${dim(
        `(${node.nodeType})`,
      )}`,
    );
    lines.push(
      `   ${dim("owner=")}${node.gatingOwner}  ${dim("review=")}${node.reviewStatus}  ${dim(
        "exec=",
      )}${node.executionStatus}  ${dim("confidence=")}${formatConfidence(node.confidenceBand, node.confidenceScore)}`,
    );
    lines.push(
      `   ${dim("dependsOn=")}${deps}  ${dim("approval=")}${node.approvalRequired ? "required" : "none"}  ${dim(
        "sources=",
      )}${node.sourceCount ?? 0}`,
    );
    if (node.runtimeBinding) {
      lines.push(
        `   ${dim("runtime=")}${node.runtimeBinding.runtimeId} ${dim(
          `(${node.runtimeBinding.family})`,
        )}`,
      );
    }
    if (node.riskFlags.length > 0) {
      lines.push(`   ${dim("risk=")}${node.riskFlags[0]}`);
    }
    if (gate) {
      lines.push(`   ${dim("gate=")}${gate.status} · ${gate.reason ?? "no reason provided"}`);
    }
  });

  lines.push("");
  lines.push(section("Edges"));
  if (plan.edges.length === 0) {
    lines.push("  none");
  } else {
    plan.edges.forEach((edge) => {
      lines.push(`  ${accent(edge.from)} -> ${accent(edge.to)}`);
    });
  }

  lines.push("");
  lines.push(section("Commands"));
  const defaultNodeId = getDefaultInspectNodeId(artifact);
  const defaultDiffId = getDefaultDiffId(artifact);
  if (defaultNodeId) {
    lines.push(`  stx inspect ${runId} ${defaultNodeId}`);
  }
  if (defaultDiffId) {
    lines.push(`  stx diff ${runId} ${defaultDiffId}`);
  }

  print(lines.join("\n"));
}

async function renderInspect(service, runId, artifact, nodeId) {
  const payload = await getNodeInspectorPayload(service, runId, nodeId);
  const node = payload.node;
  const capabilityScope = payload.tooling?.capabilityScope ?? {};
  const runtimeBinding = payload.tooling?.runtimeBinding;
  const lines = [];

  lines.push(title(`stx inspect ${runId} ${nodeId}`));
  lines.push(
    `${nodeBadge(node.reviewStatus)} ${accent(node.id)} ${node.title} ${dim(
      `(${node.nodeType})`,
    )}`,
  );
  lines.push(metaLine("ReviewArtifact", artifact.artifactId));
  lines.push(metaLine("runId", artifact.runId));
  lines.push(metaLine("freshness", payload.overview?.freshnessState ?? artifact.freshnessState));
  lines.push(metaLine("runtimeKind", payload.overview?.runtimeKind ?? artifact.plan.runtimeKind));
  lines.push("");

  lines.push(section("Overview"));
  if (payload.overview?.title && payload.overview.title !== node.title) {
    lines.push(`  ${payload.overview.title}`);
  }
  lines.push(
    `  ${dim("owner=")}${node.gatingOwner}  ${dim("review=")}${node.reviewStatus}  ${dim(
      "exec=",
    )}${node.executionStatus}  ${dim("grounding=")}${node.grounding ?? "n/a"}  ${dim(
      "confidence=",
    )}${formatConfidence(node.confidenceBand, node.confidenceScore)}`,
  );

  lines.push("");
  lines.push(section("Context"));
  lines.push(`  ${dim("primaryDirective")} ${payload.context?.primaryDirective ?? "none"}`);
  lines.push(`  ${dim("successState")} ${payload.context?.successState ?? "none"}`);
  lines.push(
    `  ${dim("strictBoundaries")} ${listOrNone(payload.context?.strictBoundaries)}`,
  );

  lines.push("");
  lines.push(section("Constraints"));
  lines.push(`  ${dim("hard")} ${listOrNone(payload.constraints?.hard)}`);
  lines.push(`  ${dim("soft")} ${listOrNone(payload.constraints?.soft)}`);
  if (payload.constraints?.reviewerNote) {
    lines.push(`  ${dim("reviewerNote")} ${payload.constraints.reviewerNote}`);
  }

  lines.push("");
  lines.push(section("Tooling"));
  lines.push(`  ${dim("tools")} ${listOrNone(capabilityScope.tools)}`);
  lines.push(`  ${dim("permissions")} ${listOrNone(capabilityScope.permissions)}`);
  lines.push(`  ${dim("runtimeIds")} ${listOrNone(capabilityScope.runtimeIds)}`);
  if (runtimeBinding) {
    lines.push(
      `  ${dim("runtimeBinding")} ${runtimeBinding.runtimeId} ${dim(
        `(${runtimeBinding.family}${runtimeBinding.displayName ? `, ${runtimeBinding.displayName}` : ""})`,
      )}`,
    );
  }

  lines.push("");
  lines.push(section("Output Preview"));
  lines.push(`  ${payload.outputPreview?.summary ?? "none"}`);

  lines.push("");
  lines.push(section("Critique"));
  lines.push(
    `  ${dim("confidence")} ${formatConfidence(
      payload.critique?.confidenceBand ?? node.confidenceBand,
      payload.critique?.confidenceScore ?? node.confidenceScore,
    )}`,
  );
  lines.push(`  ${dim("riskFlags")} ${listOrNone(payload.critique?.riskFlags)}`);

  lines.push("");
  lines.push(section("Proposed Changes"));
  if (!payload.proposedChanges || payload.proposedChanges.length === 0) {
    lines.push("  none");
  } else {
    payload.proposedChanges.forEach((change) => {
      lines.push(
        `  ${policyBadge(change.policyState)} ${accent(change.id)} ${change.target} ${dim(
          `(${change.summary})`,
        )}`,
      );
    });
  }

  lines.push("");
  lines.push(section("Approvals"));
  lines.push(`  ${dim("required")} ${payload.approvals ? "yes" : "no"}`);
  if (payload.approvals) {
    lines.push(
      `  ${dim("gate")} ${payload.approvals.gateId} · ${payload.approvals.status}`,
    );
    lines.push(`  ${dim("reason")} ${payload.approvals.reason ?? "none"}`);
    lines.push(`  ${dim("planVersion")} ${payload.approvals.planVersion}`);
    if (payload.approvals.nodeRevision != null) {
      lines.push(`  ${dim("nodeRevision")} ${payload.approvals.nodeRevision}`);
    }
  }

  lines.push("");
  lines.push(section("Replay"));
  const checkpoints = payload.replay?.checkpoints ?? [];
  lines.push(`  ${dim("checkpoints")} ${listOrNone(checkpoints.map((entry) => entry.id))}`);

  lines.push("");
  lines.push(section("Audit"));
  lines.push(`  ${dim("lastArtifactHash")} ${payload.audit?.lastArtifactHash ?? artifact.artifactHash}`);

  lines.push("");
  lines.push(section("Commands"));
  if (payload.proposedChanges?.[0]) {
    lines.push(`  stx diff ${runId} ${payload.proposedChanges[0].id}`);
  }
  lines.push(`  stx graph ${runId}`);

  print(lines.join("\n"));
}

async function renderDiff(service, runId, artifact, requestedChangeId) {
  const changes = artifact.plan.stateEffects ?? [];
  const defaultChangeId = getDefaultDiffId(artifact);
  const selectedChangeId = requestedChangeId || defaultChangeId;
  const selected = requestedChangeId ? changes.find((entry) => entry.id === selectedChangeId) : null;
  const lines = [];

  if (requestedChangeId && !selected) {
    throw new Error(`Unknown change "${requestedChangeId}" for run "${runId}".`);
  }

  lines.push(title(`stx diff ${runId}${requestedChangeId ? ` ${requestedChangeId}` : ""}`));
  lines.push(metaLine("ReviewArtifact", artifact.artifactId));
  lines.push(metaLine("runId", artifact.runId));
  lines.push(metaLine("freshness", artifact.freshnessState));
  lines.push(metaLine("status", artifact.plan.status));
  lines.push("");

  lines.push(section("State Diff"));
  if (changes.length === 0) {
    lines.push("  none");
  } else {
    changes.forEach((change) => {
      lines.push(
        `${policyBadge(change.policyState)} ${accent(change.id)} ${change.target} ${dim(
          `(${change.summary})`,
        )}`,
      );
      lines.push(
        `   ${dim("kind=")}${change.kind}  ${dim("action=")}${change.operation}  ${dim(
          "reversibility=",
        )}${change.reversibility?.status ?? "unknown"}`,
      );
      lines.push(
        `   ${dim("enforcement=")}${change.enforcement?.owner ?? "unknown"} · ${
          change.enforcement?.status ?? "unknown"
        }`,
      );
      if (change.riskFlags?.length > 0) {
        lines.push(`   ${dim("risk=")}${change.riskFlags[0]}`);
      }
      if (change.previewRef) {
        lines.push(`   ${dim("previewRef=")}${change.previewRef}`);
      }
    });
  }

  if (selected) {
    lines.push("");
    lines.push(section(`Preview ${selected.id}`));
    lines.push(`  ${dim("policy")} ${selected.policyState}`);
    lines.push(
      `  ${dim("enforcement")} ${selected.enforcement?.owner ?? "unknown"} · ${
        selected.enforcement?.status ?? "unknown"
      }`,
    );
    lines.push(`  ${dim("summary")} ${selected.summary}`);
    lines.push(`  ${dim("previewRef")} ${selected.previewRef ?? "none"}`);
    lines.push("");

    if (selected.previewRef) {
      try {
        const preview = await service.getPreviewByRef({
          runId,
          previewRef: selected.previewRef,
        });

        lines.push(`  ${dim("mediaType")} ${preview.mediaType}`);
        lines.push(
          indentBlock(preview.content || "Preview content is empty for this change.", 2),
        );
      } catch (error) {
        lines.push(
          indentBlock(error.message || "Failed to resolve preview content for this change.", 2),
        );
      }
    } else {
      lines.push(indentBlock("No preview reference is available for this change.", 2));
    }
  } else {
    lines.push("");
    lines.push(section("Commands"));
    if (selectedChangeId) {
      lines.push(`  stx diff ${runId} ${selectedChangeId}`);
    }
    const defaultNodeId = getDefaultInspectNodeId(artifact);
    if (defaultNodeId) {
      lines.push(`  stx inspect ${runId} ${defaultNodeId}`);
    }
  }

  print(lines.join("\n"));
}

function parseRunArgs(values) {
  const parsed = {
    strictBoundaries: [],
    autoExecuteSemanticAdmission: true,
  };
  const directive = [];

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === "--run-id" && values[index + 1]) {
      parsed.runId = values[index + 1];
      index += 1;
      continue;
    }

    if ((value === "--boundary" || value === "--strict-boundary") && values[index + 1]) {
      parsed.strictBoundaries.push(values[index + 1]);
      index += 1;
      continue;
    }

    if (value === "--success" && values[index + 1]) {
      parsed.successState = values[index + 1];
      index += 1;
      continue;
    }

    if (value === "--cwd" && values[index + 1]) {
      parsed.cwd = values[index + 1];
      index += 1;
      continue;
    }

    if (value === "--no-admit") {
      parsed.autoExecuteSemanticAdmission = false;
      continue;
    }

    if (value.startsWith("--")) {
      throw new Error(`Unknown run argument '${value}'.`);
    }

    directive.push(value);
  }

  parsed.primaryDirective = directive.join(" ").trim();
  if (!parsed.primaryDirective) {
    throw new Error("stx run requires a task description.");
  }

  return parsed;
}

function parseInspectArgs(values) {
  const first = values[0];
  const second = values[1];

  if (!first || isLatestRef(first)) {
    return {
      runRef: null,
      nodeId: second,
    };
  }

  if (looksLikeNodeId(first) && !second) {
    return {
      runRef: null,
      nodeId: first,
    };
  }

  return {
    runRef: first,
    nodeId: second,
  };
}

function parseDiffArgs(values) {
  const first = values[0];
  const second = values[1];

  if (!first || isLatestRef(first)) {
    return {
      runRef: null,
      changeId: second,
    };
  }

  if (looksLikeChangeId(first) && !second) {
    return {
      runRef: null,
      changeId: first,
    };
  }

  return {
    runRef: first,
    changeId: second,
  };
}

function looksLikeNodeId(value) {
  return typeof value === "string" && value.startsWith("node.");
}

function looksLikeChangeId(value) {
  return typeof value === "string" && value.startsWith("effect.");
}

function isLatestRef(value) {
  return value === "latest" || value === "@latest";
}

function parseServeArgs(values) {
  const parsed = {
    host: process.env.HOST ?? "127.0.0.1",
    port: Number(process.env.PORT ?? 4401),
  };

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--host" && values[index + 1]) {
      parsed.host = values[index + 1];
      index += 1;
      continue;
    }

    if (value === "--port" && values[index + 1]) {
      const nextPort = Number(values[index + 1]);
      if (!Number.isFinite(nextPort) || nextPort <= 0) {
        throw new Error(`Invalid port '${values[index + 1]}'.`);
      }
      parsed.port = nextPort;
      index += 1;
      continue;
    }

    throw new Error(`Unknown serve argument '${value}'.`);
  }

  return parsed;
}

async function resolveRunId(service, runRef) {
  if (runRef && !isLatestRef(runRef)) {
    return runRef;
  }

  const runs = await getRuns(service);
  const latest = runs[0];

  if (!latest) {
    throw new Error(`No runs are available in ${getDefaultDataDir()}. Create a run first.`);
  }

  return latest.runId;
}

async function getRuns(service) {
  return service.listRuns();
}

async function getArtifact(service, runId) {
  return service.getCurrentArtifact(runId);
}

async function getNodeInspectorPayload(service, runId, nodeId) {
  return service.getNodeInspectorPayload({
    runId,
    nodeId,
  });
}

function getDefaultInspectNodeId(artifact) {
  return (
    artifact.plan.nodes.find((node) => node.nodeType === "deterministic_execution")?.id ??
    artifact.plan.nodes.find((node) => node.nodeType === "tool")?.id ??
    artifact.plan.nodes.find((node) => node.nodeType === "semantic_generation")?.id ??
    artifact.plan.nodes[0]?.id ??
    null
  );
}

function getDefaultDiffId(artifact) {
  return artifact.plan.stateEffects[0]?.id ?? null;
}

function printUsage() {
  print(
    [
      title("stx"),
      "Usage:",
      "  stx run \"task\" [--boundary text] [--success text] [--run-id id]",
      "  stx flow [runId|latest]",
      "  stx approve [runId|latest]",
      "  stx list",
      "  stx graph [runId|latest]",
      "  stx inspect [runId|latest] [nodeId]",
      "  stx inspect [nodeId]",
      "  stx diff [runId|latest] [changeId]",
      "  stx diff [changeId]",
      "  stx serve [--host 127.0.0.1] [--port 4401]",
      "",
      `Data dir: ${getDefaultDataDir()}`,
      `UI root: ${getDefaultUiDir()}`,
      "Default target: most recently updated run from the local store",
    ].join("\n"),
  );
}

function fail(message) {
  process.stderr.write(`${errorText("error")} ${message}\n`);
  process.stderr.write("Run `stx --help` for usage.\n");
  process.exit(1);
}

function print(message) {
  process.stdout.write(`${message}\n`);
}

function title(text) {
  return color(text, "bold");
}

function section(text) {
  return color(text, "cyan");
}

function accent(text) {
  return color(text, "blue");
}

function dim(text) {
  return color(text, "dim");
}

function errorText(text) {
  return color(text, "red");
}

function nodeBadge(reviewStatus) {
  if (reviewStatus === "approved") {
    return color("●", "green");
  }
  if (reviewStatus === "warning") {
    return color("▲", "yellow");
  }
  if (reviewStatus === "blocked") {
    return color("■", "red");
  }
  return color("○", "blue");
}

function policyBadge(policyState) {
  if (policyState === "pass") {
    return color("PASS", "green");
  }
  if (policyState === "block") {
    return color("BLOCK", "red");
  }
  return color("WARN", "yellow");
}

function metaLine(label, value) {
  return `${dim(label.padEnd(13))} ${value}`;
}

function listOrNone(values) {
  return values && values.length > 0 ? values.join(", ") : "none";
}

function indentBlock(text, spaces) {
  const prefix = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function formatConfidence(band, score) {
  if (typeof score === "number") {
    return `${band ?? "unknown"} ${score.toFixed(2)}`;
  }
  return band ?? "unknown";
}

function formatTimestamp(value) {
  if (typeof value !== "number") {
    return "unknown";
  }

  return new Date(value).toISOString();
}

function color(text, name) {
  if (!useColor()) {
    return text;
  }

  const code = ANSI[name];
  if (!code) {
    return text;
  }

  return `${code}${text}${ANSI.reset}`;
}

function useColor() {
  return process.stdout.isTTY && !process.env.NO_COLOR;
}

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  cyan: "\u001b[36m",
};
