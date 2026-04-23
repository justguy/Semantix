function buildTerminalLines({ scenarioKey, command, nodeId, changeId }) {
  const library = window.SEMANTIX_FIXTURE_LIBRARY;
  const scenario = library.getScenarioContent(scenarioKey);
  const artifact = library.getReviewArtifact(scenarioKey);
  const lines = [];

  if (command === "inspect") {
    const inspectId = nodeId || library.getDefaultInspectNodeId(scenarioKey);
    const payload = library.getNodeInspectorPayload(scenarioKey, inspectId);
    lines.push(`$ stx inspect ${scenarioKey} ${inspectId}`);
    lines.push(`artifact ${artifact.artifactId}`);
    lines.push("");
    lines.push(`${payload.node.id}  ${payload.node.title}  [${payload.node.nodeType}]  [${payload.node.reviewStatus}]`);
    lines.push(`owner: ${payload.node.gatingOwner}   confidence: ${payload.node.confidenceBand} ${payload.node.confidenceScore.toFixed(2)}`);
    lines.push("");
    lines.push("context");
    (payload.context.visibleSources || []).forEach((value) => lines.push(`  • ${value}`));
    lines.push("");
    lines.push("constraints");
    (payload.constraints.hard || []).forEach((value) => lines.push(`  ! ${value}`));
    (payload.constraints.soft || []).forEach((value) => lines.push(`  ~ ${value}`));
    if (payload.critique) {
      lines.push("");
      lines.push("critique");
      lines.push(`  ${payload.critique.summary}`);
    }
    lines.push("");
    lines.push("commands");
    lines.push(`  stx diff ${scenarioKey} ${payload.proposedChanges[0]?.id || library.getDefaultDiffId(scenarioKey)}`);
    lines.push(`  stx graph ${scenarioKey}`);
    return lines;
  }

  if (command === "diff") {
    const changes = library.getProposedChanges(scenarioKey);
    const selected = changeId ? [library.getProposedChange(scenarioKey, changeId)] : changes;
    lines.push(`$ stx diff ${scenarioKey}${changeId ? ` ${changeId}` : ""}`);
    lines.push(`artifact ${artifact.artifactId} · freshness ${artifact.freshnessState}`);
    lines.push("");
    selected.forEach((change) => {
      if (!change) return;
      lines.push(`${change.id}  ${change.target}`);
      lines.push(`  policy: ${change.policyState} · reversibility: ${change.reversibility.status} · enforcement: ${change.enforcement.owner}/${change.enforcement.status}`);
      (change.riskFlags || []).slice(0, 2).forEach((flag) => lines.push(`  ! ${flag}`));
      lines.push("");
    });
    lines.push("commands");
    lines.push(`  stx inspect ${scenarioKey} ${nodeId || library.getDefaultInspectNodeId(scenarioKey)}`);
    lines.push(`  stx graph ${scenarioKey}`);
    return lines;
  }

  lines.push(`$ stx graph ${scenarioKey}`);
  lines.push(`artifact ${artifact.artifactId} · run ${artifact.runId}`);
  lines.push(`plan ${artifact.planVersion} · graph ${artifact.graphVersion} · ${artifact.freshnessState}`);
  lines.push("");
  lines.push(`intent: ${artifact.intent.primaryDirective}`);
  lines.push("");
  artifact.plan.nodes.forEach((node) => {
    const deps = node.dependsOn.length > 0 ? node.dependsOn.join(", ") : "root";
    lines.push(`● ${node.id}  ${node.title}`);
    lines.push(`  type=${node.nodeType}  review=${node.reviewStatus}  confidence=${node.confidenceBand}  deps=${deps}`);
    if (node.riskFlags.length > 0) lines.push(`  ! ${node.riskFlags[0]}`);
  });
  lines.push("");
  lines.push("commands");
  lines.push(`  stx inspect ${scenarioKey} ${library.getDefaultInspectNodeId(scenarioKey)}`);
  lines.push(`  stx diff ${scenarioKey} ${library.getDefaultDiffId(scenarioKey)}`);
  return lines;
}

function SemantixCLI({ width = 760, height = 560, scenarioKey = "swe", command = "graph", nodeId, changeId }) {
  const term = {
    bg: "#0e0c0a",
    panel: "#18140f",
    border: "#2a241c",
    text: "#ebe4d7",
    dim: "#8c8070",
    faint: "#5a5244",
    accent: "#e8a868",
    green: "#7fb069",
    red: "#e07a5f",
    orange: "#f2a65a",
    blue: "#7cafc2",
  };

  const lines = buildTerminalLines({ scenarioKey, command, nodeId, changeId });

  return (
    <div style={{ width, height, background: term.bg, color: term.text, fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace', fontSize: 12, lineHeight: 1.55, padding: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 28, background: term.panel, borderBottom: `1px solid ${term.border}`, display: "flex", alignItems: "center", padding: "0 10px", gap: 6, flexShrink: 0 }}>
        <div style={{ width: 10, height: 10, borderRadius: 999, background: term.red }} />
        <div style={{ width: 10, height: 10, borderRadius: 999, background: term.orange }} />
        <div style={{ width: 10, height: 10, borderRadius: 999, background: term.green }} />
        <div style={{ flex: 1, textAlign: "center", color: term.faint, fontSize: 11 }}>
          ~/semantix  —  stx  —  {command}
        </div>
      </div>

      <div style={{ flex: 1, padding: "14px 18px", overflow: "auto" }}>
        {lines.map((line, index) => (
          <div key={`${index}:${line}`} style={{ whiteSpace: "pre-wrap", color: line.startsWith("$") ? term.accent : line.trim().startsWith("!") ? term.orange : line.trim().startsWith("●") ? term.blue : line.startsWith("commands") ? term.faint : term.text }}>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { SemantixCLI });
