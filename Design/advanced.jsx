// Advanced review view — matches the annotated screenshot spec.
// Used from the chat shell as the "advanced" detail surface.
// Self-contained: accepts a scenario key + approvals state.

const { useState: useAV, useMemo: useAVM } = React;

function AdvancedReview({ scenarioKey = 'swe', approvals, setApprovals, selectedNodeId, setSelectedNodeId, onClose, onExecute }) {
  const scenario = window.SEMANTIX_SCENARIOS[scenarioKey];
  const nodes = scenario.nodes;
  const firstRiskId = useAVM(() => {
    const n = nodes.find(x => x.risk === 'orange' || x.risk === 'red') || nodes[0];
    return n.id;
  }, [scenarioKey]);
  const activeId = selectedNodeId || firstRiskId;
  const activeIdx = nodes.findIndex(n => n.id === activeId);
  const active = nodes[activeIdx] || nodes[0];
  const activeDiff = scenario.diff.find(d => d.node === active.id);

  // Color tokens — tuned for the reference screenshot
  const c = {
    bg: '#f7f5f1',
    panel: '#ffffff',
    panelAlt: '#f2f0eb',
    border: '#e8e4dc',
    borderStrong: '#d6d1c4',
    text: '#1d1b17',
    textDim: '#58544c',
    textFaint: '#8a8578',
    accent: '#2d6a4f',
    accentSoft: '#e6f0ea',
    warn: '#b8791f',
    warnSoft: '#fbf2df',
    block: '#a8413a',
    blockSoft: '#f8e9e6',
    ok: '#2d6a4f',
    badge: '#6b5cff',
    badgeSoft: '#eeebff',
  };
  const mono = 'ui-monospace, "SF Mono", Menlo, monospace';
  const approvedCount = scenario.diff.filter(d => d.policy !== 'block' && approvals[d.id] === 'approve').length;
  const approvable = scenario.diff.filter(d => d.policy !== 'block').length;
  const blockedByPolicy = scenario.diff.filter(d => d.policy === 'block').length;
  const allDone = approvedCount === approvable;

  return (
    <div style={{ width: '100%', height: '100%', background: c.bg, color: c.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
      fontSize: 12.5, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Top bar */}
      <div style={{ height: 44, flexShrink: 0, borderBottom: `1px solid ${c.border}`, background: c.panel,
        display: 'flex', alignItems: 'center', padding: '0 14px', gap: 12 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: c.accent, display: 'grid', placeItems: 'center', color: '#fff' }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12l4 4L19 6"/></svg>
        </div>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Semantix</span>
        <span style={{ color: c.textFaint, fontSize: 11 }}>Control Surface</span>
        <span style={{ fontSize: 11, padding: '3px 8px', borderRadius: 999, background: c.badgeSoft, color: c.badge, fontFamily: mono, fontWeight: 600 }}>Run 8f1c</span>
        <span style={{ fontSize: 11, color: c.warn, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: c.warn }} />Pending review
        </span>
        <div style={{ flex: 1 }} />
        <button style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 5, border: `1px solid ${c.border}`, background: c.panel, color: c.textDim, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {scenario.label} <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3l2 2 2-2"/></svg>
        </button>
        <IconBtn c={c} size={24}>?</IconBtn>
        <IconBtn c={c} size={24}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.8A9 9 0 0111.2 3a7 7 0 109.8 9.8z"/></svg>
        </IconBtn>
        <button onClick={onClose} style={{ fontSize: 11.5, padding: '4px 10px', borderRadius: 5, border: `1px solid ${c.border}`, background: c.panel, color: c.textDim, cursor: 'pointer' }}>Back to chat</button>
      </div>

      {/* Intent / Boundaries / Success strip */}
      <div style={{ flexShrink: 0, display: 'grid', gridTemplateColumns: '1.3fr 1.4fr 1fr', borderBottom: `1px solid ${c.border}`, background: c.panel }}>
        <StripCol c={c} label="Intent" accent={c.accent}>
          <div style={{ fontSize: 13, lineHeight: 1.45, color: c.text, letterSpacing: -0.1, textWrap: 'pretty' }}>
            {scenario.intent.directive}
          </div>
          <a style={{ fontSize: 11, color: c.accent, fontWeight: 500, cursor: 'pointer', marginTop: 6, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            View intent details <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M2 3l2 2 2-2"/></svg>
          </a>
        </StripCol>
        <StripCol c={c} label="Boundaries">
          {scenario.intent.boundaries.map((b, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: c.textDim, marginBottom: 3 }}>
              <span style={{ color: c.block, flexShrink: 0, marginTop: 1 }}>✕</span><span>{b}</span>
            </div>
          ))}
        </StripCol>
        <StripCol c={c} label="Success state">
          <div style={{ display: 'flex', gap: 8, fontSize: 12, color: c.textDim }}>
            <span style={{ color: c.ok, flexShrink: 0, marginTop: 1 }}>✓</span>
            <span style={{ textWrap: 'pretty' }}>{scenario.intent.success}</span>
          </div>
        </StripCol>
      </div>

      {/* Main 3-panel area */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '240px 1fr 320px', minHeight: 0 }}>
        {/* LEFT: execution graph */}
        <div style={{ borderRight: `1px solid ${c.border}`, background: c.bg, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flexShrink: 0, padding: '12px 14px 8px', display: 'flex', alignItems: 'center' }}>
            <span style={{ fontSize: 12, fontWeight: 600 }}>Execution graph</span>
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 10.5, color: c.textFaint }}>View:</span>
            <button style={{ marginLeft: 4, fontSize: 11, padding: '2px 6px', border: `1px solid ${c.border}`, borderRadius: 4, background: c.panel, color: c.textDim, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              Vertical <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3l2 2 2-2"/></svg>
            </button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: '4px 14px 14px' }}>
            {nodes.map((n, i) => <GraphNode key={n.id} c={c} n={n} i={i} active={n.id === activeId} hasEdge={i > 0} onClick={() => setSelectedNodeId(n.id)} approvals={approvals} diff={scenario.diff} />)}
          </div>
          <div style={{ flexShrink: 0, borderTop: `1px solid ${c.border}`, padding: '10px 14px', background: c.panel }}>
            <div style={{ fontSize: 11, color: c.textFaint, display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, cursor: 'pointer' }}>
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 5h6M5 2v6"/></svg>
              Hide completed
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <span style={{ color: c.textFaint }}>{approvedCount}/{approvable} approved</span>
              <div style={{ flex: 1, height: 3, background: c.border, borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ width: `${(approvedCount/Math.max(1,approvable))*100}%`, height: '100%', background: c.ok }} />
              </div>
            </div>
            {blockedByPolicy > 0 && (
              <div style={{ marginTop: 8, fontSize: 11, color: c.block, background: c.blockSoft, padding: '4px 8px', borderRadius: 4, fontWeight: 500 }}>
                {blockedByPolicy} action blocked by policy
              </div>
            )}
          </div>
        </div>

        {/* CENTER: node detail */}
        <div style={{ overflow: 'auto', background: c.bg, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <NodeDetail c={c} active={active} activeDiff={activeDiff} activeIdx={activeIdx} total={nodes.length} mono={mono}
            verdict={activeDiff ? approvals[activeDiff.id] : null}
            setVerdict={(v) => activeDiff && setApprovals(a => ({ ...a, [activeDiff.id]: v === a[activeDiff.id] ? null : v }))}
          />
        </div>

        {/* RIGHT: details pane */}
        <div style={{ borderLeft: `1px solid ${c.border}`, background: c.panel, overflow: 'auto', minHeight: 0 }}>
          <DetailsPane c={c} node={active} diff={activeDiff} mono={mono} />
        </div>
      </div>

      {/* Bottom action bar */}
      <div style={{ flexShrink: 0, height: 52, borderTop: `1px solid ${c.border}`, background: c.panel,
        display: 'flex', alignItems: 'center', padding: '0 18px', gap: 10 }}>
        <div style={{ flex: 1, fontSize: 12, color: c.textDim }}>
          {allDone
            ? <>All unblocked actions approved.{blockedByPolicy > 0 && <span style={{ color: c.textFaint }}> · {blockedByPolicy} will not run.</span>}</>
            : <>Review each node and approve to proceed.</>}
        </div>
        <button style={{ fontSize: 12, padding: '7px 12px', borderRadius: 6, border: `1px solid ${c.border}`, background: c.panel, color: c.textDim, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M1.5 3.5l2-2 2 2M3.5 1.5v5M9.5 7.5l-2 2-2-2M7.5 9.5v-5"/></svg>
          Re-compile plan
        </button>
        <button onClick={onExecute} disabled={!allDone} style={{ fontSize: 12.5, padding: '8px 16px', borderRadius: 6,
          border: `1px solid ${allDone ? c.ok : c.borderStrong}`,
          background: allDone ? c.accentSoft : c.panelAlt, color: allDone ? c.ok : c.textFaint,
          cursor: allDone ? 'pointer' : 'not-allowed', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2.5 5.5l2 2 4-4"/></svg>
          Approve remaining to execute
        </button>
      </div>
    </div>
  );
}

function IconBtn({ c, children, size = 26 }) {
  return <button style={{ width: size, height: size, border: `1px solid ${c.border}`, borderRadius: 5, background: c.panel, color: c.textDim, cursor: 'pointer', display: 'grid', placeItems: 'center', fontSize: 11 }}>{children}</button>;
}

function StripCol({ c, label, accent, children }) {
  return (
    <div style={{ padding: '12px 18px', borderRight: `1px solid ${c.border}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: accent || c.textFaint, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

function GraphNode({ c, n, i, active, hasEdge, onClick, approvals, diff }) {
  const riskColor = n.risk === 'red' ? c.block : n.risk === 'orange' ? c.warn : n.risk === 'yellow' ? c.warn : c.ok;
  const nodeDiff = diff.find(d => d.node === n.id);
  const isApproved = nodeDiff && approvals[nodeDiff.id] === 'approve';
  const blocked = nodeDiff && nodeDiff.policy === 'block';
  const typeBadge = (n.type || '').slice(0, 3).toUpperCase();
  return (
    <div>
      {hasEdge && <div style={{ width: 1, height: 10, background: c.borderStrong, marginLeft: 19 }} />}
      <div onClick={onClick} style={{
        display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px',
        border: `1px solid ${active ? c.accent : c.border}`,
        background: active ? c.panel : c.panel,
        boxShadow: active ? `0 0 0 1px ${c.accent}` : 'none',
        borderRadius: 6, cursor: 'pointer',
      }}>
        <div style={{ width: 18, height: 18, borderRadius: 4, background: c.panelAlt, color: c.textDim,
          fontSize: 10, fontWeight: 600, display: 'grid', placeItems: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11.5, fontWeight: 500, color: c.text, lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis' }}>{n.title}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3 }}>
            <span style={{ fontSize: 9, fontWeight: 600, color: c.textFaint, letterSpacing: 0.5, padding: '1px 4px', background: c.panelAlt, borderRadius: 3 }}>{typeBadge}</span>
            {blocked && <span style={{ fontSize: 9, color: c.block, fontWeight: 600 }}>POLICY</span>}
          </div>
          {blocked && <div style={{ fontSize: 10, color: c.warn, marginTop: 3 }}>Review needed</div>}
          {n.sideEffect && !blocked && <div style={{ fontSize: 10, color: c.textFaint, marginTop: 3 }}>Pending</div>}
        </div>
        <div style={{ width: 10, height: 10, borderRadius: 999, background: isApproved ? c.ok : riskColor, flexShrink: 0, marginTop: 4 }} />
      </div>
    </div>
  );
}

function NodeDetail({ c, active, activeDiff, activeIdx, total, mono, verdict, setVerdict }) {
  const typeBadge = (active.type || '').slice(0, 3).toUpperCase();
  const confLabel = active.confidence === 'low' ? 'Low confidence' : active.confidence === 'medium' ? 'Medium confidence' : 'High confidence';
  const confColor = active.confidence === 'low' ? c.block : active.confidence === 'medium' ? c.warn : c.ok;
  return (
    <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5, color: c.textFaint, fontWeight: 500, letterSpacing: 0.3, textTransform: 'uppercase' }}>
          <span>Node {activeIdx + 1} of {total}</span>
          <span style={{ color: c.textFaint }}>·</span>
          <span style={{ color: c.badge, background: c.badgeSoft, padding: '1px 5px', borderRadius: 3, fontWeight: 700, letterSpacing: 0.5 }}>{typeBadge}</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontSize: 11, color: confColor, textTransform: 'none', letterSpacing: 0, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: confColor }} />{confLabel}
          </span>
        </div>
        <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4, letterSpacing: -0.3 }}>{active.title}</div>
        <div style={{ fontSize: 12.5, color: c.textDim, marginTop: 3, lineHeight: 1.4 }}>{active.purpose}</div>
      </div>

      {/* Why flagged */}
      {active.critique && (
        <div style={{ background: c.warnSoft, border: `1px solid ${c.warn}40`, borderRadius: 6, padding: '10px 12px', display: 'flex', gap: 9 }}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={c.warn} strokeWidth="1.6" strokeLinecap="round" style={{ marginTop: 1, flexShrink: 0 }}>
            <path d="M7 1L13 12H1z M7 5v3.5 M7 10v.5"/>
          </svg>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: c.warn, letterSpacing: 0.5, textTransform: 'uppercase' }}>Weak grounding</div>
            <div style={{ fontSize: 12.5, color: c.text, marginTop: 3, lineHeight: 1.5 }}>{active.critique.summary}</div>
            {active.critique.suggestion && <div style={{ fontSize: 12, color: c.textDim, marginTop: 4 }}>→ {active.critique.suggestion}</div>}
          </div>
        </div>
      )}

      {/* Proposed changes */}
      {activeDiff && (
        <div style={{ border: `1px solid ${c.border}`, borderRadius: 6, background: c.panel, overflow: 'hidden' }}>
          <div style={{ padding: '9px 12px', display: 'flex', alignItems: 'center', borderBottom: `1px solid ${c.border}`, background: c.panelAlt }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: c.textFaint, letterSpacing: 0.6, textTransform: 'uppercase' }}>Proposed changes</span>
            <div style={{ flex: 1 }} />
            <button style={{ fontSize: 11, padding: '2px 7px', border: `1px solid ${c.border}`, borderRadius: 4, background: c.panel, color: c.textDim, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
              Unified <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 3l2 2 2-2"/></svg>
            </button>
          </div>
          <div style={{ padding: '6px 12px 4px', borderBottom: `1px solid ${c.border}`, fontSize: 11, fontFamily: mono, color: c.textDim, background: c.panel }}>
            <span style={{ color: c.text, fontWeight: 500 }}>{activeDiff.target.split('/').slice(-1)[0]}</span>
            <span style={{ color: c.textFaint, marginLeft: 8 }}>
              {activeDiff.summary.match(/[+-]\d+/g)?.join(' ') || ''}
            </span>
          </div>
          <pre style={{ margin: 0, padding: '10px 0', fontFamily: mono, fontSize: 11, lineHeight: 1.55,
            color: c.text, overflow: 'auto', maxHeight: 180, background: c.panel, whiteSpace: 'pre' }}>
            {colorizeDiff(activeDiff.preview, c)}
          </pre>
        </div>
      )}

      {/* Effects preview */}
      {activeDiff && (
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: c.textFaint, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>Effects preview</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            <MetricCard c={c} label="Files changed" value="1" icon="files" />
            <MetricCard c={c} label="Lines added" value={activeDiff.summary.match(/\+\d+/)?.[0] || '+0'} icon="plus" color={c.ok} />
            <MetricCard c={c} label="Lines removed" value={activeDiff.summary.match(/−\d+|-\d+/)?.[0] || '0'} icon="minus" color={c.textDim} />
            <MetricCard c={c} label="Risk level" value={active.risk === 'red' ? 'High' : active.risk === 'orange' ? 'Medium' : active.risk === 'yellow' ? 'Low-med' : 'Low'} color={active.risk === 'red' ? c.block : active.risk === 'orange' ? c.warn : c.textDim} />
          </div>
        </div>
      )}

      {/* Policy enforcement */}
      {activeDiff && (
        <div>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: c.textFaint, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 6 }}>Policy enforcement <span style={{ color: c.textFaint }}>(Hoplon)</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            <PolicyCard c={c} kind={activeDiff.policy === 'pass' ? 'pass' : activeDiff.policy === 'block' ? 'block' : 'review'} label={activeDiff.policy === 'pass' ? 'policy pass' : activeDiff.policy === 'block' ? 'policy block' : 'review required'} sub={activeDiff.policy === 'pass' ? 'Reversible' : activeDiff.flags?.[0]?.slice(0, 28) || '—'} />
            <PolicyCard c={c} kind="review" label="review required" sub={activeDiff.flags?.[0] ? 'Uses undefined `signToken`' : 'Manual approval'} />
            <PolicyCard c={c} kind="pass" label={activeDiff.reversibility || 'reversible'} sub="No destructive changes" />
          </div>
        </div>
      )}

      {/* Action buttons */}
      {activeDiff && activeDiff.policy !== 'block' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button onClick={() => setVerdict('approve')} style={{ flex: 1, padding: '10px 14px', borderRadius: 6,
            background: verdict === 'approve' ? c.ok : c.accent, color: '#fff', border: 'none', cursor: 'pointer',
            fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 6l2.5 2.5L10 3.5"/></svg>
            Approve change
          </button>
          <button style={{ flex: 1, padding: '10px 14px', borderRadius: 6, background: c.panel, color: c.text,
            border: `1px solid ${c.border}`, cursor: 'pointer', fontSize: 13, fontWeight: 500, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            Require changes
          </button>
          <button onClick={() => setVerdict('block')} style={{ padding: '10px 14px', borderRadius: 6, background: c.panel, color: verdict === 'block' ? c.block : c.text,
            border: `1px solid ${verdict === 'block' ? c.block : c.border}`, cursor: 'pointer', fontSize: 13, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M2.5 2.5l6 6M8.5 2.5l-6 6"/></svg>
            Block
          </button>
          <button style={{ padding: '10px 12px', borderRadius: 6, background: c.panel, color: c.textDim, border: `1px solid ${c.border}`, cursor: 'pointer', fontSize: 13 }}>⋯</button>
        </div>
      )}
      {activeDiff && activeDiff.policy === 'block' && (
        <div style={{ padding: '10px 12px', borderRadius: 6, background: c.blockSoft, color: c.block, fontSize: 12.5, fontWeight: 500 }}>
          This action is blocked by policy and will not execute.
        </div>
      )}
    </div>
  );
}

function MetricCard({ c, label, value, color }) {
  return (
    <div style={{ border: `1px solid ${c.border}`, borderRadius: 6, padding: '10px 11px', background: c.panel }}>
      <div style={{ fontSize: 10.5, color: c.textFaint, fontWeight: 500, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 5 }}>
        <div style={{ width: 12, height: 12, borderRadius: 3, background: c.panelAlt }} />
        {label}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: color || c.text, letterSpacing: -0.2 }}>{value}</div>
    </div>
  );
}

function PolicyCard({ c, kind, label, sub }) {
  const tone = kind === 'pass' ? { bg: c.accentSoft, fg: c.ok } : kind === 'block' ? { bg: c.blockSoft, fg: c.block } : { bg: c.warnSoft, fg: c.warn };
  return (
    <div style={{ border: `1px solid ${tone.fg}30`, borderRadius: 6, padding: '8px 10px', background: tone.bg }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: tone.fg }}>{label}</div>
      <div style={{ fontSize: 11, color: c.textDim, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>
    </div>
  );
}

function DetailsPane({ c, node, diff, mono }) {
  const [tab, setTab] = useAV('Details');
  const [showMore, setShowMore] = useAV(false);
  return (
    <div style={{ padding: '14px 16px 24px' }}>
      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: `1px solid ${c.border}`, marginBottom: 14 }}>
        {['Details', 'Activity'].map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ background: 'transparent', border: 'none', cursor: 'pointer',
            padding: '6px 10px', fontSize: 12.5, fontWeight: 500,
            color: tab === t ? c.text : c.textFaint, borderBottom: `2px solid ${tab === t ? c.accent : 'transparent'}`, marginBottom: -1 }}>{t}</button>
        ))}
      </div>

      {/* Why flagged card */}
      {node.critique && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Why this was flagged</div>
          <div style={{ fontSize: 12, color: c.textDim, lineHeight: 1.5 }}>
            The code references <code style={{ fontFamily: mono, fontSize: 11, background: c.panelAlt, padding: '1px 4px', borderRadius: 3 }}>signToken.verify()</code> but no such utility exists in the current context.
          </div>
          <button onClick={() => setShowMore(x => !x)} style={{ marginTop: 6, fontSize: 11, padding: '3px 8px', border: `1px solid ${c.border}`, borderRadius: 4, background: c.panel, color: c.textDim, cursor: 'pointer' }}>
            {showMore ? 'Show less' : 'Show more'}
          </button>
          {showMore && <div style={{ marginTop: 8, fontSize: 11.5, color: c.textDim, lineHeight: 1.5 }}>{node.critique.suggestion}</div>}
        </div>
      )}

      {/* Context */}
      <SectionHead c={c}>Context</SectionHead>
      <KV c={c} icon="files" label="Files in scope" count={node.inputs?.length || 0}>
        <span style={{ fontFamily: mono, fontSize: 11, color: c.textDim }}>{(node.inputs || []).slice(0, 2).join(', ')}</span>
      </KV>
      <KV c={c} icon="sym" label="Relevant symbols" count={3}>
        <span style={{ fontFamily: mono, fontSize: 11, color: c.textDim }}>signupHandler, loginHandler, db.users.update</span>
      </KV>
      <KV c={c} icon="tool" label="Tools available" count={node.tools_visible?.length || 2}>
        <span style={{ fontFamily: mono, fontSize: 11, color: c.textDim }}>{(node.tools_visible || ['db (prisma)', 'rateLimit']).join(', ')}</span>
      </KV>

      <Divider c={c} />

      {/* Rows w/ chevrons */}
      <Row c={c} label="Constraints" right={<Pill c={c} kind="warn">{((node.constraints?.hard)||[]).length} issues</Pill>} />
      <Row c={c} label="Grounding" right={<Pill c={c} kind={node.grounding === 'grounded' ? 'ok' : node.grounding === 'bridged' ? 'warn' : 'neutral'}>{node.grounding === 'bridged' ? 'Weak' : node.grounding}</Pill>} />
      <Row c={c} label="Provenance" right={<Pill c={c} kind="neutral">{node.sources || 2} sources</Pill>} />

      {/* Need to adjust callout */}
      <div style={{ marginTop: 18, padding: '12px 12px', background: c.badgeSoft, borderRadius: 7, border: `1px solid ${c.badge}30` }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: c.text, marginBottom: 3 }}>Need to adjust?</div>
        <div style={{ fontSize: 11.5, color: c.textDim, lineHeight: 1.45, marginBottom: 8 }}>Add context, tighten constraints, or rerun this node.</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ fontSize: 11, padding: '5px 9px', border: `1px solid ${c.border}`, borderRadius: 5, background: c.panel, color: c.text, cursor: 'pointer' }}>＋ Add source</button>
          <button style={{ fontSize: 11, padding: '5px 9px', border: `1px solid ${c.border}`, borderRadius: 5, background: c.panel, color: c.text, cursor: 'pointer' }}>⟳ Regenerate node</button>
        </div>
      </div>
    </div>
  );
}

function SectionHead({ c, children }) { return <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{children}</div>; }
function KV({ c, label, count, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 10 }}>
      <div style={{ width: 22, height: 22, borderRadius: 5, background: c.panelAlt, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
        <div style={{ width: 10, height: 10, borderRadius: 2, background: c.borderStrong }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11.5, fontWeight: 500 }}>{label} <span style={{ color: c.textFaint, fontWeight: 400, marginLeft: 2 }}>{count}</span></div>
        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{children}</div>
      </div>
    </div>
  );
}
function Divider({ c }) { return <div style={{ height: 1, background: c.border, margin: '14px 0' }} />; }
function Row({ c, label, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '8px 0', fontSize: 12, cursor: 'pointer' }}>
      <span style={{ flex: 1, fontWeight: 500 }}>{label}</span>
      {right}
      <svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke={c.textFaint} strokeWidth="1.8" strokeLinecap="round" style={{ marginLeft: 8 }}><path d="M3 2l2.5 2.5L3 7"/></svg>
    </div>
  );
}
function Pill({ c, kind, children }) {
  const tone = kind === 'ok' ? { bg: c.accentSoft, fg: c.ok } : kind === 'warn' ? { bg: c.warnSoft, fg: c.warn } : { bg: c.panelAlt, fg: c.textDim };
  return <span style={{ fontSize: 10.5, padding: '2px 7px', borderRadius: 999, background: tone.bg, color: tone.fg, fontWeight: 600 }}>{children}</span>;
}

function colorizeDiff(text, c) {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    let color = c.textDim, bg = 'transparent';
    const ln = (i + 1).toString().padStart(3, ' ');
    if (line.startsWith('+')) { color = c.ok; bg = 'rgba(45,106,79,0.08)'; }
    else if (line.startsWith('-')) { color = c.block; bg = 'rgba(168,65,58,0.08)'; }
    else if (line.includes('⚠') || line.includes('!')) { color = c.warn; bg = c.warnSoft; }
    return (
      <div key={i} style={{ color, background: bg, display: 'flex' }}>
        <span style={{ width: 30, textAlign: 'right', paddingRight: 8, color: c.textFaint, userSelect: 'none', flexShrink: 0 }}>{ln}</span>
        <span style={{ flex: 1, paddingRight: 10 }}>{line || ' '}</span>
      </div>
    );
  });
}

Object.assign(window, { AdvancedReview });
