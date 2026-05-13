// Graph renderer — takes nodes+edges, a layout mode (horizontal/vertical/radial), selected id, onSelect
// Renders SVG. Nodes show title + type badge + risk dot + approval/sideEffect chips.

const { useMemo: useMemoG } = React;

function layoutNodes(nodes, edges, mode) {
  // Build level (topological depth) from edges
  const idToIdx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));
  const inDeg = nodes.map(() => 0);
  edges.forEach(([a, b]) => { if (idToIdx[b] != null) inDeg[idToIdx[b]]++; });
  const level = nodes.map(() => 0);
  const queue = nodes.map((n, i) => i).filter(i => inDeg[i] === 0);
  const children = nodes.map(() => []);
  edges.forEach(([a, b]) => { if (idToIdx[a] != null && idToIdx[b] != null) children[idToIdx[a]].push(idToIdx[b]); });
  const inCopy = [...inDeg];
  while (queue.length) {
    const i = queue.shift();
    for (const c of children[i]) {
      level[c] = Math.max(level[c], level[i] + 1);
      inCopy[c]--;
      if (inCopy[c] === 0) queue.push(c);
    }
  }
  const byLevel = {};
  level.forEach((l, i) => { (byLevel[l] ||= []).push(i); });
  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);

  const NODE_W = 156, NODE_H = 72;
  const GAP_X = 40, GAP_Y = 32;

  const positions = nodes.map(() => ({ x: 0, y: 0 }));

  if (mode === 'horizontal') {
    levels.forEach(l => {
      const col = byLevel[l];
      col.forEach((idx, row) => {
        positions[idx] = {
          x: 24 + l * (NODE_W + GAP_X),
          y: 24 + row * (NODE_H + GAP_Y),
        };
      });
    });
  } else if (mode === 'vertical') {
    // Compute max row width across all levels to know canvas width
    const maxRowCount = Math.max(...levels.map(l => byLevel[l].length));
    const canvasCenter = 16 + (maxRowCount * NODE_W + (maxRowCount - 1) * GAP_X) / 2;
    levels.forEach(l => {
      const row = byLevel[l];
      const totalW = row.length * NODE_W + (row.length - 1) * GAP_X;
      const startX = canvasCenter - totalW / 2;
      row.forEach((idx, col) => {
        positions[idx] = {
          x: startX + col * (NODE_W + GAP_X),
          y: 16 + l * (NODE_H + GAP_Y),
        };
      });
    });
  } else { // radial
    const maxLevel = Math.max(...levels, 1);
    const maxR = 70 + 1 * 160;
    const cx = 16 + maxR + NODE_W / 2;
    const cy = 16 + maxR + NODE_H / 2;
    levels.forEach(l => {
      const ring = byLevel[l];
      const r = l === 0 ? 0 : 60 + (l / maxLevel) * 170;
      if (l === 0 && ring.length === 1) {
        positions[ring[0]] = { x: cx - NODE_W / 2, y: cy - NODE_H / 2 };
      } else {
        ring.forEach((idx, i) => {
          const angle = (i / ring.length) * Math.PI * 2 - Math.PI / 2;
          positions[idx] = {
            x: cx + Math.cos(angle) * r - NODE_W / 2,
            y: cy + Math.sin(angle) * r - NODE_H / 2,
          };
        });
      }
    });
  }

  // Normalize: shift so min is at 16,16
  const minX = Math.min(...positions.map(p => p.x));
  const minY = Math.min(...positions.map(p => p.y));
  positions.forEach(p => { p.x = p.x - minX + 16; p.y = p.y - minY + 16; });
  const maxX = Math.max(...positions.map(p => p.x + NODE_W)) + 16;
  const maxY = Math.max(...positions.map(p => p.y + NODE_H)) + 16;

  return { positions, NODE_W, NODE_H, w: maxX, h: maxY };
}

function TypeBadge({ t, type }) {
  const labels = {
    deterministic: 'DET', semantic: 'SEM', hybrid: 'HYB',
    tool: 'TOOL', policy_gate: 'POLICY', approval: 'APPROVE',
    validation_gate: 'VALID', side_effect: 'FX',
  };
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: 0.6,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      padding: '2px 5px', borderRadius: 4,
      background: t.panelAlt, color: t.textDim,
      border: `1px solid ${t.border}`,
    }}>{labels[type] || type}</span>
  );
}

