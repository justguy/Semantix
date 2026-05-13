// Phase views: prompt, compiling, review (3-panel), running, done

function PromptView({ t, scenario, prompt, setPrompt, onCompile }) {
  const samples = Object.values(window.SEMANTIX_SCENARIOS).map(s => ({ key: s.key, label: s.label, prompt: s.prompt }));
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 32, overflow: 'auto' }}>
      <div style={{ width: '100%', maxWidth: 720 }}>
        <div style={{ fontSize: 11, color: t.textFaint, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>
          New run
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.6, margin: '0 0 8px', color: t.text, lineHeight: 1.15 }}>
          What should Semantix do?
        </h1>
        <p style={{ fontSize: 14, color: t.textDim, margin: '0 0 24px', lineHeight: 1.55 }}>
          Describe the outcome you want. Semantix will compile a plan, show you exactly what will change,
          and wait for your approval before anything becomes real.
        </p>

        <div style={{
          background: t.panel, border: `1px solid ${t.border}`, borderRadius: 12,
          boxShadow: t.shadowLg, overflow: 'hidden',
        }}>
          <textarea value={prompt} onChange={e => setPrompt(e.target.value)}
            placeholder="e.g. Add email verification to signup…"
            style={{
              width: '100%', minHeight: 120, padding: '16px 18px',
              background: 'transparent', border: 'none', outline: 'none',
              fontSize: 14, lineHeight: 1.55, color: t.text, resize: 'vertical',
              fontFamily: 'inherit',
            }} />
          <div style={{
            borderTop: `1px solid ${t.border}`, padding: '10px 12px',
            display: 'flex', alignItems: 'center', gap: 8, background: t.panelAlt,
          }}>
            <span style={{ fontSize: 11, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>
              policy: prod.yaml · approval: required
            </span>
            <div style={{ flex: 1 }} />
            <Btn t={t} variant="primary" icon={<Icon.Spark />} onClick={onCompile}>
              Compile plan
            </Btn>
          </div>
        </div>

        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 11, color: t.textFaint, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
            Or start from a scenario
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {samples.map(s => (
              <button key={s.key} onClick={() => { setPrompt(s.prompt); }}
                style={{
                  textAlign: 'left', padding: 14, background: t.panel,
                  border: `1px solid ${prompt === s.prompt ? t.accent : t.border}`, borderRadius: 10,
                  cursor: 'pointer', color: t.text, fontFamily: 'inherit',
                  transition: 'border-color 120ms',
                }}>
                <div style={{ fontSize: 12, color: t.accent, fontWeight: 600, marginBottom: 6 }}>{s.label}</div>
                <div style={{ fontSize: 12, color: t.textDim, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {s.prompt}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 32, fontSize: 11.5, color: t.textFaint, lineHeight: 1.6, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>⌘ + Enter to compile</span>
          <span>·</span>
          <span>No action runs until you approve the diff</span>
          <span>·</span>
          <span>Every approval is logged, versioned, and resets if the diff changes</span>
        </div>
      </div>
    </div>
  );
}

function CompilingView({ t, scenario }) {
  const [step, setStep] = useState(0);
  const steps = [
    'Parsing prompt → intent contract',
    'Loading repo context',
    'Splitting deterministic vs semantic regions',
    'Compiling constraints into guardrails',
    'Binding tools and policies',
    'Building reviewable blueprint',
  ];
  useEffect(() => {
    const iv = setInterval(() => setStep(s => Math.min(s + 1, steps.length)), 180);
    return () => clearInterval(iv);
  }, []);
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 32 }}>
      <div style={{ maxWidth: 480, width: '100%' }}>
        <div style={{ fontSize: 11, color: t.textFaint, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>
          Compiling
        </div>
        <div style={{ fontSize: 22, fontWeight: 600, color: t.text, marginBottom: 24, letterSpacing: -0.3 }}>
          Turning your prompt into a reviewable plan…
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {steps.map((s, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              fontSize: 13, color: i < step ? t.text : t.textFaint,
              opacity: i <= step ? 1 : 0.4,
              transition: 'all 200ms',
            }}>
              <span style={{
                width: 16, height: 16, borderRadius: 999,
                border: `1.5px solid ${i < step ? t.green : t.border}`,
                background: i < step ? t.green : 'transparent',
                display: 'grid', placeItems: 'center', color: '#fff',
                fontSize: 10,
              }}>
                {i < step ? '✓' : (i === step ? <span style={{
                  width: 6, height: 6, borderRadius: 999, background: t.accent,
                  animation: 'pulse 1s infinite',
                }} /> : '')}
              </span>
              {s}
            </div>
          ))}
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }`}</style>
    </div>
  );
}

function ReviewView({
  t, scenario, layout, setLayout,
  selectedNodeId, onSelectNode, focusDiffId, setFocusDiffId, onFocusDiff,
  selectedNode, approvals, nodeApprovals,
  onApprove, onBlock, onReqChanges, onIntervene,
  allApproved, hasPolicyBlock, onExecute, runState,
}) {
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Intent bar */}
      <IntentBar t={t} intent={scenario.intent} prompt={scenario.prompt} />

      {/* 3-panel */}
      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1.1fr 1fr 1.15fr', overflow: 'hidden', background: t.bg, minHeight: 0 }}>
        {/* Graph */}
        <div style={{ borderRight: `1px solid ${t.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: t.panel }}>
          <GraphHeader t={t} layout={layout} setLayout={setLayout} scenario={scenario} />
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <Graph t={t} nodes={scenario.nodes} edges={scenario.edges} layout={layout}
              selectedId={selectedNodeId} onSelect={onSelectNode} approved={nodeApprovals} />
          </div>
        </div>
        {/* Inspector */}
        <div style={{ borderRight: `1px solid ${t.border}`, overflow: 'hidden', background: t.panel }}>
          <Inspector t={t} node={selectedNode} allDiff={scenario.diff}
            onJumpToDiff={(id) => setFocusDiffId(id)}
            onIntervene={onIntervene} />
        </div>
        {/* Diff */}
        <div style={{ overflow: 'hidden', background: t.bg }}>
          <DiffPanel t={t} diff={scenario.diff} focusId={focusDiffId} onFocusDiff={onFocusDiff}
            approvals={approvals} onApprove={onApprove} onBlock={onBlock} onRequireChanges={onReqChanges}
            runState={runState} />
        </div>
      </div>

      {/* Action bar */}
      <ActionBar t={t} scenario={scenario} approvals={approvals}
        allApproved={allApproved} hasPolicyBlock={hasPolicyBlock} onExecute={onExecute} />
    </div>
  );
}

