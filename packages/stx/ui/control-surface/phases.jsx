const { useState: usePhaseState, useEffect: usePhaseEffect } = React;

function PromptView({ t, prompt, setPrompt, onCompile, isBusy }) {
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
          This is not a shell. Describe the outcome. Semantix will freeze the intent contract, compile a review artifact, surface exact issues like missing symbols or invalid paths, and wait for approval before anything becomes real.
        </p>

        <div style={{ background: t.panel, border: `1px solid ${t.border}`, borderRadius: 14, boxShadow: t.shadowLg, overflow: "hidden" }}>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe the outcome to compile for review."
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

function ReviewModeSwitch({ t, reviewMode, setReviewMode }) {
  return (
    <div style={{ display: "flex", gap: 2, background: t.panelAlt, borderRadius: 8, padding: 2, border: `1px solid ${t.border}` }}>
      {["simple", "advanced"].map((mode) => (
        <button
          key={mode}
          onClick={() => setReviewMode(mode)}
          style={{
            fontSize: 11.5,
            padding: "5px 10px",
            borderRadius: 6,
            border: "none",
            cursor: "pointer",
            fontWeight: 600,
            textTransform: "capitalize",
            background: reviewMode === mode ? t.panel : "transparent",
            color: reviewMode === mode ? t.text : t.textDim,
          }}
        >
          {mode} view
        </button>
      ))}
    </div>
  );
}

function SimpleMetaList({ t, items, tone = "muted" }) {
  if (!items?.length) return null;
  const color = tone === "accent" ? t.accent : tone === "warn" ? t.orange : t.textDim;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item, index) => (
        <div key={`${index}:${item}`} style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.45 }}>
          <span style={{ color }}>•</span>
          <span style={{ color: t.text }}>{item}</span>
        </div>
      ))}
    </div>
  );
}

function SimpleDecisionButton({ t, label, active, tone, onClick, disabled }) {
  const tokens = tone === "approve"
    ? { fg: "#fff", bg: t.green, border: t.green, offFg: t.textDim }
    : { fg: "#fff", bg: t.red, border: t.red, offFg: t.textDim };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        fontSize: 12,
        padding: "6px 12px",
        borderRadius: 6,
        background: active ? tokens.bg : "transparent",
        color: active ? tokens.fg : disabled ? t.textFaint : tokens.offFg,
        border: `1px solid ${active ? tokens.border : t.border}`,
        cursor: disabled ? "not-allowed" : "pointer",
        fontWeight: 600,
      }}
    >
      {label}
    </button>
  );
}

function ExecutionStateCard({ t, artifact, eyebrow = "Execution data", title, body }) {
  const summary = summarizeExecutionState(artifact);
  const resolvedTitle = title || summary.title;
  const resolvedBody = body || summary.body;

  return (
    <Card t={t} style={{ borderStyle: "dashed" }}>
      <SectionTitle t={t} eyebrow={eyebrow} title={resolvedTitle} />
      <div style={{ fontSize: 12.5, color: t.textDim, lineHeight: 1.55, marginBottom: summary.items.length > 0 ? 12 : 0 }}>
        {resolvedBody}
      </div>
      {summary.items.length > 0 ? <SimpleMetaList t={t} items={summary.items} /> : null}
    </Card>
  );
}

