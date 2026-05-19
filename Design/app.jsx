// Main app shell — orchestrates state, phases, and the 3-panel layout
const { useState: useAS, useEffect: useAE, useMemo: useAM } = React;

const PHASES = {
  prompt: 'prompt',      // user types prompt
  compiling: 'compiling',// brief loading animation
  review: 'review',      // 3-panel review
  running: 'running',    // execution animation
  done: 'done',          // post-approval summary
};

function SemantixApp({ initialScenario = 'swe', initialPhase = 'prompt', embedded = false, forceTheme, forceLayout, preApprove = false }) {
  const [themeName, setThemeName] = useAS(forceTheme || 'light');
  const [layout, setLayout] = useAS(forceLayout || 'vertical');
  const [scenarioKey, setScenarioKey] = useAS(initialScenario);
  const scenario = window.SEMANTIX_SCENARIOS[scenarioKey];

  const [phase, setPhase] = useAS(initialPhase);
  const [prompt, setPrompt] = useAS(scenario.prompt);
  const [selectedNodeId, setSelectedNodeId] = useAS(null);
  const [focusDiffId, setFocusDiffId] = useAS(null);
  const [approvals, setApprovals] = useAS({}); // diffId -> 'approve'|'block'|'changes'
  const [nodeApprovals, setNodeApprovals] = useAS({});
  const [runProgress, setRunProgress] = useAS(0);

  useAE(() => { if (forceTheme) setThemeName(forceTheme); }, [forceTheme]);
  useAE(() => { if (forceLayout) setLayout(forceLayout); }, [forceLayout]);

  // For artboards that open directly into review/running/done, pre-populate
  // selection + approvals so the frame looks fully inhabited.
  useAE(() => {
    if (initialPhase === 'review' || initialPhase === 'running' || initialPhase === 'done') {
      const firstRisk = scenario.nodes.find(n => n.risk === 'orange' || n.risk === 'red') || scenario.nodes[0];
      if (firstRisk) {
        setSelectedNodeId(firstRisk.id);
        const firstDiff = scenario.diff.find(d => d.node === firstRisk.id);
        if (firstDiff) setFocusDiffId(firstDiff.id);
      }
    }
    if (preApprove) {
      const a = {};
      scenario.diff.forEach(d => { if (d.policy !== 'block') a[d.id] = 'approve'; });
      setApprovals(a);
    }
  }, []);

  const t = THEMES[themeName];

  // When scenario changes, reset
  useAE(() => {
    setPrompt(scenario.prompt);
    setPhase(PHASES.prompt);
    setSelectedNodeId(null);
    setFocusDiffId(null);
    setApprovals({});
    setNodeApprovals({});
    setRunProgress(0);
  }, [scenarioKey]);

  function compile() {
    setPhase(PHASES.compiling);
    setTimeout(() => {
      setPhase(PHASES.review);
      // auto-select first orange/red node to direct attention
      const firstRisk = scenario.nodes.find(n => n.risk === 'orange' || n.risk === 'red');
      if (firstRisk) {
        setSelectedNodeId(firstRisk.id);
        const firstDiff = scenario.diff.find(d => d.node === firstRisk.id);
        if (firstDiff) setFocusDiffId(firstDiff.id);
      }
    }, 1200);
  }

  function onSelectNode(nodeId) {
    setSelectedNodeId(nodeId);
    // auto-focus a diff for this node
    const nd = scenario.diff.find(d => d.node === nodeId);
    if (nd) setFocusDiffId(nd.id);
  }

  function onFocusDiff(kind, id) {
    if (kind === 'node') {
      setSelectedNodeId(id);
      const nd = scenario.diff.find(d => d.node === id);
      if (nd) setFocusDiffId(nd.id);
    }
  }

  function onApprove(diffId) { setApprovals(a => ({ ...a, [diffId]: 'approve' })); }
  function onBlock(diffId)   { setApprovals(a => ({ ...a, [diffId]: 'block' })); }
  function onReqChanges(diffId) { setApprovals(a => ({ ...a, [diffId]: 'changes' })); }
  function onIntervene(nodeId, kind) {
    // visually tweak: downgrade risk on regenerate
    if (kind === 'regenerate' || kind === 'add-source' || kind === 'tighten') {
      const n = scenario.nodes.find(x => x.id === nodeId);
      if (n) {
        n.risk = n.risk === 'red' ? 'orange' : (n.risk === 'orange' ? 'yellow' : 'green');
        n.confidence = 'medium';
        if (n.critique) n.critique = null;
        setSelectedNodeId(nodeId + ''); // force rerender
        // flash approvals reset for diffs from this node (freshness invalidation)
        const affectedDiffs = scenario.diff.filter(d => d.node === nodeId).map(d => d.id);
        setApprovals(a => {
          const next = { ...a };
          affectedDiffs.forEach(id => delete next[id]);
          return next;
        });
      }
    }
    if (kind === 'require-approval') {
      const n = scenario.nodes.find(x => x.id === nodeId);
      if (n) n.approval = true;
    }
  }

  // Can execute?
  const approvableDiffs = scenario.diff.filter(d => d.policy !== 'block');
  const allApproved = approvableDiffs.length > 0 &&
    approvableDiffs.every(d => approvals[d.id] === 'approve');
  const anyBlocked = scenario.diff.some(d => d.policy === 'block' && approvals[d.id] !== 'approve' /* unreachable */);
  const hasPolicyBlock = scenario.diff.some(d => d.policy === 'block');

  function execute() {
    setPhase(PHASES.running);
    setRunProgress(0);
    const steps = scenario.diff.filter(d => approvals[d.id] === 'approve').length;
    let i = 0;
    const tick = setInterval(() => {
      i++;
      setRunProgress(i);
      if (i >= steps) {
        clearInterval(tick);
        setTimeout(() => setPhase(PHASES.done), 500);
      }
    }, 450);
  }

  const selectedNode = scenario.nodes.find(n => n.id === selectedNodeId);

  const containerStyle = {
    background: t.bg, color: t.text,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
    height: embedded ? '100%' : '100vh',
    width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden',
    fontSize: 13,
  };

  return (
    <div style={containerStyle}>
      <TopBar t={t} phase={phase} scenario={scenario} scenarioKey={scenarioKey} setScenarioKey={setScenarioKey}
        themeName={themeName} setThemeName={setThemeName} embedded={embedded}
        onBackToPrompt={() => setPhase(PHASES.prompt)} />

      {phase === PHASES.prompt && (
        <PromptView t={t} scenario={scenario} prompt={prompt} setPrompt={setPrompt} onCompile={compile} />
      )}

      {phase === PHASES.compiling && <CompilingView t={t} scenario={scenario} />}

      {phase === PHASES.review && (
        <ReviewView t={t} scenario={scenario} layout={layout} setLayout={setLayout}
          selectedNodeId={selectedNodeId} onSelectNode={onSelectNode}
          focusDiffId={focusDiffId} setFocusDiffId={setFocusDiffId}
          onFocusDiff={onFocusDiff}
          selectedNode={selectedNode} approvals={approvals} nodeApprovals={nodeApprovals}
          onApprove={onApprove} onBlock={onBlock} onReqChanges={onReqChanges}
          onIntervene={onIntervene}
          allApproved={allApproved} hasPolicyBlock={hasPolicyBlock}
          onExecute={execute}
          runState="review"
        />
      )}

      {phase === PHASES.running && <RunningView t={t} scenario={scenario} progress={runProgress} approvals={approvals} />}

      {phase === PHASES.done && <DoneView t={t} scenario={scenario} approvals={approvals} onNewRun={() => setPhase(PHASES.prompt)} />}
    </div>
  );
}

