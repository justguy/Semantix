const { useState: usePhaseState, useEffect: usePhaseEffect } = React;

function PromptView({ t, scenario, prompt, setPrompt, onCompile, isBusy }) {
  const samples = Object.values(window.SEMANTIX_SCENARIOS || {}).map((item) => ({
    key: item.key,
    label: item.label,
    prompt: item.prompt,
  }));

  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 32, overflow: "auto" }}>
      <div style={{ width: "100%", maxWidth: 760 }}>
        <div style={{ fontSize: 11, color: t.textFaint, letterSpacing: 1.2, textTransform: "uppercase", marginBottom: 10 }}>
          Declare intent
        </div>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.7, margin: "0 0 8px", color: t.text, lineHeight: 1.12 }}>
          What should Semantix compile for review?
        </h1>
        <p style={{ fontSize: 14, color: t.textDim, margin: "0 0 24px", lineHeight: 1.6, maxWidth: 620 }}>
          This is not a shell. Describe the outcome. Semantix will freeze the intent contract, compile a review artifact, surface state effects, and wait for approval before anything becomes real.
        </p>

        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 14, boxShadow: t.shadowLg, overflow: "hidden" }}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Example: Add email verification to signup and require dry-run email delivery in staging."
            style={{
              width: "100%",
              minHeight: 132,
              padding: "18px 20px",
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 15,
              lineHeight: 1.6,
              color: t.text,
              resize: "vertical",
              fontFamily: "inherit",
            }}
          />
          <div
            style={{
              borderTop: `1px solid ${t.border}`,
              padding: "12px 14px",
              display: "flex",
              alignItems: "center",
              gap: 10,
              background: t.panelAlt,
            }}
          >
            <span style={{ fontSize: 11, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>
              control-plane: review artifact · freshness-bound approval · audit recording
            </span>
            <div style={{ flex: 1 }} />
            <Btn t={t} variant="primary" icon={<Icon.Spark />} onClick={onCompile} disabled={isBusy}>
              Compile review artifact
            </Btn>
          </div>
        </div>

        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 11, color: t.textFaint, letterSpacing: 1, textTransform: "uppercase", marginBottom: 10 }}>
            Example workloads
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            {samples.map((item) => (
              <button
                key={item.key}
                onClick={() => setPrompt(item.prompt)}
                style={{
                  textAlign: "left",
                  padding: 14,
                  background: t.panel,
                  border: `1px solid ${prompt === item.prompt ? t.accent : t.border}`,
                  borderRadius: 12,
                  cursor: "pointer",
                  color: t.text,
                  fontFamily: "inherit",
                }}
              >
                <div style={{ fontSize: 12, color: t.accent, fontWeight: 700, marginBottom: 6 }}>{item.label}</div>
                <div style={{ fontSize: 12.5, color: t.textDim, lineHeight: 1.55 }}>{item.prompt}</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function CompilingView({ t }) {
  const [step, setStep] = usePhaseState(0);
  const steps = [
    "Drafting IntentContract",
    "Compiling ExecutionPlan",
    "Indexing ExecutionNodes and approval gates",
    "Rendering ProposedChange previews",
    "Binding freshness metadata",
    "Packaging ReviewArtifact",
  ];

  usePhaseEffect(() => {
    const timer = setInterval(() => setStep((value) => Math.min(value + 1, steps.length)), 180);
    return () => clearInterval(timer);
  }, []);

  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 32 }}>
      <Card t={t} style={{ maxWidth: 520, width: "100%" }}>
        <SectionTitle t={t} eyebrow="Compiling" title="Turning intent into a reviewable control surface" />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {steps.map((item, index) => {
            const complete = index < step;
            const active = index === step;
            return (
              <div
                key={item}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  fontSize: 13,
                  color: complete || active ? t.text : t.textFaint,
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 999,
                    border: `1.5px solid ${complete ? t.green : active ? t.accent : t.border}`,
                    background: complete ? t.green : "transparent",
                    display: "grid",
                    placeItems: "center",
                    color: "#fff",
                    fontSize: 10,
                  }}
                >
                  {complete ? "✓" : active ? <span style={{ width: 7, height: 7, borderRadius: 999, background: t.accent }} /> : ""}
                </span>
                {item}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function ReviewView({
  t,
  scenario,
  artifact,
  latestArtifact,
  layout,
  setLayout,
  selectedNode,
  selectedNodeRef,
  onSelectNode,
  focusChangeId,
  setFocusChangeId,
  approvals,
  onApprove,
  onBlock,
  onReqChanges,
  onIntervene,
  onExecute,
  runState,
  actionError,
  actionNotice,
  onReopenLatest,
  isFreshView,
  staleApprovalCount,
  approvalSummary,
  inspectorPayload,
  inspectorLoading,
  inspectorError,
  busyAction,
}) {
  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <IntentBar
        t={t}
        artifact={artifact}
        latestArtifact={latestArtifact}
        actionError={actionError}
        actionNotice={actionNotice}
        onReopenLatest={onReopenLatest}
        isFreshView={isFreshView}
      />

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "1.15fr 1fr 1.15fr", overflow: "hidden", background: t.bg, minHeight: 0 }}>
        <div style={{ borderRight: `1px solid ${t.border}`, display: "flex", flexDirection: "column", overflow: "hidden", background: t.panel }}>
          <GraphHeader t={t} artifact={artifact} layout={layout} setLayout={setLayout} />
          <div style={{ flex: 1, overflow: "hidden" }}>
            <Graph
              t={t}
              artifact={artifact}
              layout={layout}
              selectedNodeRef={selectedNodeRef}
              onSelect={onSelectNode}
              approvals={approvals}
            />
          </div>
        </div>

        <div style={{ borderRight: `1px solid ${t.border}`, overflow: "hidden", background: t.panel }}>
          <Inspector
            t={t}
            artifact={artifact}
            node={selectedNode}
            approvals={approvals}
            payload={inspectorPayload}
            isLoading={inspectorLoading}
            loadError={inspectorError}
            onJumpToDiff={(changeId) => setFocusChangeId(changeId)}
            onIntervene={onIntervene}
          />
        </div>

        <div style={{ overflow: "hidden", background: t.bg }}>
          <DiffPanel
            t={t}
            artifact={artifact}
            focusId={focusChangeId}
            onFocusDiff={(kind, id) => {
              if (kind === "node") onSelectNode(id);
              if (kind === "change") setFocusChangeId(id);
            }}
            approvals={approvals}
            onApprove={onApprove}
            onBlock={onBlock}
            onRequireChanges={onReqChanges}
            runState={runState}
            isFreshView={isFreshView}
          />
        </div>
      </div>

      <ActionBar
        t={t}
        artifact={artifact}
        latestArtifact={latestArtifact}
        approvalSummary={approvalSummary}
        staleApprovalCount={staleApprovalCount}
        isFreshView={isFreshView}
        onExecute={onExecute}
        onReopenLatest={onReopenLatest}
        executeDisabled={busyAction != null}
      />
    </div>
  );
}

function IntentBar({ t, artifact, latestArtifact, actionError, actionNotice, onReopenLatest, isFreshView }) {
  const intent = getIntent(artifact);
  const statusRisk = freshnessTone(artifact?.freshnessState);

  return (
    <div style={{ borderBottom: `1px solid ${t.border}`, background: t.panel }}>
      <div style={{ padding: "14px 20px 12px", display: "flex", alignItems: "flex-start", gap: 16 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
            <Pill t={t} risk={statusRisk} strong>
              {reviewStatusLabel(intent?.status)}
            </Pill>
            <Pill t={t}>plan v{artifact?.planVersion}</Pill>
            <Pill t={t}>graph v{artifact?.graphVersion}</Pill>
            <Pill t={t} risk={freshnessTone(artifact?.freshnessState)}>
              {formatFreshnessState(artifact?.freshnessState)}
            </Pill>
            <span style={{ fontSize: 11, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>
              hash:{shortHash(artifact?.artifactHash)}
            </span>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: t.text, letterSpacing: -0.3, marginBottom: 8 }}>
            {intent?.primaryDirective}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 18 }}>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: t.textFaint, marginBottom: 6 }}>
                Strict boundaries
              </div>
              {(intent?.strictBoundaries || []).map((boundary, index) => (
                <div key={index} style={{ fontSize: 12.5, color: t.textDim, display: "flex", gap: 8, lineHeight: 1.5 }}>
                  <span style={{ color: t.red }}>×</span>
                  <span>{boundary}</span>
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: t.textFaint, marginBottom: 6 }}>
                Success state
              </div>
              <div style={{ fontSize: 12.5, color: t.textDim, lineHeight: 1.55 }}>{intent?.successState}</div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <Btn t={t} variant="ghost" icon={<Icon.Edit />} disabled>
            Edit
          </Btn>
          <Btn t={t} variant="ghost" icon={<Icon.Check />} disabled={!isFreshView}>
            Approve
          </Btn>
          <Btn t={t} variant="ghost" icon={<Icon.X />} disabled={!isFreshView}>
            Reject
          </Btn>
          <Btn t={t} variant="ghost" icon={<Icon.History />}>
            View history
          </Btn>
        </div>
      </div>

      {(actionNotice || actionError || !isFreshView) && (
        <div style={{ padding: "0 20px 14px" }}>
          {actionNotice && (
            <div style={{ marginBottom: actionError ? 8 : 0, padding: "10px 12px", borderRadius: 10, background: t.infoSoft, color: t.info, border: `1px solid ${t.info}33`, fontSize: 12.5 }}>
              {actionNotice}
            </div>
          )}
          {(actionError || !isFreshView) && (
            <div style={{ padding: "10px 12px", borderRadius: 10, background: t.redSoft, color: t.text, border: `1px solid ${t.red}33`, display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ color: t.red }}>
                <Icon.Alert />
              </div>
              <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.5 }}>
                {actionError || `This view is stale. The backend has a newer artifact (${shortHash(latestArtifact?.artifactHash)}).`}
              </div>
              <Btn t={t} variant="ghost" onClick={onReopenLatest} icon={<Icon.Refresh />}>
                Re-open latest
              </Btn>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function GraphHeader({ t, artifact, layout, setLayout }) {
  const plan = getPlan(artifact);
  const nodes = getNodes(artifact);
  const edges = getEdges(artifact);
  const riskCounts = nodes.reduce((counts, node) => {
    const risk = resolveRiskFromNode(node);
    counts[risk] = (counts[risk] || 0) + 1;
    return counts;
  }, {});

  return (
    <div style={{ padding: "12px 14px", borderBottom: `1px solid ${t.border}`, background: t.panel, display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Execution graph</div>
        <div style={{ fontSize: 11, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>
          {nodes.length} nodes · {edges.length} edges · {plan?.runtimeKind}
        </div>
      </div>
      <div style={{ flex: 1 }} />
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {["green", "yellow", "orange", "red"].map((risk) => (
          <span key={risk} style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11, color: t.textFaint }}>
            <RiskDot t={t} risk={risk} size={7} />
            {riskCounts[risk] || 0}
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 2, background: t.panelAlt, borderRadius: 7, padding: 2, border: `1px solid ${t.border}` }}>
        {["vertical", "horizontal", "radial"].map((key) => (
          <button
            key={key}
            onClick={() => setLayout(key)}
            style={{
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 5,
              background: layout === key ? t.panel : "transparent",
              color: layout === key ? t.text : t.textDim,
              border: "none",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  );
}

function ActionBar({ t, artifact, latestArtifact, approvalSummary, staleApprovalCount, isFreshView, onExecute, onReopenLatest, executeDisabled }) {
  const changes = getProposedChanges(artifact);
  const blockedActions = changes.filter((change) => (change.policyState || change.policy) === "block").length;
  const pendingApprovals = approvalSummary.approvableCount - approvalSummary.approvedCount;

  return (
    <div style={{ height: 58, flexShrink: 0, borderTop: `1px solid ${t.border}`, background: t.panel, display: "flex", alignItems: "center", padding: "0 20px", gap: 12 }}>
      <Pill t={t}>{getNodes(artifact).length} nodes</Pill>
      <Pill t={t}>{pendingApprovals} pending approvals</Pill>
      {blockedActions > 0 && (
        <Pill t={t} risk="red">
          {blockedActions} blocked actions
        </Pill>
      )}
      {staleApprovalCount > 0 && (
        <Pill t={t} risk="orange">
          {staleApprovalCount} stale approvals
        </Pill>
      )}
      <div style={{ flex: 1 }} />
      {!isFreshView && (
        <Btn t={t} variant="ghost" icon={<Icon.Refresh />} onClick={onReopenLatest}>
          Re-open artifact v{latestArtifact?.planVersion}
        </Btn>
      )}
      <Btn t={t} variant="ghost" disabled>
        Approve all
      </Btn>
      <Btn t={t} variant="ghost" disabled>
        Approve selected nodes
      </Btn>
      <Btn t={t} variant="ghost" disabled>
        Reject plan
      </Btn>
      <Btn t={t} variant="ghost" disabled>
        Run simulation
      </Btn>
      <Btn
        t={t}
        variant="approve"
        icon={<Icon.Play />}
        disabled={executeDisabled || !isFreshView || !approvalSummary.allApproved}
        onClick={onExecute}
      >
        Execute
      </Btn>
    </div>
  );
}

function RunningView({ t, artifact, progress, approvals }) {
  const approvedChanges = getProposedChanges(artifact).filter((change) => approvalEntryIsFresh(approvals[change.id], artifact));

  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 32 }}>
      <Card t={t} style={{ maxWidth: 560, width: "100%" }}>
        <SectionTitle t={t} eyebrow="Executing" title="Applying approved changes against the latest artifact" meta={`artifact ${shortHash(artifact?.artifactHash)}`} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {approvedChanges.map((change, index) => {
            const KindIcon = KIND_ICON[change.kind] || Icon.File;
            const done = index < progress;
            const active = index === progress;
            return (
              <div
                key={change.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 10,
                  background: done ? t.greenSoft : active ? t.accentSoft : t.panelAlt,
                  border: `1px solid ${done ? `${t.green}44` : active ? `${t.accent}55` : t.border}`,
                }}
              >
                <div style={{ color: done ? t.green : active ? t.accent : t.textFaint }}>
                  {done ? <Icon.Check /> : <KindIcon />}
                </div>
                <div style={{ flex: 1, fontSize: 13, color: t.text }}>{change.target}</div>
                <div style={{ fontSize: 11, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                  {done ? "done" : active ? "running" : "queued"}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function DoneView({ t, scenario, artifact, approvals, onNewRun }) {
  const approvedChanges = getProposedChanges(artifact).filter((change) => approvalEntryIsFresh(approvals[change.id], artifact));
  const heldChanges = getProposedChanges(artifact).filter((change) => !approvalEntryIsFresh(approvals[change.id], artifact) || (change.policyState || change.policy) === "block");

  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 32, overflow: "auto" }}>
      <div style={{ maxWidth: 620, width: "100%" }}>
        <Card t={t} style={{ marginBottom: 18 }}>
          <SectionTitle t={t} eyebrow="Audit recorded" title="Run complete" meta={artifact?.artifactId} />
          <div style={{ fontSize: 13, color: t.textDim, lineHeight: 1.55 }}>
            The control plane recorded the approved artifact snapshot, freshness metadata, and the changes that became real for <strong>{scenario.label}</strong>.
          </div>
        </Card>

        <Card t={t} pad={0}>
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${t.border}`, fontSize: 12, fontWeight: 700, color: t.text }}>
            Applied changes
          </div>
          {approvedChanges.map((change) => (
            <div key={change.id} style={{ padding: "10px 14px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ color: t.green }}>
                <Icon.Check />
              </div>
              <div style={{ flex: 1, color: t.text }}>{change.target}</div>
              <div style={{ fontSize: 11, color: t.textFaint }}>{change.operation}</div>
            </div>
          ))}
          {heldChanges.length > 0 && (
            <>
              <div style={{ padding: "12px 14px", borderBottom: `1px solid ${t.border}`, fontSize: 12, fontWeight: 700, color: t.text, background: t.panelAlt }}>
                Held back
              </div>
              {heldChanges.map((change) => (
                <div key={change.id} style={{ padding: "10px 14px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 10, opacity: 0.75 }}>
                  <div style={{ color: t.red }}>
                    <Icon.Block />
                  </div>
                  <div style={{ flex: 1, color: t.text }}>{change.target}</div>
                  <div style={{ fontSize: 11, color: t.textFaint }}>
                    {(change.policyState || change.policy) === "block" ? "policy" : "not approved"}
                  </div>
                </div>
              ))}
            </>
          )}
        </Card>

        <div style={{ marginTop: 18, display: "flex", gap: 10 }}>
          <Btn t={t} variant="primary" icon={<Icon.Spark />} onClick={onNewRun}>
            New run
          </Btn>
          <Btn t={t} variant="ghost" icon={<Icon.History />}>
            View audit trail
          </Btn>
        </div>
      </div>
    </div>
  );
}

Object.assign(window, { PromptView, CompilingView, ReviewView, RunningView, DoneView, IntentBar, GraphHeader, ActionBar });