function SimplePlanDrawer({ t, artifact, selectedNodeRef, onSelectNode, onClose }) {
  const nodes = getNodes(artifact);
  const activeNodeId = selectedNodeRef?.split(":")[0] || null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        background: t.panel,
        borderLeft: `1px solid ${t.border}`,
        boxShadow: "-10px 0 32px rgba(0,0,0,.08)",
        display: "flex",
        flexDirection: "column",
        zIndex: 5,
      }}
    >
      <div style={{ flexShrink: 0, padding: "18px 20px 14px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Execution plan</div>
          <div style={{ fontSize: 11.5, color: t.textFaint }}>
            {nodes.length} steps compiled from this intent
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button
          onClick={onClose}
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            border: `1px solid ${t.border}`,
            background: t.panel,
            color: t.textDim,
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
        >
          <Icon.X />
        </button>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "14px 20px" }}>
        {nodes.map((node, index) => {
          const risk = resolveRiskFromNode(node);
          return (
            <button
              key={node.id}
              onClick={() => onSelectNode(node.id)}
              style={{
                width: "100%",
                display: "flex",
                gap: 10,
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: "0 0 14px",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                <div style={{ width: 9, height: 9, borderRadius: 999, background: RISK_TOKEN(t, risk).fg, marginTop: 5 }} />
                {index < nodes.length - 1 ? <div style={{ width: 1, flex: 1, background: t.border, marginTop: 3, minHeight: 14 }} /> : null}
              </div>
              <div style={{ flex: 1, minWidth: 0, paddingBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text }}>{node.title}</div>
                  {activeNodeId === node.id ? <Pill t={t} risk="info">active</Pill> : null}
                </div>
                <div style={{ fontSize: 11.5, color: t.textDim, lineHeight: 1.45 }}>
                  {node.inputSummary || node.outputSummary || node.grounding || node.nodeType}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SimpleChangeCard({
  t,
  artifact,
  change,
  node,
  verdict,
  expanded,
  onToggle,
  onApprove,
  onBlock,
  onRequireChanges,
  isFreshView,
}) {
  const [showDetails, setShowDetails] = usePhaseState(false);
  const policyState = change.policyState || change.policy;
  const blockedByPolicy = policyState === "block";
  const blockedByIssue = !blockedByPolicy && Boolean(change.hasBlockingIssue);
  const issues = collectReviewIssues(change, node, [change]);
  const primaryIssue = issues[0] || null;
  const hasProblem = blockedByPolicy || blockedByIssue || issues.length > 0 || Boolean(change.issueSummary);
  const affectedScope = deriveAffectedScope(node, change, [change]);
  const targetLabel = getChangeTargetLabel(change);
  const effectRows = getChangeEffectRows(change);
  const evidenceItems = issues.flatMap((issue) => (issue.evidence || []).map((entry) =>
    [entry.summary, entry.detail, entry.source, entry.locator].filter(Boolean).join(" · "),
  ));
  const suggestionItems = issues.flatMap((issue) => (issue.interventions || []).map((entry) =>
    entry.detail ? `${entry.label} · ${entry.detail}` : entry.label,
  ));
  const constraints = node?.constraints?.hard || [];

  const verdictTone = verdict === "approve" ? "green" : verdict === "block" ? "red" : hasProblem ? "orange" : "info";
  const borderColor = blockedByPolicy || blockedByIssue
    ? `${t.red}66`
    : verdict === "approve"
      ? `${t.green}55`
      : verdict === "block"
        ? `${t.red}55`
        : expanded
          ? `${t.accent}55`
          : t.border;

  return (
    <div
      style={{
        background: t.panel,
        border: `1px solid ${borderColor}`,
        borderLeft: `3px solid ${
          blockedByPolicy ? t.red : blockedByIssue ? t.orange : verdict === "approve" ? t.green : verdict === "block" ? t.red : hasProblem ? t.orange : t.border
        }`,
        borderRadius: 10,
        marginBottom: 12,
        overflow: "hidden",
      }}
    >
      <div
        onClick={onToggle}
        style={{ padding: "12px 14px 12px 16px", display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            background: t.panelAlt,
            display: "grid",
            placeItems: "center",
            color: t.textDim,
            flexShrink: 0,
          }}
        >
          {(KIND_ICON[change.kind] || Icon.File)()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 2 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: t.textFaint, textTransform: "uppercase", letterSpacing: 0.5 }}>
              {change.operation}
            </span>
            {hasProblem && !blockedByPolicy ? <Pill t={t} risk="orange">needs a closer look</Pill> : null}
            {blockedByPolicy ? <Pill t={t} risk="red">blocked by policy</Pill> : null}
            {blockedByIssue ? <Pill t={t} risk="red">issue flagged</Pill> : null}
            <Pill t={t} risk={verdictTone}>{verdict === "approve" ? "approved" : verdict === "block" ? "blocked" : "pending"}</Pill>
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {targetLabel}
          </div>
          <div style={{ fontSize: 12.5, color: t.textDim, marginTop: 3, lineHeight: 1.45 }}>
            {change.summary}
          </div>
        </div>

        <div onClick={(event) => event.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {blockedByPolicy ? (
            <span style={{ fontSize: 12, color: t.red, fontWeight: 600, padding: "6px 8px" }}>
              will not run
            </span>
          ) : blockedByIssue ? (
            <>
              <Btn t={t} variant="ghost" onClick={() => onRequireChanges(change.id)} disabled={!isFreshView} icon={<Icon.Edit />}>
                Intervene
              </Btn>
              <SimpleDecisionButton t={t} label="Block" tone="block" active={verdict === "block"} onClick={() => onBlock(change.id)} disabled={!isFreshView} />
            </>
          ) : (
            <>
              <SimpleDecisionButton t={t} label="Block" tone="block" active={verdict === "block"} onClick={() => onBlock(change.id)} disabled={!isFreshView} />
              <SimpleDecisionButton t={t} label="Approve" tone="approve" active={verdict === "approve"} onClick={() => onApprove(change.id)} disabled={!isFreshView} />
            </>
          )}
          <Icon.Chevron style={{ transform: expanded ? "rotate(90deg)" : "none", transition: "transform 160ms", color: t.textFaint }} />
        </div>
      </div>

      {expanded ? (
        <div style={{ borderTop: `1px solid ${t.border}`, background: t.panelAlt }}>
          {hasProblem ? (
            <div
              style={{
                padding: "12px 16px",
                borderBottom: `1px solid ${t.border}`,
                background: blockedByPolicy ? t.redSoft : t.orangeSoft,
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
              }}
            >
              <div style={{ color: blockedByPolicy ? t.red : t.orange, marginTop: 2, flexShrink: 0 }}>
                <Icon.Alert />
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: t.text, flex: 1 }}>
                <div style={{ fontWeight: 700, marginBottom: 3 }}>
                  {blockedByPolicy ? "Why this is blocked" : blockedByIssue ? "Why this needs intervention" : "Why this needs a closer look"}
                </div>
                <div style={{ color: t.textDim }}>
                  {primaryIssue?.summary || primaryIssue?.title || change.issueSummary || change.summary}
                </div>
                {suggestionItems[0] ? (
                  <div style={{ marginTop: 6, fontSize: 12, color: t.textDim }}>
                    <span style={{ color: t.accent, fontWeight: 700 }}>→ </span>
                    {suggestionItems[0]}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div style={{ background: t.panel, borderBottom: `1px solid ${t.border}`, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 11.5, lineHeight: 1.55, overflowX: "auto" }}>
            <pre style={{ margin: 0, padding: "14px 16px", color: t.text, whiteSpace: "pre" }}>{change.preview || change.diff || change.diffPreview || change.summary}</pre>
          </div>

          <div style={{ borderTop: `1px solid ${t.border}`, background: t.panel }}>
            <button
              onClick={() => setShowDetails((value) => !value)}
              style={{
                width: "100%",
                textAlign: "left",
                border: "none",
                cursor: "pointer",
                background: "transparent",
                padding: "10px 16px",
                color: t.textDim,
                fontSize: 12,
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <Icon.Chevron style={{ transform: showDetails ? "rotate(90deg)" : "none", transition: "transform 160ms", color: t.textFaint }} />
              <span>{showDetails ? "Hide details" : "Show details"}</span>
              <span style={{ color: t.textFaint, fontSize: 11 }}>
                · evidence, scope, constraints
              </span>
            </button>
            {showDetails ? (
              <div style={{ borderTop: `1px solid ${t.border}` }}>
                <div style={{ padding: "10px 16px", borderTop: `1px solid ${t.border}`, fontSize: 12, color: t.textDim }}>
                  <strong style={{ color: t.text }}>Node</strong>
                  <span style={{ marginLeft: 8 }}>{node?.title || change.nodeId || change.node}</span>
                </div>
                {affectedScope.length > 0 ? (
                  <div style={{ padding: "10px 16px", borderTop: `1px solid ${t.border}` }}>
                    <div style={{ fontSize: 10.5, color: t.textFaint, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>
                      Scope
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {affectedScope.map((item) => (
                        <span key={item.key || item.label} style={{ display: "inline-block", fontSize: 11, padding: "2px 7px", borderRadius: 4, background: t.panelAlt, color: t.textDim }}>
                          {item.label}
                          {item.detail ? ` · ${item.detail}` : ""}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {effectRows.length > 0 ? (
                  <div style={{ padding: "10px 16px", borderTop: `1px solid ${t.border}` }}>
                    <div style={{ fontSize: 10.5, color: t.textFaint, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>
                      File operations
                    </div>
                    <SimpleMetaList t={t} items={effectRows} tone="accent" />
                  </div>
                ) : null}
                {constraints.length > 0 ? (
                  <div style={{ padding: "10px 16px", borderTop: `1px solid ${t.border}` }}>
                    <div style={{ fontSize: 10.5, color: t.textFaint, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>
                      Constraints
                    </div>
                    <SimpleMetaList t={t} items={constraints} tone="accent" />
                  </div>
                ) : null}
                {evidenceItems.length > 0 ? (
                  <div style={{ padding: "10px 16px", borderTop: `1px solid ${t.border}` }}>
                    <div style={{ fontSize: 10.5, color: t.textFaint, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>
                      Evidence
                    </div>
                    <SimpleMetaList t={t} items={evidenceItems} tone="warn" />
                  </div>
                ) : null}
                {suggestionItems.length > 0 ? (
                  <div style={{ padding: "10px 16px", borderTop: `1px solid ${t.border}` }}>
                    <div style={{ fontSize: 10.5, color: t.textFaint, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>
                      Suggested actions
                    </div>
                    <SimpleMetaList t={t} items={suggestionItems} tone="accent" />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SimpleReviewSurface({
  t,
  artifact,
  selectedNodeRef,
  onSelectNode,
  focusChangeId,
  setFocusChangeId,
  approvals,
  onApprove,
  onBlock,
  onReqChanges,
  isFreshView,
}) {
  const [expandedId, setExpandedId] = usePhaseState(null);
  const [showPlan, setShowPlan] = usePhaseState(false);
  const changes = getDisplayableProposedChanges(artifact);
  const advisoryChanges = getAdvisoryProposedChanges(artifact);
  const executionSummary = summarizeExecutionState(artifact);
  const affectedFileCount = countAffectedFiles(changes);

  usePhaseEffect(() => {
    if (focusChangeId) {
      setExpandedId(focusChangeId);
      return;
    }
    const firstAttention = changes.find((change) =>
      change.hasBlockingIssue
      || (change.policyState || change.policy) !== "pass"
      || change.issues?.length > 0,
    ) || changes[0] || null;
    setExpandedId(firstAttention?.id || null);
  }, [artifact?.artifactHash, artifact?.planVersion, artifact?.graphVersion, focusChangeId, changes.length]);

  const approvedCount = changes.filter((change) => {
    const entry = approvals[change.id];
    return approvalEntryIsFresh(entry, artifact) && entry?.decision === "approve";
  }).length;
  const blockedByPolicy = changes.filter((change) => (change.policyState || change.policy) === "block").length;
  const blockedByIssue = changes.filter((change) => change.hasBlockingIssue && (change.policyState || change.policy) !== "block").length;
  const pendingDecisions = changes.filter((change) => {
    if ((change.policyState || change.policy) === "block" || change.hasBlockingIssue) {
      return false;
    }
    const entry = approvals[change.id];
    return !(approvalEntryIsFresh(entry, artifact) && (entry?.decision === "approve" || entry?.decision === "block" || entry?.decision === "changes"));
  }).length;

  return (
    <div style={{ flex: 1, position: "relative", background: t.bg, minHeight: 0 }}>
      <div style={{ height: "100%", overflow: "auto", padding: "18px 24px 24px" }}>
        <div
          style={{
            marginBottom: 18,
            padding: "12px 16px",
            background: t.panelAlt,
            borderRadius: 10,
            border: `1px solid ${t.border}`,
            display: "flex",
            alignItems: "center",
            gap: 18,
            fontSize: 12.5,
            flexWrap: "wrap",
          }}
        >
          <Pill t={t} risk={pendingDecisions > 0 ? "orange" : "green"}>{pendingDecisions} pending</Pill>
          <Pill t={t} risk="green">{approvedCount} approved</Pill>
          {affectedFileCount > 0 ? <Pill t={t} risk="info">{affectedFileCount} affected file{affectedFileCount === 1 ? "" : "s"}</Pill> : null}
          {blockedByPolicy > 0 ? <Pill t={t} risk="red">{blockedByPolicy} blocked by policy</Pill> : null}
          {blockedByIssue > 0 ? <Pill t={t} risk="red">{blockedByIssue} need intervention</Pill> : null}
          {advisoryChanges.length > 0 ? <Pill t={t} risk="orange">{advisoryChanges.length} advisory preview{advisoryChanges.length === 1 ? "" : "s"} hidden</Pill> : null}
          <div style={{ flex: 1 }} />
          <Btn t={t} variant="ghost" onClick={() => setShowPlan((value) => !value)}>
            {showPlan ? "Hide plan" : "See plan"}
          </Btn>
        </div>

        {changes.length === 0 ? (
          <ExecutionStateCard
            t={t}
            artifact={artifact}
            eyebrow="Awaiting code changes"
            title={executionSummary.title}
            body={executionSummary.body}
          />
        ) : changes.map((change) => {
          const nodeId = getChangeNodeId(artifact, change);
          const node = getNodeById(artifact, nodeId);
          const entry = approvals[change.id];
          const verdict = approvalEntryIsFresh(entry, artifact, node?.revision) ? entry?.decision : null;

          return (
            <SimpleChangeCard
              key={change.id}
              t={t}
              artifact={artifact}
              change={change}
              node={node}
              verdict={verdict}
              expanded={expandedId === change.id}
              onToggle={() => {
                const nextExpanded = expandedId === change.id ? null : change.id;
                setExpandedId(nextExpanded);
                setFocusChangeId(nextExpanded);
                if (nodeId) onSelectNode(nodeId);
              }}
              onApprove={onApprove}
              onBlock={onBlock}
              onRequireChanges={onReqChanges}
              isFreshView={isFreshView}
            />
          );
        })}
      </div>

      {showPlan ? (
        <SimplePlanDrawer
          t={t}
          artifact={artifact}
          selectedNodeRef={selectedNodeRef}
          onSelectNode={(nodeId) => {
            onSelectNode(nodeId);
            const firstChange = findFirstChangeForNode(artifact, nodeId);
            if (firstChange) {
              setExpandedId(firstChange.id);
              setFocusChangeId(firstChange.id);
            }
          }}
          onClose={() => setShowPlan(false)}
        />
      ) : null}
    </div>
  );
}

function ReviewView({
  t,
  scenario,
  artifact,
  latestArtifact,
  reviewMode,
  setReviewMode,
  layout,
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
        reviewMode={reviewMode}
        setReviewMode={setReviewMode}
        actionError={actionError}
        actionNotice={actionNotice}
        onReopenLatest={onReopenLatest}
        isFreshView={isFreshView}
      />

      {reviewMode === "simple" ? (
        <SimpleReviewSurface
          t={t}
          artifact={artifact}
          selectedNodeRef={selectedNodeRef}
          onSelectNode={onSelectNode}
          focusChangeId={focusChangeId}
          setFocusChangeId={setFocusChangeId}
          approvals={approvals}
          onApprove={onApprove}
          onBlock={onBlock}
          onReqChanges={onReqChanges}
          isFreshView={isFreshView}
        />
      ) : (
        <div style={{ flex: 1, display: "grid", gridTemplateColumns: "0.84fr 1.08fr 1.28fr", overflow: "hidden", background: t.bg, minHeight: 0 }}>
          <div style={{ borderRight: `1px solid ${t.border}`, display: "flex", flexDirection: "column", overflow: "hidden", background: t.panel }}>
            <GraphHeader t={t} artifact={artifact} />
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
              selectedNode={selectedNode}
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
      )}

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

function IntentBar({
  t,
  artifact,
  latestArtifact,
  reviewMode,
  setReviewMode,
  actionError,
  actionNotice,
  onReopenLatest,
  isFreshView,
}) {
  const intent = getIntent(artifact);
  const statusRisk = freshnessTone(artifact?.freshnessState);
  const nodes = getNodes(artifact);
  const changes = getDisplayableProposedChanges(artifact);
  const advisoryChanges = getAdvisoryProposedChanges(artifact);
  const affectedFileCount = countAffectedFiles(changes);
  const gates = artifact?.plan?.approvalGates || [];
  const runtimeKind = artifact?.plan?.runtimeKind || artifact?.plan?.runtimeAuthority || "deterministic";

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
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
            <Pill t={t} risk="info">{runtimeKind}</Pill>
            <Pill t={t}>{nodes.length} nodes</Pill>
            <Pill t={t}>{changes.length} admitted code change{changes.length === 1 ? "" : "s"}</Pill>
            {affectedFileCount > 0 ? <Pill t={t} risk="info">{affectedFileCount} file{affectedFileCount === 1 ? "" : "s"}</Pill> : null}
            {advisoryChanges.length > 0 ? <Pill t={t} risk="orange">{advisoryChanges.length} advisory preview{advisoryChanges.length === 1 ? "" : "s"} hidden</Pill> : null}
            <Pill t={t} risk={gates.some((gate) => gate.status === "approved") ? "green" : "orange"}>
              {gates.length} approval gate{gates.length === 1 ? "" : "s"}
            </Pill>
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

        <div style={{ width: 280, flexShrink: 0 }}>
          <div style={{ borderRadius: 12, border: `1px solid ${t.border}`, background: t.panelAlt, padding: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: t.textFaint, marginBottom: 8 }}>
              Control room status
            </div>
            <div style={{ marginBottom: 10 }}>
              <ReviewModeSwitch t={t} reviewMode={reviewMode} setReviewMode={setReviewMode} />
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 6 }}>
              {reviewMode === "simple" ? "Decision mode is active" : isFreshView ? "Rendering backend truth" : "Viewing an older artifact"}
            </div>
            <div style={{ fontSize: 12, color: t.textDim, lineHeight: 1.5, marginBottom: 10 }}>
              {reviewMode === "simple"
                ? "Simple is the default review surface. Escalate to advanced when the plan or node-level detail needs scrutiny."
                : "Approvals and execution remain bound to artifact freshness, plan version, graph version, and node revision."}
            </div>
            {!isFreshView ? (
              <Btn t={t} variant="ghost" onClick={onReopenLatest} icon={<Icon.Refresh />}>
                Re-open latest artifact
              </Btn>
            ) : (
              <Pill t={t} risk="green">fresh authority</Pill>
            )}
          </div>
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

function GraphHeader({ t, artifact }) {
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
          {nodes.length} nodes · {edges.length} edges · {plan?.runtimeKind} · vertical layout
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
    </div>
  );
}

function ActionBar({ t, artifact, latestArtifact, approvalSummary, staleApprovalCount, isFreshView, onExecute, onReopenLatest, executeDisabled }) {
  const changes = getDisplayableProposedChanges(artifact);
  const advisoryChanges = getAdvisoryProposedChanges(artifact);
  const executionSummary = summarizeExecutionState(artifact);
  const blockedActions = changes.filter((change) => (change.policyState || change.policy) === "block").length;
  const blockingIssues = getBlockingIssues(artifact).length;
  const pendingApprovals = approvalSummary.approvableCount - approvalSummary.approvedCount;
  const hasBlockedNodes = getNodes(artifact).some((node) => node.reviewStatus === "blocked");
  const executionHeld = blockedActions > 0 || blockingIssues > 0 || hasBlockedNodes;
  const awaitingAdmittedChanges = changes.length === 0;
  const executionReady = isFreshView && changes.length > 0 && approvalSummary.allApproved && !executionHeld;
  const statusTone = !isFreshView || staleApprovalCount > 0
    ? "orange"
    : awaitingAdmittedChanges
      ? "info"
      : executionHeld
        ? "red"
        : executionReady
          ? "green"
          : "yellow";
  const statusTitle = !isFreshView
    ? "Review surface is stale"
    : awaitingAdmittedChanges
      ? executionSummary.title
    : executionHeld
      ? "Execution is held by flagged issues"
      : executionReady
        ? "Execution can continue"
        : "Waiting on reviewer decisions";
  const statusBody = !isFreshView
    ? `A newer artifact is available at plan v${latestArtifact?.planVersion}. Re-open backend truth before continuing.`
    : awaitingAdmittedChanges
      ? executionSummary.body
    : executionHeld
      ? `${blockedActions} blocked action${blockedActions === 1 ? "" : "s"}, ${blockingIssues} blocking issue record${blockingIssues === 1 ? "" : "s"}, and node review state are holding execution.`
      : executionReady
        ? "Every approvable action on this artifact has a fresh approval and no blocking issue remains."
        : `${pendingApprovals} approval${pendingApprovals === 1 ? "" : "s"} still need a decision before execution can continue.`;

  return (
    <div style={{ flexShrink: 0, borderTop: `1px solid ${t.border}`, background: t.panel, padding: "12px 20px", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
          <Pill t={t} risk={statusTone} strong>{statusTitle}</Pill>
          {!awaitingAdmittedChanges ? <Pill t={t}>{pendingApprovals} pending approvals</Pill> : null}
          {blockedActions > 0 ? <Pill t={t} risk="red">{blockedActions} blocked actions</Pill> : null}
          {blockingIssues > 0 ? <Pill t={t} risk="red">{blockingIssues} blocking issues</Pill> : null}
          {advisoryChanges.length > 0 ? <Pill t={t} risk="orange">{advisoryChanges.length} advisory preview{advisoryChanges.length === 1 ? "" : "s"} hidden</Pill> : null}
          {staleApprovalCount > 0 ? <Pill t={t} risk="orange">{staleApprovalCount} stale approvals</Pill> : null}
        </div>
        <div style={{ fontSize: 12.5, color: t.textDim, lineHeight: 1.45 }}>{statusBody}</div>
      </div>
      {!isFreshView ? (
        <Btn t={t} variant="ghost" icon={<Icon.Refresh />} onClick={onReopenLatest}>
          Re-open artifact v{latestArtifact?.planVersion}
        </Btn>
      ) : null}
      <Btn
        t={t}
        variant="approve"
        icon={<Icon.Play />}
        disabled={executeDisabled || !executionReady}
        title={executionHeld ? "Resolve blocking issues before execution can continue." : undefined}
        onClick={onExecute}
      >
        Continue to execution
      </Btn>
    </div>
  );
}

function RunningView({ t, artifact, progress, approvals }) {
  const approvedChanges = getDisplayableProposedChanges(artifact).filter((change) => approvalEntryIsFresh(approvals[change.id], artifact));

  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 32 }}>
      <Card t={t} style={{ maxWidth: 560, width: "100%" }}>
        <SectionTitle t={t} eyebrow="Executing" title="Applying approved changes against the latest artifact" meta={`artifact ${shortHash(artifact?.artifactHash)}`} />
        {approvedChanges.length > 0 ? (
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
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: t.text }}>{getChangeTargetLabel(change)}</div>
                    {change.summary ? <div style={{ fontSize: 11.5, color: t.textDim, marginTop: 2 }}>{change.summary}</div> : null}
                  </div>
                  <div style={{ fontSize: 11, color: t.textFaint, fontFamily: 'ui-monospace, Menlo, monospace' }}>
                    {done ? "applied" : active ? "applying" : "queued"}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <ExecutionStateCard
            t={t}
            artifact={artifact}
            eyebrow="Execution progress"
            title="Running without admitted change previews"
            body={summarizeExecutionState(artifact).body}
          />
        )}
      </Card>
    </div>
  );
}

function DoneView({ t, artifact, approvals, onNewRun }) {
  const approvedChanges = getDisplayableProposedChanges(artifact).filter((change) => approvalEntryIsFresh(approvals[change.id], artifact));
  const heldChanges = getDisplayableProposedChanges(artifact).filter((change) => !approvalEntryIsFresh(approvals[change.id], artifact) || (change.policyState || change.policy) === "block");
  const intent = getIntent(artifact);
  const runLabel = intent?.primaryDirective || artifact?.runId || "this run";

  return (
    <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 32, overflow: "auto" }}>
      <div style={{ maxWidth: 620, width: "100%" }}>
        <Card t={t} style={{ marginBottom: 18 }}>
          <SectionTitle t={t} eyebrow="Audit recorded" title="Run complete" meta={artifact?.artifactId} />
          <div style={{ fontSize: 13, color: t.textDim, lineHeight: 1.55 }}>
            The control plane recorded the approved artifact snapshot, freshness metadata, and the changes that became real for <strong>{runLabel}</strong>.
          </div>
        </Card>

        <Card t={t} pad={0}>
          <div style={{ padding: "12px 14px", borderBottom: `1px solid ${t.border}`, fontSize: 12, fontWeight: 700, color: t.text }}>
            Applied changes
          </div>
          {approvedChanges.length > 0 ? approvedChanges.map((change) => (
            <div key={change.id} style={{ padding: "10px 14px", borderBottom: `1px solid ${t.border}`, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ color: t.green }}>
                <Icon.Check />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ color: t.text }}>{getChangeTargetLabel(change)}</div>
                {change.summary ? <div style={{ fontSize: 11.5, color: t.textDim, marginTop: 2 }}>{change.summary}</div> : null}
              </div>
              <div style={{ fontSize: 11, color: t.textFaint }}>{change.operation}</div>
            </div>
          )) : (
            <div style={{ padding: "14px", borderBottom: `1px solid ${t.border}` }}>
              <ExecutionStateCard
                t={t}
                artifact={artifact}
                eyebrow="Execution result"
                title="No admitted code-change diff was recorded"
                body={summarizeExecutionState(artifact).body}
              />
            </div>
          )}
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
                  <div style={{ flex: 1, color: t.text }}>{getChangeTargetLabel(change)}</div>
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
