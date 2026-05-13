// Diff panel — the most important surface: what will actually change
const { useState: useStateD } = React;

function PolicyPill({ t, policy }) {
  if (policy === 'block') return <Pill t={t} risk="red" strong>blocked by policy</Pill>;
  if (policy === 'review_required') return <Pill t={t} risk="orange">review required</Pill>;
  return <Pill t={t} risk="green">policy pass</Pill>;
}

function ReversibilityPill({ t, reversibility }) {
  if (reversibility === 'irreversible') return <Pill t={t} risk="red">irreversible</Pill>;
  if (reversibility === 'reversible_within_window') return <Pill t={t} risk="yellow">reversible (window)</Pill>;
  return <Pill t={t} risk="green">reversible</Pill>;
}

function renderDiffLine(line, t, i) {
  const first = line[0];
  let color = t.text, bg = 'transparent', gutter = ' ';
  if (first === '+' && line[1] === '!') {
    // flagged addition
    color = t.text; bg = t.orangeSoft; gutter = '+';
    line = ' ' + line.slice(2);
  } else if (first === '+') {
    color = t.green; bg = t.greenSoft; gutter = '+';
    line = line.slice(1);
  } else if (first === '-') {
    color = t.red; bg = t.redSoft; gutter = '−';
    line = line.slice(1);
  } else if (first === '!') {
    color = t.orange; bg = t.orangeSoft; gutter = '!';
    line = line.slice(1);
  }
  return (
    <div key={i} style={{
      display: 'flex', gap: 10, padding: '0 10px', background: bg, minHeight: 18,
    }}>
      <span style={{ width: 14, color: t.textFaint, fontSize: 11, textAlign: 'right', userSelect: 'none', flexShrink: 0 }}>{i + 1}</span>
      <span style={{ width: 12, color: t.textFaint, userSelect: 'none', flexShrink: 0 }}>{gutter}</span>
      <span style={{ color, whiteSpace: 'pre', fontSize: 12 }}>{line || ' '}</span>
    </div>
  );
}

