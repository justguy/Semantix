// Decision Mode — v1 Semantix, stripped to the one job:
// "here's what will happen, approve or block."
//
// Contrast with the full 3-panel review (graph + inspector + diff):
//   - one column of changes, not three
//   - each change is collapsed to intent + approve/block by default
//   - risk/grounding/critique live inside the expanded card, not in a
//     separate panel
//   - the graph is a secondary affordance ("See plan") — progressive
//     disclosure for debugging, not the primary model
//
// Uses window.SEMANTIX_SCENARIOS directly.

const { useState: useDS, useMemo: useDM } = React;

function DecisionMode({ scenarioKey = 'swe', width, height, showPlanDefault = false, preApprove = false }) {
  const scenario = window.SEMANTIX_SCENARIOS[scenarioKey];
  const [approvals, setApprovals] = useDS(() => {
    if (!preApprove) return {};
    const a = {};
    scenario.diff.forEach(d => { if (d.policy !== 'block') a[d.id] = 'approve'; });
    return a;
  });
  const [expanded, setExpanded] = useDS(() => {
    // auto-expand the first attention item so the important thing is visible
    const att = scenario.diff.find(d => d.policy !== 'pass');
    return att ? att.id : null;
  });
  const [showPlan, setShowPlan] = useDS(showPlanDefault);

  // Color/token set — softer than the main surface, closer to Linear/Radar
  const c = {
    bg: '#fbfaf7',
    panel: '#ffffff',
    panelAlt: '#f4f2ed',
    border: '#e8e5de',
    borderStrong: '#d8d3c8',
    text: '#1a1814',
    textDim: '#5a564e',
    textFaint: '#8a8478',
    accent: '#2d5a3f',      // deep forest green — "proceed"
    accentSoft: '#e8f0ea',
    warn: '#b8791f',        // amber
    warnSoft: '#fdf4e3',
    block: '#a8413a',       // muted red
    blockSoft: '#fae9e6',
    ok: '#2d5a3f',
  };

  const approvedCount = scenario.diff.filter(d => approvals[d.id] === 'approve').length;
  const blockedByPolicy = scenario.diff.filter(d => d.policy === 'block').length;
  const needsDecision = scenario.diff.filter(d => d.policy !== 'block' && !approvals[d.id]).length;
  const allDecidedOk = scenario.diff.every(d => d.policy === 'block' || approvals[d.id] === 'approve');

  function setVerdict(id, v) {
    setApprovals(a => ({ ...a, [id]: v }));
  }

  return (
    <div style={{
      width, height, background: c.bg, color: c.text,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
      fontSize: 13, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      position: 'relative',
    }}>
      {/* Header: brand + status + minimal chrome */}
      <div style={{
        flexShrink: 0, padding: '18px 28px 14px', borderBottom: `1px solid ${c.border}`,
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{
          width: 24, height: 24, borderRadius: 7, background: c.accent,
          display: 'grid', placeItems: 'center', color: '#fff',
        }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12l4 4L19 6"/></svg>
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, letterSpacing: -0.1 }}>Semantix</div>
          <div style={{ fontSize: 11, color: c.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>
            run_{scenarioKey === 'swe' ? '8f1c' : scenarioKey === 'support' ? '4a92' : 'c7d3'}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={() => setShowPlan(s => !s)} style={{
          fontSize: 12, color: c.textDim, background: 'transparent', border: `1px solid ${c.border}`,
          borderRadius: 6, padding: '6px 10px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="3" cy="3" r="1.5"/><circle cx="9" cy="3" r="1.5"/><circle cx="3" cy="9" r="1.5"/><circle cx="9" cy="9" r="1.5"/>
            <path d="M3 4.5v3M9 4.5v3M4.5 3h3M4.5 9h3"/>
          </svg>
          {showPlan ? 'Hide plan' : 'See plan'}
        </button>
      </div>

      {/* Intent line — one sentence, no boundaries list */}
      <div style={{
        flexShrink: 0, padding: '20px 28px 22px',
        display: 'flex', alignItems: 'flex-start', gap: 16,
      }}>
        <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase',
          color: c.textFaint, paddingTop: 3, width: 56, flexShrink: 0 }}>Intent</div>
        <div style={{ fontSize: 16, lineHeight: 1.4, color: c.text, flex: 1, letterSpacing: -0.1,
          textWrap: 'pretty' }}>{scenario.intent.directive}</div>
      </div>

      {/* Summary strip — what's waiting on you */}
      <div style={{
        flexShrink: 0, margin: '0 28px', padding: '12px 16px',
        background: c.panelAlt, borderRadius: 8, border: `1px solid ${c.border}`,
        display: 'flex', alignItems: 'center', gap: 18, fontSize: 12.5,
      }}>
        <Summary label={`${needsDecision} pending`} color={c.warn} dot />
        <Sep c={c} />
        <Summary label={`${approvedCount} approved`} color={c.ok} />
        {blockedByPolicy > 0 && <>
          <Sep c={c} />
          <Summary label={`${blockedByPolicy} blocked by policy`} color={c.block} />
        </>}
        <div style={{ flex: 1 }} />
        <span style={{ color: c.textFaint }}>
          <span style={{ fontWeight: 500, color: c.textDim }}>{scenario.diff.length}</span> total changes
        </span>
      </div>

      {/* Changes list — primary surface */}
      <div style={{ flex: 1, overflow: 'auto', padding: '18px 28px 120px' }}>
        {scenario.diff.map((d, i) => (
          <ChangeCard
            key={d.id} c={c} d={d} scenario={scenario}
            verdict={approvals[d.id]} setVerdict={(v) => setVerdict(d.id, v)}
            expanded={expanded === d.id}
            onToggle={() => setExpanded(e => e === d.id ? null : d.id)}
          />
        ))}
      </div>

      {/* Bottom action bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0,
        padding: '14px 28px', background: c.panel, borderTop: `1px solid ${c.border}`,
        display: 'flex', alignItems: 'center', gap: 12,
      }}>
        <div style={{ flex: 1, fontSize: 12.5, color: c.textDim }}>
          {allDecidedOk
            ? <>All unblocked changes approved.{blockedByPolicy > 0 && <span style={{ color: c.textFaint }}> · {blockedByPolicy} will not run.</span>}</>
            : <>{needsDecision} change{needsDecision === 1 ? '' : 's'} need{needsDecision === 1 ? 's' : ''} your decision before this can run.</>
          }
        </div>
        <button style={{
          fontSize: 13, padding: '9px 14px', borderRadius: 7,
          background: 'transparent', color: c.textDim, border: `1px solid ${c.border}`,
          cursor: 'pointer', fontWeight: 500,
        }}>Approve all safe</button>
        <button disabled={!allDecidedOk} style={{
          fontSize: 13, padding: '9px 18px', borderRadius: 7,
          background: allDecidedOk ? c.accent : c.panelAlt,
          color: allDecidedOk ? '#fff' : c.textFaint,
          border: `1px solid ${allDecidedOk ? c.accent : c.border}`,
          cursor: allDecidedOk ? 'pointer' : 'not-allowed', fontWeight: 600,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          Run this
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 2l5 4-5 4V2z"/></svg>
        </button>
      </div>

      {/* Plan drawer — secondary surface, opened on demand */}
      {showPlan && <PlanDrawer c={c} scenario={scenario} onClose={() => setShowPlan(false)} />}
    </div>
  );
}

function Summary({ label, color, dot }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color }}>
      {dot && <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />}
      <span style={{ fontWeight: 600 }}>{label}</span>
    </span>
  );
}
function Sep({ c }) { return <span style={{ color: c.textFaint }}>·</span>; }