function Graph({ t, nodes, edges, layout, selectedId, onSelect, approved = {} }) {
  const { positions, NODE_W, NODE_H, w, h } = useMemo(
    () => layoutNodes(nodes, edges, layout), [nodes, edges, layout]
  );

  const idToIdx = Object.fromEntries(nodes.map((n, i) => [n.id, i]));

  return (
    <div style={{ width: '100%', height: '100%', overflow: 'auto', background: t.bg, position: 'relative' }}>
      <svg width={w} height={h} style={{ display: 'block' }}>
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={t.textFaint} />
          </marker>
        </defs>

        {/* Edges */}
        {edges.map(([a, b], i) => {
          const ia = idToIdx[a], ib = idToIdx[b];
          if (ia == null || ib == null) return null;
          const pa = positions[ia], pb = positions[ib];
          const x1 = pa.x + NODE_W / 2, y1 = pa.y + NODE_H;
          const x2 = pb.x + NODE_W / 2, y2 = pb.y;
          // curved
          const cx1 = x1, cy1 = y1 + (y2 - y1) * 0.45;
          const cx2 = x2, cy2 = y2 - (y2 - y1) * 0.45;
          const isHighlight = selectedId && (a === selectedId || b === selectedId);
          return (
            <path key={i}
              d={`M${x1},${y1} C${cx1},${cy1} ${cx2},${cy2} ${x2},${y2}`}
              stroke={isHighlight ? t.accent : t.borderStrong}
              strokeWidth={isHighlight ? 2 : 1.2}
              fill="none"
              markerEnd="url(#arrow)"
              opacity={selectedId && !isHighlight ? 0.45 : 1}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((n, i) => {
          const p = positions[i];
          const selected = selectedId === n.id;
          const { fg: rfg, bg: rbg } = RISK_TOKEN(t, n.risk);
          const dim = selectedId && !selected;
          const nodeApproved = n.id in approved ? approved[n.id] : false;
          return (
            <g key={n.id} transform={`translate(${p.x}, ${p.y})`}
               style={{ cursor: 'pointer', opacity: dim ? 0.55 : 1, transition: 'opacity 160ms' }}
               onClick={() => onSelect(n.id)}>
              <rect width={NODE_W} height={NODE_H} rx={10} ry={10}
                fill={t.panel}
                stroke={selected ? t.accent : (n.risk === 'red' ? rfg : t.border)}
                strokeWidth={selected ? 2 : 1}
                style={{ filter: selected ? 'drop-shadow(0 2px 8px rgba(107,92,255,.25))' : 'none', transition: 'all 160ms' }}
              />
              {/* left risk stripe */}
              <rect x={0} y={0} width={3} height={NODE_H} fill={rfg} rx={10} />
              {/* title */}
              <foreignObject x={12} y={8} width={NODE_W - 24} height={NODE_H - 16}>
                <div xmlns="http://www.w3.org/1999/xhtml" style={{
                  fontFamily: 'inherit', color: t.text, fontSize: 13, fontWeight: 600,
                  display: 'flex', flexDirection: 'column', gap: 4, height: '100%',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 6, height: 6, borderRadius: 999, background: rfg, flexShrink: 0 }} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {n.title}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: t.textDim, fontWeight: 400, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <TypeBadge t={t} type={n.type} />
                    {n.sideEffect && (
                      <span style={{ fontSize: 10, color: t.orange, fontWeight: 500 }}>· side-effect</span>
                    )}
                    {n.approval && (
                      <span style={{ fontSize: 10, color: nodeApproved ? t.green : t.textDim, fontWeight: 500 }}>
                        · {nodeApproved ? 'approved' : 'needs approval'}
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 'auto', fontSize: 10, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                    {n.owner} · conf:{n.confidence}
                  </div>
                </div>
              </foreignObject>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

Object.assign(window, { Graph, TypeBadge });