function DiffPanel({ t, diff, focusId, onFocusDiff, approvals, onApprove, onBlock, onRequireChanges, runState }) {
  const [expanded, setExpanded] = useState({});

  // Auto-expand the focused one
  useEffect(() => {
    if (focusId) setExpanded(e => ({ ...e, [focusId]: true }));
  }, [focusId]);

  const stats = diff.reduce((acc, d) => {
    const a = approvals[d.id];
    if (a === 'approve') acc.approved++;
    else if (a === 'block') acc.blocked++;
    else if (d.policy === 'block') acc.policyBlocked++;
    else if (d.policy === 'review_required') acc.review++;
    else acc.pending++;
    return acc;
  }, { approved: 0, blocked: 0, policyBlocked: 0, review: 0, pending: 0 });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', borderBottom: `1px solid ${t.border}`, background: t.panel, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: t.text, flex: 1 }}>State diff · what becomes real</div>
          <span style={{ fontSize: 11, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>
            {diff.length} change{diff.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
          {stats.approved > 0 && <Pill t={t} risk="green" strong>{stats.approved} approved</Pill>}
          {stats.policyBlocked > 0 && <Pill t={t} risk="red" strong>{stats.policyBlocked} policy-blocked</Pill>}
          {stats.blocked > 0 && <Pill t={t} risk="red">{stats.blocked} blocked by you</Pill>}
          {stats.review > 0 && <Pill t={t} risk="orange">{stats.review} review needed</Pill>}
          {stats.pending > 0 && <Pill t={t}>{stats.pending} pending</Pill>}
        </div>
      </div>

      {/* Change list */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
        {diff.map(d => {
          const KindIcon = KIND_ICON[d.kind] || Icon.File;
          const open = expanded[d.id] || focusId === d.id;
          const approval = approvals[d.id];
          const lines = (d.preview || '').split('\n');
          const policyBlocked = d.policy === 'block';
          const focused = focusId === d.id;

          return (
            <div key={d.id} id={`diff-${d.id}`} style={{
              marginBottom: 12, borderRadius: 10,
              border: `1px solid ${focused ? t.accent : (policyBlocked ? t.red + '60' : t.border)}`,
              background: t.panel,
              boxShadow: focused ? `0 0 0 3px ${t.accent}22` : 'none',
              transition: 'all 160ms',
              overflow: 'hidden',
            }}>
              {/* Change header */}
              <div onClick={() => setExpanded(e => ({ ...e, [d.id]: !e[d.id] }))}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer' }}>
                <div style={{ color: policyBlocked ? t.red : t.textDim }}><KindIcon /></div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 10, fontFamily: 'ui-monospace, Menlo, monospace', color: t.textFaint, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {d.kind} · {d.op}
                    </span>
                    <span style={{ fontSize: 10, color: t.textFaint }}>from</span>
                    <span style={{ fontSize: 10, fontFamily: 'ui-monospace, Menlo, monospace', color: t.accent, cursor: 'pointer' }}
                      onClick={(e) => { e.stopPropagation(); onFocusDiff('node', d.node); }}>
                      {d.node}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.target}
                  </div>
                  <div style={{ fontSize: 12, color: t.textDim, marginTop: 2 }}>{d.summary}</div>
                </div>
                <Icon.Chevron style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 160ms', color: t.textFaint }} />
              </div>

              {/* Badges row */}
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '0 14px 10px' }}>
                <PolicyPill t={t} policy={d.policy} />
                <ReversibilityPill t={t} reversibility={d.reversibility} />
                <Pill t={t}>enforced by {d.owner}</Pill>
                {approval === 'approve' && <Pill t={t} risk="green" strong>✓ approved</Pill>}
                {approval === 'block' && <Pill t={t} risk="red" strong>✕ blocked</Pill>}
                {approval === 'changes' && <Pill t={t} risk="orange" strong>↺ changes requested</Pill>}
              </div>

              {/* Flags */}
              {d.flags && d.flags.length > 0 && (
                <div style={{ padding: '0 14px 10px' }}>
                  {d.flags.map((f, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 10px',
                      background: t.orangeSoft, borderRadius: 6, fontSize: 12, color: t.text,
                      marginBottom: 4,
                    }}>
                      <div style={{ color: t.orange, marginTop: 1 }}><Icon.Alert /></div>
                      <div style={{ flex: 1 }}>{f}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Expanded preview */}
              {open && (
                <div>
                  <div style={{
                    background: t.panelAlt, borderTop: `1px solid ${t.border}`,
                    fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, padding: '10px 0',
                    overflowX: 'auto', lineHeight: 1.55,
                  }}>
                    {lines.map((ln, i) => renderDiffLine(ln, t, i))}
                  </div>

                  {/* Per-change actions */}
                  <div style={{ padding: 10, borderTop: `1px solid ${t.border}`, display: 'flex', gap: 6, flexWrap: 'wrap', background: t.panel }}>
                    {policyBlocked ? (
                      <div style={{ fontSize: 12, color: t.textDim, padding: '6px 4px' }}>
                        <Icon.Lock style={{ verticalAlign: 'middle', marginRight: 6, color: t.red }} />
                        Blocked by policy. Cannot be approved from this surface.
                      </div>
                    ) : (
                      <>
                        <Btn t={t} variant="approve" icon={<Icon.Check />} onClick={() => onApprove(d.id)}
                          disabled={runState !== 'review' || approval === 'approve'}>
                          {approval === 'approve' ? 'Approved' : 'Approve change'}
                        </Btn>
                        <Btn t={t} variant="ghost" icon={<Icon.Edit />} onClick={() => onRequireChanges(d.id)}
                          disabled={runState !== 'review'}>
                          Require changes
                        </Btn>
                        <Btn t={t} variant="ghost" icon={<Icon.X />} onClick={() => onBlock(d.id)}
                          disabled={runState !== 'review'}>
                          Block
                        </Btn>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { DiffPanel });
