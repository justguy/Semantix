// Inspector — right panel detail for a selected node
const { useState: useStateI } = React;

function Section({ t, title, children, dense }) {
  return (
    <div style={{ padding: dense ? '10px 14px' : '14px 14px', borderBottom: `1px solid ${t.border}` }}>
      <div style={{
        fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase',
        color: t.textFaint, marginBottom: 8,
      }}>{title}</div>
      {children}
    </div>
  );
}

function KV({ t, label, children, mono }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 12.5, marginBottom: 4, lineHeight: 1.5 }}>
      <div style={{ color: t.textDim, minWidth: 92, fontSize: 12 }}>{label}</div>
      <div style={{ flex: 1, color: t.text, fontFamily: mono ? 'ui-monospace, Menlo, monospace' : 'inherit', fontSize: mono ? 12 : 12.5, wordBreak: 'break-word' }}>{children}</div>
    </div>
  );
}

function Inspector({ t, node, allDiff, onJumpToDiff, onIntervene }) {
  if (!node) {
    return (
      <div style={{ padding: 40, textAlign: 'center', color: t.textFaint, fontSize: 13 }}>
        <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>◎</div>
        Select a node in the graph to inspect context, constraints, and intervention options.
      </div>
    );
  }

  const { fg: riskFg, bg: riskBg } = RISK_TOKEN(t, node.risk);
  const nodeDiffs = allDiff.filter(d => d.node === node.id);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'auto' }}>
      {/* Header */}
      <div style={{ padding: '16px 14px', borderBottom: `1px solid ${t.border}`, background: t.panel }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <RiskDot t={t} risk={node.risk} />
          <span style={{ fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace', color: t.textFaint }}>{node.id}</span>
          <TypeBadge t={t} type={node.type} />
          <div style={{ flex: 1 }} />
          <Pill t={t} risk={node.risk}>{node.confidence} confidence</Pill>
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: t.text, marginBottom: 6 }}>{node.title}</div>
        <div style={{ fontSize: 12.5, color: t.textDim, lineHeight: 1.5 }}>{node.purpose}</div>
      </div>

      {/* Critique callout */}
      {node.critique && (
        <div style={{
          margin: '12px 14px 0', padding: 12, borderRadius: 8,
          background: riskBg, border: `1px solid ${riskFg}40`,
          display: 'flex', gap: 10, alignItems: 'flex-start',
        }}>
          <div style={{ color: riskFg, marginTop: 1 }}><Icon.Alert /></div>
          <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5, color: t.text }}>
            <div style={{ fontWeight: 600, marginBottom: 2, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: riskFg }}>
              {node.critique.severity.replace('-', ' ')}
            </div>
            <div>{node.critique.summary}</div>
            {node.critique.suggestion && (
              <div style={{ marginTop: 6, color: t.textDim, fontSize: 12 }}>
                → {node.critique.suggestion}
              </div>
            )}
          </div>
        </div>
      )}

      <Section t={t} title="Grounding">
        <div style={{ display: 'flex', gap: 16, fontSize: 12.5 }}>
          <div>
            <div style={{ color: t.textDim, fontSize: 11, marginBottom: 2 }}>Origin</div>
            <div style={{ color: t.text, fontWeight: 500, textTransform: 'capitalize' }}>{node.grounding}</div>
          </div>
          <div>
            <div style={{ color: t.textDim, fontSize: 11, marginBottom: 2 }}>Owner</div>
            <div style={{ color: t.text, fontWeight: 500 }}>{node.owner}</div>
          </div>
          <div>
            <div style={{ color: t.textDim, fontSize: 11, marginBottom: 2 }}>Sources</div>
            <div style={{ color: t.text, fontWeight: 500 }}>{node.sources}</div>
          </div>
          <div>
            <div style={{ color: t.textDim, fontSize: 11, marginBottom: 2 }}>Tools</div>
            <div style={{ color: t.text, fontWeight: 500 }}>{node.tools}</div>
          </div>
        </div>
      </Section>

      <Section t={t} title="Context scope">
        {node.inputs.map((inp, i) => (
          <div key={i} style={{ fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', color: t.text, padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: t.textFaint }}>·</span>{inp}
          </div>
        ))}
      </Section>

      <Section t={t} title="Constraints">
        {node.constraints.hard.length === 0 && node.constraints.soft.length === 0 && (
          <div style={{ fontSize: 12, color: t.textFaint }}>No constraints on this node.</div>
        )}
        {node.constraints.hard.map((c, i) => (
          <div key={`h${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, padding: '3px 0' }}>
            <Pill t={t} risk="red" style={{ fontSize: 9 }}>HARD</Pill>
            <span style={{ color: t.text, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5 }}>{c}</span>
          </div>
        ))}
        {node.constraints.soft.map((c, i) => (
          <div key={`s${i}`} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, padding: '3px 0' }}>
            <Pill t={t} style={{ fontSize: 9 }}>SOFT</Pill>
            <span style={{ color: t.textDim, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5 }}>{c}</span>
          </div>
        ))}
      </Section>

      {node.tools_visible && node.tools_visible.length > 0 && (
        <Section t={t} title="Visible tools">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {node.tools_visible.map(tool => (
              <span key={tool} style={{
                fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace',
                padding: '3px 8px', borderRadius: 6, background: t.panelAlt, color: t.text,
                border: `1px solid ${t.border}`,
              }}>{tool}</span>
            ))}
          </div>
        </Section>
      )}

      <Section t={t} title="Output preview">
        <div style={{ fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', color: t.text,
          background: t.panelAlt, padding: 10, borderRadius: 6, border: `1px solid ${t.border}` }}>
          {node.output}
        </div>
      </Section>

      {nodeDiffs.length > 0 && (
        <Section t={t} title={`Proposed changes (${nodeDiffs.length})`}>
          {nodeDiffs.map(d => {
            const KindIcon = KIND_ICON[d.kind] || Icon.File;
            return (
              <div key={d.id} onClick={() => onJumpToDiff(d.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px',
                  borderRadius: 6, cursor: 'pointer', marginBottom: 4,
                  background: t.panelAlt, border: `1px solid ${t.border}`,
                }}>
                <div style={{ color: t.textDim }}><KindIcon /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.target}</div>
                  <div style={{ fontSize: 11, color: t.textDim }}>{d.summary}</div>
                </div>
                {d.policy === 'block' && <Pill t={t} risk="red" strong>blocked</Pill>}
                {d.policy === 'review_required' && <Pill t={t} risk="orange">review</Pill>}
                {d.policy === 'pass' && <Pill t={t} risk="green">pass</Pill>}
              </div>
            );
          })}
        </Section>
      )}

      {node.critique && (
        <Section t={t} title="Interventions">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <Btn t={t} variant="ghost" onClick={() => onIntervene(node.id, 'add-source')} icon={<Icon.Edit />}>Add source</Btn>
            <Btn t={t} variant="ghost" onClick={() => onIntervene(node.id, 'tighten')} icon={<Icon.Edit />}>Tighten constraint</Btn>
            <Btn t={t} variant="ghost" onClick={() => onIntervene(node.id, 'regenerate')} icon={<Icon.Refresh />}>Regenerate</Btn>
            <Btn t={t} variant="ghost" onClick={() => onIntervene(node.id, 'require-approval')} icon={<Icon.Lock />}>Require approval</Btn>
          </div>
        </Section>
      )}
    </div>
  );
}

Object.assign(window, { Inspector });
