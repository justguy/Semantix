const { useMemo: useMemoG, useState: useStateG } = React;

function layoutNodes(nodes, edges, mode) {
  const normalizedEdges = edges.map(edgeEndpoints);
  const idToIdx = Object.fromEntries(nodes.map((node, index) => [node.id, index]));
  const inDegree = nodes.map(() => 0);
  const children = nodes.map(() => []);

  normalizedEdges.forEach(({ from, to }) => {
    if (idToIdx[from] == null || idToIdx[to] == null) return;
    inDegree[idToIdx[to]] += 1;
    children[idToIdx[from]].push(idToIdx[to]);
  });

  const levels = nodes.map(() => 0);
  const queue = nodes.map((_, index) => index).filter((index) => inDegree[index] === 0);
  const remaining = [...inDegree];

  while (queue.length) {
    const index = queue.shift();
    children[index].forEach((child) => {
      levels[child] = Math.max(levels[child], levels[index] + 1);
      remaining[child] -= 1;
      if (remaining[child] === 0) queue.push(child);
    });
  }

  const grouped = {};
  levels.forEach((level, index) => {
    grouped[level] ||= [];
    grouped[level].push(index);
  });
  const orderedLevels = Object.keys(grouped).map(Number).sort((left, right) => left - right);

  const NODE_W = 192;
  const NODE_H = 104;
  const GAP_X = 46;
  const GAP_Y = 34;
  const positions = nodes.map(() => ({ x: 0, y: 0 }));

  if (mode === "horizontal") {
    orderedLevels.forEach((level) => {
      grouped[level].forEach((index, row) => {
        positions[index] = {
          x: 26 + level * (NODE_W + GAP_X),
          y: 24 + row * (NODE_H + GAP_Y),
        };
      });
    });
  } else if (mode === "radial") {
    const maxLevel = Math.max(...orderedLevels, 1);
    const maxRadius = 84 + maxLevel * 148;
    const centerX = 18 + maxRadius + NODE_W / 2;
    const centerY = 18 + maxRadius + NODE_H / 2;

    orderedLevels.forEach((level) => {
      const ring = grouped[level];
      const radius = level === 0 ? 0 : 72 + (level / maxLevel) * 184;
      if (level === 0 && ring.length === 1) {
        positions[ring[0]] = { x: centerX - NODE_W / 2, y: centerY - NODE_H / 2 };
        return;
      }
      ring.forEach((index, position) => {
        const angle = (position / ring.length) * Math.PI * 2 - Math.PI / 2;
        positions[index] = {
          x: centerX + Math.cos(angle) * radius - NODE_W / 2,
          y: centerY + Math.sin(angle) * radius - NODE_H / 2,
        };
      });
    });
  } else {
    const widestRow = Math.max(...orderedLevels.map((level) => grouped[level].length), 1);
    const totalWidth = widestRow * NODE_W + (widestRow - 1) * GAP_X;
    const startCenter = 22 + totalWidth / 2;

    orderedLevels.forEach((level) => {
      const row = grouped[level];
      const rowWidth = row.length * NODE_W + (row.length - 1) * GAP_X;
      const rowStart = startCenter - rowWidth / 2;
      row.forEach((index, column) => {
        positions[index] = {
          x: rowStart + column * (NODE_W + GAP_X),
          y: 22 + level * (NODE_H + GAP_Y),
        };
      });
    });
  }

  const minX = Math.min(...positions.map((point) => point.x));
  const minY = Math.min(...positions.map((point) => point.y));
  positions.forEach((point) => {
    point.x = point.x - minX + 18;
    point.y = point.y - minY + 18;
  });

  return {
    positions,
    width: Math.max(...positions.map((point) => point.x + NODE_W)) + 24,
    height: Math.max(...positions.map((point) => point.y + NODE_H)) + 24,
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
  };
}

function TypeBadge({ t, type }) {
  const labels = {
    deterministic: "DET",
    semantic: "SEM",
    hybrid: "HYB",
    tool: "TOOL",
    policy_gate: "POL",
    approval: "APR",
  };
  return (
    <span
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: 0.7,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
        padding: "2px 6px",
        borderRadius: 4,
        background: t.panelAlt,
        color: t.textDim,
        border: `1px solid ${t.border}`,
      }}
    >
      {labels[type] || type}
    </span>
  );
}

function edgeStrokeStyle(kind) {
  if (kind === "data_dependency") return { dasharray: "6 4", opacity: 0.9 };
  if (kind === "approval_dependency") return { dasharray: "2 5", opacity: 1 };
  if (kind === "fallback") return { dasharray: "6 4", opacity: 0.45 };
  if (kind === "retry") return { dasharray: "3 3", opacity: 1 };
  return { dasharray: undefined, opacity: 1 };
}