// --- Top bar ---
function TopBar({ t, phase, scenario, scenarioKey, setScenarioKey, themeName, setThemeName, embedded, onBackToPrompt }) {
  const phaseLabels = {
    prompt: 'New run', compiling: 'Compiling plan…', review: 'Pending review',
    running: 'Executing', done: 'Complete',
  };
  const phaseColors = { prompt: t.textDim, compiling: t.accent, review: t.orange, running: t.accent, done: t.green };
  return (
    <div style={{
      height: 48, flexShrink: 0, borderBottom: `1px solid ${t.border}`, background: t.panel,
      display: 'flex', alignItems: 'center', padding: '0 16px', gap: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        <div style={{
          width: 22, height: 22, borderRadius: 6,
          background: `linear-gradient(135deg, ${t.accent}, ${t.accent}80)`,
          display: 'grid', placeItems: 'center', color: '#fff',
        }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12l4 4L19 6"/></svg>
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: -0.1 }}>Semantix</span>
        <span style={{ fontSize: 11, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace', marginLeft: 4 }}>
          control surface
        </span>
      </div>

      <div style={{ width: 1, height: 20, background: t.border }} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: phaseColors[phase] }} />
        <span style={{ color: t.textDim }}>{phaseLabels[phase]}</span>
        {phase !== 'prompt' && (
          <>
            <span style={{ color: t.textFaint }}>·</span>
            <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: t.textFaint, fontSize: 11 }}>
              run_{scenarioKey === 'swe' ? '8f1c' : scenarioKey === 'support' ? '4a92' : 'c7d3'}
            </span>
          </>
        )}
      </div>

      <div style={{ flex: 1 }} />

      {/* Scenario switcher */}
      <div style={{ display: 'flex', gap: 2, background: t.panelAlt, borderRadius: 7, padding: 2, border: `1px solid ${t.border}` }}>
        {Object.values(window.SEMANTIX_SCENARIOS).map(s => (
          <button key={s.key} onClick={() => setScenarioKey(s.key)} style={{
            fontSize: 11.5, fontWeight: 500, padding: '5px 10px', borderRadius: 5,
            background: scenarioKey === s.key ? t.panel : 'transparent',
            color: scenarioKey === s.key ? t.text : t.textDim,
            border: 'none', cursor: 'pointer',
            boxShadow: scenarioKey === s.key ? t.shadow : 'none',
          }}>{s.label}</button>
        ))}
      </div>

      {/* Theme toggle */}
      <button onClick={() => setThemeName(themeName === 'light' ? 'dark' : 'light')}
        style={{
          width: 28, height: 28, borderRadius: 6, border: `1px solid ${t.border}`,
          background: t.panel, color: t.textDim, cursor: 'pointer',
          display: 'grid', placeItems: 'center',
        }} title="Toggle theme">
        {themeName === 'light' ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.8A9 9 0 0111.2 3a7 7 0 109.8 9.8z"/></svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>
        )}
      </button>
    </div>
  );
}

Object.assign(window, { SemantixApp, TopBar, PHASES });