function IntentBar({ t, intent, prompt }) {
  const [open, setOpen] = useState(true);
  return (
    <div style={{ borderBottom: `1px solid ${t.border}`, background: t.panel }}>
      <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: t.textFaint, textTransform: 'uppercase' }}>
          Intent
        </div>
        <div style={{ fontSize: 13, color: t.text, fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {intent.directive}
        </div>
        <Pill t={t} risk="green" strong>approved</Pill>
        <button onClick={() => setOpen(!open)} style={{
          background: 'transparent', border: 'none', color: t.textDim, cursor: 'pointer',
          fontSize: 12, display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {open ? 'Hide' : 'Show'} boundaries
          <Icon.Chevron style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 160ms' }} />
        </button>
      </div>
      {open && (
        <div style={{ padding: '0 20px 14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, fontSize: 12 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: t.textFaint, marginBottom: 6 }}>
              Strict boundaries
            </div>
            {intent.boundaries.map((b, i) => (
              <div key={i} style={{ fontSize: 12, color: t.text, padding: '2px 0', display: 'flex', gap: 6 }}>
                <span style={{ color: t.red }}>✕</span>{b}
              </div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: 0.6, textTransform: 'uppercase', color: t.textFaint, marginBottom: 6 }}>
              Success state
            </div>
            <div style={{ fontSize: 12, color: t.text, lineHeight: 1.55 }}>{intent.success}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function GraphHeader({ t, layout, setLayout, scenario }) {
  const layouts = [
    { key: 'vertical', label: 'Vertical' },
    { key: 'horizontal', label: 'Horizontal' },
    { key: 'radial', label: 'Radial' },
  ];
  return (
    <div style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}`, background: t.panel,
      display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>Execution graph</div>
      <span style={{ fontSize: 11, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>
        {scenario.nodes.length} nodes · {scenario.edges.length} edges
      </span>
      <div style={{ flex: 1 }} />
      <div style={{ display: 'flex', gap: 2, background: t.panelAlt, borderRadius: 6, padding: 2, border: `1px solid ${t.border}` }}>
        {layouts.map(l => (
          <button key={l.key} onClick={() => setLayout(l.key)} style={{
            fontSize: 11, padding: '4px 8px', borderRadius: 4,
            background: layout === l.key ? t.panel : 'transparent',
            color: layout === l.key ? t.text : t.textDim,
            border: 'none', cursor: 'pointer', fontWeight: 500,
          }}>{l.label}</button>
        ))}
      </div>
    </div>
  );
}

function ActionBar({ t, scenario, approvals, allApproved, hasPolicyBlock, onExecute }) {
  const approvableCount = scenario.diff.filter(d => d.policy !== 'block').length;
  const approvedCount = scenario.diff.filter(d => approvals[d.id] === 'approve').length;
  const pctApproved = approvableCount === 0 ? 0 : approvedCount / approvableCount;

  return (
    <div style={{
      height: 56, flexShrink: 0, borderTop: `1px solid ${t.border}`, background: t.panel,
      display: 'flex', alignItems: 'center', padding: '0 20px', gap: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 120, height: 6, background: t.panelAlt, borderRadius: 999,
          overflow: 'hidden', border: `1px solid ${t.border}`,
        }}>
          <div style={{
            height: '100%', width: `${pctApproved * 100}%`,
            background: allApproved ? t.green : t.accent,
            transition: 'width 180ms',
          }} />
        </div>
        <span style={{ fontSize: 12, color: t.textDim, fontFamily: 'ui-monospace, Menlo, monospace' }}>
          {approvedCount}/{approvableCount} approved
        </span>
      </div>

      {hasPolicyBlock && (
        <Pill t={t} risk="red" strong>1+ action blocked by policy</Pill>
      )}

      <div style={{ flex: 1 }} />

      <Btn t={t} variant="ghost" icon={<Icon.Refresh />}>Re-compile</Btn>
      <Btn t={t} variant="approve" icon={<Icon.Check />}
        disabled={!allApproved}
        onClick={onExecute}
        title={allApproved ? 'Execute all approved changes' : 'Approve every non-blocked change first'}>
        {allApproved ? 'Authorize execution' : 'Approve remaining to authorize'}
      </Btn>
    </div>
  );
}

function RunningView({ t, scenario, progress, approvals }) {
  const approvedDiffs = scenario.diff.filter(d => approvals[d.id] === 'approve');
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 32 }}>
      <div style={{ maxWidth: 520, width: '100%' }}>
        <div style={{ fontSize: 11, color: t.textFaint, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 10 }}>
          Executing
        </div>
        <div style={{ fontSize: 22, fontWeight: 600, color: t.text, marginBottom: 20, letterSpacing: -0.3 }}>
          Applying approved changes…
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {approvedDiffs.map((d, i) => {
            const KindIcon = KIND_ICON[d.kind] || Icon.File;
            const done = i < progress;
            const active = i === progress;
            return (
              <div key={d.id} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 12px', borderRadius: 8,
                background: done ? t.greenSoft : (active ? t.accentSoft : t.panel),
                border: `1px solid ${done ? t.green + '40' : (active ? t.accent + '60' : t.border)}`,
                transition: 'all 220ms',
                opacity: i > progress ? 0.5 : 1,
              }}>
                <div style={{ color: done ? t.green : (active ? t.accent : t.textFaint) }}>
                  {done ? <Icon.Check /> : <KindIcon />}
                </div>
                <div style={{ flex: 1, fontSize: 13, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {d.target}
                </div>
                <div style={{ fontSize: 11, color: t.textDim, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                  {done ? 'done' : (active ? 'running…' : 'queued')}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DoneView({ t, scenario, approvals, onNewRun }) {
  const approvedDiffs = scenario.diff.filter(d => approvals[d.id] === 'approve');
  const blockedDiffs = scenario.diff.filter(d => approvals[d.id] === 'block' || d.policy === 'block');
  return (
    <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 32, overflow: 'auto' }}>
      <div style={{ maxWidth: 560, width: '100%' }}>
        <div style={{
          width: 48, height: 48, borderRadius: 14, background: t.greenSoft,
          display: 'grid', placeItems: 'center', color: t.green, marginBottom: 16,
        }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7"/></svg>
        </div>
        <div style={{ fontSize: 22, fontWeight: 600, color: t.text, marginBottom: 4, letterSpacing: -0.3 }}>
          Run complete
        </div>
        <div style={{ fontSize: 13, color: t.textDim, marginBottom: 24 }}>
          Audit artifact saved · <span style={{ fontFamily: 'ui-monospace, Menlo, monospace' }}>artifact_{scenario.key}_v1_8f1c</span>
        </div>

        <Card t={t} pad={0}>
          <div style={{ padding: '12px 14px', borderBottom: `1px solid ${t.border}`, fontSize: 12, fontWeight: 600, color: t.text }}>
            Applied {approvedDiffs.length} change{approvedDiffs.length !== 1 ? 's' : ''}
          </div>
          {approvedDiffs.map(d => {
            const KindIcon = KIND_ICON[d.kind] || Icon.File;
            return (
              <div key={d.id} style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}`,
                display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                <div style={{ color: t.green }}><Icon.Check /></div>
                <div style={{ color: t.textDim }}><KindIcon /></div>
                <div style={{ flex: 1, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.target}</div>
                <span style={{ fontSize: 11, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>{d.op}</span>
              </div>
            );
          })}
          {blockedDiffs.length > 0 && (
            <>
              <div style={{ padding: '12px 14px', borderBottom: `1px solid ${t.border}`, fontSize: 12, fontWeight: 600, color: t.text, background: t.panelAlt }}>
                Held back {blockedDiffs.length}
              </div>
              {blockedDiffs.map(d => (
                <div key={d.id} style={{ padding: '10px 14px', borderBottom: `1px solid ${t.border}`,
                  display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, opacity: 0.7 }}>
                  <div style={{ color: t.red }}><Icon.Block /></div>
                  <div style={{ flex: 1, color: t.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d.target}</div>
                  <span style={{ fontSize: 11, color: t.textFaint }}>{approvals[d.id] === 'block' ? 'blocked by you' : 'policy'}</span>
                </div>
              ))}
            </>
          )}
        </Card>

        <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
          <Btn t={t} variant="primary" icon={<Icon.Spark />} onClick={onNewRun}>New run</Btn>
          <Btn t={t} variant="ghost">View audit trail</Btn>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PromptView, CompilingView, ReviewView, RunningView, DoneView, IntentBar, GraphHeader, ActionBar });