function renderNodeFrame(nodeType, width, height, fill, stroke, strokeWidth) {
  if (nodeType === "policy_gate") {
    return <polygon points={`${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
  }
  if (nodeType === "approval") {
    return (
      <path
        d={`M${width / 2},0 L${width - 16},12 L${width - 8},${height / 2} L${width - 16},${height - 12} L${width / 2},${height} L16,${height - 12} L8,${height / 2} L16,12 Z`}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }
  if (nodeType === "tool") {
    return (
      <>
        <rect x="0" y="10" width={width} height={height - 20} rx="14" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
        <ellipse cx={width / 2} cy="10" rx={width / 2} ry="10" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
        <ellipse cx={width / 2} cy={height - 10} rx={width / 2} ry="10" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
      </>
    );
  }
  return <rect width={width} height={height} rx="14" fill={fill} stroke={stroke} strokeWidth={strokeWidth} />;
}

function Graph({ t, artifact, layout, selectedNodeRef, onSelect, approvals = {} }) {
  const [hoveredNodeId, setHoveredNodeId] = useStateG(null);
  const nodes = getNodes(artifact);
  const edges = getEdges(artifact);
  const { positions, width, height, nodeWidth, nodeHeight } = useMemoG(
    () => layoutNodes(nodes, edges, layout),
    [nodes, edges, layout]
  );

  const selectedNodeId = selectedNodeRef ? selectedNodeRef.split(":")[0] : null;
  const idToIdx = Object.fromEntries(nodes.map((node, index) => [node.id, index]));
  const normalizedEdges = edges.map((edge) => ({ ...edgeEndpoints(edge), kind: edgeKind(edge) }));

  return (
    <div style={{ width: "100%", height: "100%", overflow: "auto", background: t.bg, position: "relative" }}>
      <svg width={width} height={height} style={{ display: "block" }}>
        <defs>
          <marker id="semantix-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={t.textFaint} />
          </marker>
        </defs>

        {normalizedEdges.map((edge, index) => {
          const fromIndex = idToIdx[edge.from];
          const toIndex = idToIdx[edge.to];
          if (fromIndex == null || toIndex == null) return null;

          const from = positions[fromIndex];
          const to = positions[toIndex];
          const x1 = from.x + nodeWidth / 2;
          const y1 = from.y + nodeHeight;
          const x2 = to.x + nodeWidth / 2;
          const y2 = to.y;
          const cx1 = x1;
          const cy1 = y1 + (y2 - y1) * 0.45;
          const cx2 = x2;
          const cy2 = y2 - (y2 - y1) * 0.45;
          const highlighted = selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId);
          const hovered = hoveredNodeId && (edge.from === hoveredNodeId || edge.to === hoveredNodeId);
          const style = edgeStrokeStyle(edge.kind);

          return (
            <path
              key={`${edge.from}:${edge.to}:${index}`}
              d={`M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`}
              stroke={highlighted || hovered ? t.accent : t.borderStrong}
              strokeWidth={highlighted ? 2.2 : hovered ? 1.8 : 1.2}
              strokeDasharray={style.dasharray}
              opacity={selectedNodeId && !highlighted ? 0.35 : style.opacity}
              fill="none"
              markerEnd="url(#semantix-arrow)"
            />
          );
        })}

        {nodes.map((node, index) => {
          const position = positions[index];
          const selected = selectedNodeId === node.id;
          const hovered = hoveredNodeId === node.id;
          const risk = resolveRiskFromNode(node);
          const { fg: riskFg, bg: riskBg } = RISK_TOKEN(t, risk);
          const dim = selectedNodeId && !selected;
          const nodeChanges = getProposedChanges(artifact).filter((change) => (change.originatingNodeId || change.nodeId || change.node) === node.id);
          const freshNodeApproval = nodeChanges.length > 0
            && nodeChanges.every((change) => approvalEntryIsFresh(approvals[change.id], artifact, node.revision));
          const lines = [
            node.inputSummary ? `in · ${node.inputSummary}` : null,
            node.outputSummary ? `out · ${node.outputSummary}` : null,
            node.grounding ? `grounding · ${node.grounding}` : null,
          ].filter(Boolean).slice(0, 2);

          return (
            <g
              key={node.id}
              transform={`translate(${position.x}, ${position.y})`}
              style={{ cursor: "pointer", opacity: dim ? 0.45 : 1, transition: "opacity 160ms" }}
              onMouseEnter={() => setHoveredNodeId(node.id)}
              onMouseLeave={() => setHoveredNodeId(null)}
              onClick={() => onSelect(node.id)}
            >
              {renderNodeFrame(node.nodeType, nodeWidth, nodeHeight, selected ? t.accentSoft : t.panel, selected ? t.accent : hovered ? riskFg : t.border, selected ? 2.2 : 1.1)}
              <rect x="0" y="0" width="5" height={nodeHeight} fill={riskFg} rx="14" />

              <foreignObject x="14" y="10" width={nodeWidth - 28} height={nodeHeight - 20}>
                <div
                  xmlns="http://www.w3.org/1999/xhtml"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    height: "100%",
                    fontFamily: "Inter, system-ui, sans-serif",
                    color: t.text,
                    gap: 6,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <RiskDot t={t} risk={risk} size={7} />
                    <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, lineHeight: 1.35 }}>
                      <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.title}</span>
                    </div>
                    <TypeBadge t={t} type={node.nodeType} />
                  </div>

                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {node.approvalRequired && (
                      <Pill t={t} risk={freshNodeApproval ? "green" : "orange"} style={{ fontSize: 10, padding: "2px 7px" }}>
                        {freshNodeApproval ? "approved" : "approval gate"}
                      </Pill>
                    )}
                    {node.reviewStatus === "blocked" && (
                      <Pill t={t} risk="red" style={{ fontSize: 10, padding: "2px 7px" }}>
                        blocked
                      </Pill>
                    )}
                    {node.confidenceBand && (
                      <Pill t={t} risk={risk} style={{ fontSize: 10, padding: "2px 7px" }}>
                        {node.confidenceBand}
                      </Pill>
                    )}
                  </div>

                  {lines.length > 0 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 10.5, lineHeight: 1.35, color: t.textDim }}>
                      {lines.map((line) => (
                        <div key={line} style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {line}
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ marginTop: "auto", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10.5, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                    <span>{prettySystemName(node.gatingOwner)}</span>
                    <span>r{node.revision}</span>
                  </div>
                </div>
              </foreignObject>

              {(hovered || selected) && (
                <rect x="-4" y="-4" width={nodeWidth + 8} height={nodeHeight + 8} rx="18" fill="none" stroke={riskBg} strokeWidth="2" />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

Object.assign(window, { Graph, TypeBadge, layoutNodes });