// One change card: header (icon + target + verdict) + expanded body
// Body holds: the preview, and — only if risky — a single "why" strip.
// No separate inspector panel; no grounding metadata in the face of a
// user making a decision.
function ChangeCard({ c, d, scenario, verdict, setVerdict, expanded, onToggle }) {
  const node = scenario.nodes.find(n => n.id === d.node);
  const isBlocked = d.policy === 'block';
  // Problem is only real when there's a critique OR explicit flags.
  // review_required alone doesn't constitute "needs attention" — the
  // system shouldn't cry wolf on every file edit.
  const hasProblem = !!(node?.critique || (d.flags && d.flags.length > 0));
  const [deep, setDeep] = useDS(false);

  const verdictColor =
    verdict === 'approve' ? c.ok :
    verdict === 'block' ? c.block :
    isBlocked ? c.block : c.textFaint;

  const opIcon = {
    create: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M6.5 3v7M3 6.5h7"/></svg>,
    modify: <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M9 2.5L10.5 4 4 10.5l-2 .5.5-2z"/></svg>,
    call:   <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2.5 6.5h8M7.5 3.5l3 3-3 3"/></svg>,
    'github.pr.open': <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="3.5" cy="3.5" r="1.3"/><circle cx="3.5" cy="9.5" r="1.3"/><circle cx="9.5" cy="9.5" r="1.3"/><path d="M3.5 4.8v3.4M5 9.5h3"/></svg>,
  }[d.op] || opIcon?.call;

  return (
    <div style={{
      background: c.panel, border: `1px solid ${verdict === 'approve' ? c.accentSoft : c.border}`,
      borderLeft: `3px solid ${
        isBlocked ? c.block :
        verdict === 'approve' ? c.ok :
        verdict === 'block' ? c.block :
        hasProblem ? c.warn : c.border
      }`,
      borderRadius: 8, marginBottom: 10, overflow: 'hidden',
      transition: 'border-color .15s',
    }}>
      <div onClick={onToggle} style={{
        padding: '12px 14px 12px 16px', display: 'flex', alignItems: 'center',
        gap: 12, cursor: 'pointer',
      }}>
        <div style={{
          width: 26, height: 26, borderRadius: 6, background: c.panelAlt,
          display: 'grid', placeItems: 'center', color: c.textDim, flexShrink: 0,
        }}>{opIcon}</div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: c.textFaint, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {opLabel(d.op)}
            </span>
            {hasProblem && !isBlocked && (
              <span style={{ fontSize: 10.5, color: c.warn, background: c.warnSoft,
                padding: '2px 7px', borderRadius: 999, fontWeight: 500, letterSpacing: 0.2 }}>
                needs a closer look
              </span>
            )}
            {isBlocked && (
              <span style={{ fontSize: 10.5, color: c.block, background: c.blockSoft,
                padding: '2px 7px', borderRadius: 999, fontWeight: 500, letterSpacing: 0.2 }}>
                blocked by policy
              </span>
            )}
            {d.reversibility === 'irreversible' && (
              <span style={{ fontSize: 10.5, color: c.textDim,
                padding: '2px 7px', borderRadius: 999, fontWeight: 500,
                border: `1px solid ${c.border}` }}>irreversible</span>
            )}
          </div>
          <div style={{ fontSize: 14, fontWeight: 500, marginTop: 3, color: c.text,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontFamily: d.kind === 'file' ? 'ui-monospace, Menlo, monospace' : 'inherit' }}>
            {d.target}
          </div>
          <div style={{ fontSize: 12, color: c.textDim, marginTop: 2 }}>{d.summary}</div>
        </div>

        {/* Verdict buttons — the core decision, nothing else competes */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
          {isBlocked ? (
            <span style={{ fontSize: 12, color: c.block, fontWeight: 500, padding: '6px 10px' }}>
              will not run
            </span>
          ) : (
            <>
              <VerdictBtn c={c} kind="block" active={verdict === 'block'} onClick={() => setVerdict(verdict === 'block' ? null : 'block')} />
              <VerdictBtn c={c} kind="approve" active={verdict === 'approve'} onClick={() => setVerdict(verdict === 'approve' ? null : 'approve')} />
            </>
          )}
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke={c.textFaint} strokeWidth="1.8" strokeLinecap="round"
            style={{ marginLeft: 4, transform: expanded ? 'rotate(180deg)' : '', transition: 'transform .15s' }}>
            <path d="M2 3.5l3 3 3-3"/>
          </svg>
        </div>
      </div>

      {expanded && (
        <div style={{ borderTop: `1px solid ${c.border}`, background: c.panelAlt }}>
          {/* Why-strip: ONLY appears if there's a real concern */}
          {(node?.critique || (d.flags && d.flags.length > 0)) && (
            <div style={{
              padding: '12px 16px', borderBottom: `1px solid ${c.border}`,
              background: isBlocked ? c.blockSoft : c.warnSoft,
              display: 'flex', alignItems: 'flex-start', gap: 10,
            }}>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke={isBlocked ? c.block : c.warn} strokeWidth="1.6" strokeLinecap="round" style={{ marginTop: 2, flexShrink: 0 }}>
                <path d="M7 1L13 12H1z M7 5v3.5 M7 10v.5"/>
              </svg>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: c.text, flex: 1 }}>
                <div style={{ fontWeight: 600, marginBottom: 2 }}>
                  {isBlocked ? 'Why this is blocked' : node?.critique ? 'Why this needs a closer look' : 'Heads up'}
                </div>
                <div style={{ color: c.textDim }}>
                  {node?.critique?.summary || (d.flags && d.flags[0])}
                </div>
                {node?.critique?.suggestion && (
                  <div style={{ marginTop: 6, fontSize: 12, color: c.textDim }}>
                    <span style={{ color: c.accent, fontWeight: 500 }}>→ </span>
                    {node.critique.suggestion}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Preview */}
          <pre style={{
            margin: 0, padding: '14px 16px',
            fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 11.5,
            lineHeight: 1.55, color: c.text, overflow: 'auto', maxHeight: 220,
            whiteSpace: 'pre', background: c.panel,
          }}>{colorizePreview(d.preview, c)}</pre>

          {/* Layer 3 — details. Collapsed by default. Grounding, constraints,
              context scope, provenance. Only surfaces when the user explicitly
              asks "how did we get here?" */}
          <div style={{ borderTop: `1px solid ${c.border}`, background: c.panel }}>
            <button onClick={() => setDeep(x => !x)} style={{
              width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
              background: 'transparent', padding: '10px 16px', color: c.textDim,
              fontSize: 12, fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
                style={{ transform: deep ? 'rotate(90deg)' : '', transition: 'transform .15s' }}>
                <path d="M3.5 2l3 3-3 3"/>
              </svg>
              <span>{deep ? 'Hide details' : 'Show details'}</span>
              <span style={{ color: c.textFaint, fontSize: 11 }}>
                · context, constraints, grounding, provenance
              </span>
            </button>
            {deep && node && <DetailGrid c={c} node={node} d={d} />}
          </div>
        </div>
      )}
    </div>
  );
}

function DetailGrid({ c, node, d }) {
  const Row = ({ label, children }) => (
    <div style={{ display: 'flex', gap: 14, padding: '10px 16px', borderTop: `1px solid ${c.border}`, fontSize: 12 }}>
      <div style={{ width: 90, flexShrink: 0, color: c.textFaint, fontWeight: 600, fontSize: 10.5, letterSpacing: 0.6, textTransform: 'uppercase', paddingTop: 2 }}>{label}</div>
      <div style={{ flex: 1, color: c.textDim, lineHeight: 1.5 }}>{children}</div>
    </div>
  );
  const Tag = ({ children, bg = c.panelAlt, fg = c.textDim }) => (
    <span style={{ display: 'inline-block', fontSize: 11, padding: '2px 7px', borderRadius: 4, background: bg, color: fg, marginRight: 4, marginBottom: 3, fontFamily: d.kind === 'file' ? 'ui-monospace, Menlo, monospace' : 'inherit' }}>{children}</span>
  );
  const groundingTone = {
    grounded: { bg: c.accentSoft, fg: c.ok, label: 'grounded' },
    transformed: { bg: c.panelAlt, fg: c.textDim, label: 'transformed' },
    bridged: { bg: c.warnSoft, fg: c.warn, label: 'bridged — assumptions' },
    invented: { bg: c.blockSoft, fg: c.block, label: 'invented' },
  }[node.grounding] || { bg: c.panelAlt, fg: c.textDim, label: node.grounding };
  return (
    <div>
      <Row label="Node">
        <span style={{ color: c.text, fontWeight: 500 }}>{node.title}</span>
        <span style={{ color: c.textFaint, marginLeft: 8, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{node.id} · {node.type}</span>
      </Row>
      <Row label="Grounding">
        <Tag bg={groundingTone.bg} fg={groundingTone.fg}>{groundingTone.label}</Tag>
        <span style={{ color: c.textFaint }}>· confidence {node.confidence}</span>
      </Row>
      {node.inputs && node.inputs.length > 0 && (
        <Row label="Context">
          {node.inputs.map((i, k) => <Tag key={k}>{i}</Tag>)}
        </Row>
      )}
      {node.constraints?.hard && node.constraints.hard.length > 0 && (
        <Row label="Constraints">
          {node.constraints.hard.map((x, k) => (
            <div key={k} style={{ marginBottom: 2 }}>
              <span style={{ color: c.ok, marginRight: 6 }}>✓</span>{x}
            </div>
          ))}
        </Row>
      )}
      {node.tools_visible && node.tools_visible.length > 0 && (
        <Row label="Tools">
          {node.tools_visible.map((t, k) => <Tag key={k}>{t}</Tag>)}
        </Row>
      )}
      <Row label="Provenance">
        owner <span style={{ color: c.textDim, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11 }}>{node.owner || d.owner}</span>
        {d.reversibility && <> · <span>{d.reversibility}</span></>}
      </Row>
    </div>
  );
}

function VerdictBtn({ c, kind, active, onClick }) {
  const on = kind === 'approve'
    ? { bg: c.ok, fg: '#fff', label: 'Approve' }
    : { bg: c.block, fg: '#fff', label: 'Block' };
  const off = { bg: 'transparent', fg: c.textDim, border: c.border };
  return (
    <button onClick={onClick} style={{
      fontSize: 12, padding: '6px 12px', borderRadius: 6,
      background: active ? on.bg : off.bg,
      color: active ? on.fg : off.fg,
      border: `1px solid ${active ? on.bg : off.border}`,
      cursor: 'pointer', fontWeight: 500, transition: 'all .12s',
    }}>{on.label}</button>
  );
}

function opLabel(op) {
  return {
    create: 'Create file',
    modify: 'Modify file',
    call: 'External call',
    'github.pr.open': 'Open pull request',
  }[op] || op;
}

// Paint diff +/- lines, otherwise plain. Also dim context lines.
function colorizePreview(text, c) {
  if (!text) return null;
  return text.split('\n').map((line, i) => {
    const first = line.trimStart()[0];
    let color = c.textDim;
    let bg = 'transparent';
    if (first === '+' || line.startsWith('+ ')) { color = c.ok; bg = 'rgba(45,90,63,0.06)'; }
    else if (first === '-' || line.startsWith('- ')) { color = c.block; bg = 'rgba(168,65,58,0.06)'; }
    else if (first === '!' || line.includes('⚠')) { color = c.warn; bg = c.warnSoft; }
    return <div key={i} style={{ color, background: bg, padding: '0 4px', margin: '0 -4px' }}>{line || ' '}</div>;
  });
}

// The plan. Appears on demand as a side drawer, not always visible.
// Just the node list with risk color + one-line purpose. No edges, no
// metadata — if you want the graph, open the full 3-panel view.
function PlanDrawer({ c, scenario, onClose }) {
  return (
    <div style={{
      position: 'absolute', top: 0, right: 0, bottom: 0, width: 360,
      background: c.panel, borderLeft: `1px solid ${c.border}`,
      boxShadow: '-8px 0 24px rgba(0,0,0,.05)',
      display: 'flex', flexDirection: 'column', zIndex: 10,
    }}>
      <div style={{ flexShrink: 0, padding: '18px 20px 14px', borderBottom: `1px solid ${c.border}`,
        display: 'flex', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Execution plan</div>
          <div style={{ fontSize: 11, color: c.textFaint, marginTop: 2 }}>
            {scenario.nodes.length} steps · compiled from your prompt
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{
          border: 'none', background: 'transparent', color: c.textDim, cursor: 'pointer',
          width: 24, height: 24, borderRadius: 4, fontSize: 18, lineHeight: 1,
        }}>×</button>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '14px 20px' }}>
        {scenario.nodes.map((n, i) => {
          const riskColor = n.risk === 'green' ? c.ok : n.risk === 'orange' || n.risk === 'red' ? c.warn : c.textFaint;
          return (
            <div key={n.id} style={{ display: 'flex', gap: 10, paddingBottom: 14, position: 'relative' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                <div style={{ width: 9, height: 9, borderRadius: 999, background: riskColor, marginTop: 5 }} />
                {i < scenario.nodes.length - 1 && (
                  <div style={{ width: 1, flex: 1, background: c.border, marginTop: 2, minHeight: 14 }} />
                )}
              </div>
              <div style={{ flex: 1, paddingBottom: 4 }}>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: c.text, letterSpacing: -0.1 }}>{n.title}</div>
                <div style={{ fontSize: 11.5, color: c.textDim, marginTop: 2, lineHeight: 1.45 }}>{n.purpose}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { DecisionMode });
