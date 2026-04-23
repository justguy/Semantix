const { useState: useDiffState, useEffect: useDiffEffect, useMemo: useDiffMemo } = React;

function PolicyPill({ t, policyState }) {
  if (policyState === "block") return <Pill t={t} risk="red" strong>policy block</Pill>;
  if (policyState === "review_required") return <Pill t={t} risk="orange">review required</Pill>;
  return <Pill t={t} risk="green">policy pass</Pill>;
}

function ReversibilityPill({ t, reversibility }) {
  if (reversibility?.status === "irreversible") return <Pill t={t} risk="red">irreversible</Pill>;
  if (reversibility?.status === "reversible_within_window") return <Pill t={t} risk="yellow">reversible in window</Pill>;
  return <Pill t={t} risk="green">reversible</Pill>;
}

function EnforcementPill({ t, enforcement }) {
  const risk = enforcement?.status === "block" ? "red" : enforcement?.status === "review_required" ? "orange" : "info";
  return <Pill t={t} risk={risk}>{`${enforcement?.owner || "control"} · ${enforcement?.status || "pass"}`}</Pill>;
}

function renderDiffLine(line, t, index) {
  const first = line[0];
  let color = t.text;
  let background = "transparent";
  let gutter = " ";
  let content = line;

  if (first === "+" && line[1] === "!") {
    color = t.text;
    background = t.orangeSoft;
    gutter = "+";
    content = ` ${line.slice(2)}`;
  } else if (first === "+") {
    color = t.green;
    background = t.greenSoft;
    gutter = "+";
    content = line.slice(1);
  } else if (first === "-") {
    color = t.red;
    background = t.redSoft;
    gutter = "−";
    content = line.slice(1);
  } else if (first === "!") {
    color = t.orange;
    background = t.orangeSoft;
    gutter = "!";
    content = line.slice(1);
  }

  return (
    <div key={`${index}:${content}`} style={{ display: "flex", gap: 10, padding: "0 10px", background, minHeight: 18 }}>
      <span style={{ width: 18, color: t.textFaint, fontSize: 11, textAlign: "right", userSelect: "none", flexShrink: 0 }}>{index + 1}</span>
      <span style={{ width: 12, color: t.textFaint, userSelect: "none", flexShrink: 0 }}>{gutter}</span>
      <span style={{ color, whiteSpace: "pre", fontSize: 12 }}>{content || " "}</span>
    </div>
  );
}

function issueTone(issue) {
  if (issue?.blocking) return "red";
  if (issue?.severity === "error" || issue?.severity === "critical" || issue?.severity === "block") return "red";
  if (issue?.severity === "warning" || issue?.severity === "review_required" || issue?.severity === "low") return "orange";
  if (issue?.severity === "medium") return "yellow";
  return "yellow";
}

function getScopedIssueKey(changeId, issue, index) {
  return [
    changeId || "change",
    issue?.id || issue?.key || issue?.type || issue?.message || "issue",
    index,
  ].join(":");
}

function DiffList({ t, items, bulletColor }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item, index) => (
        <div key={`${index}:${item}`} style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.45 }}>
          <span style={{ color: bulletColor || t.textFaint }}>•</span>
          <span style={{ color: t.text }}>{item}</span>
        </div>
      ))}
    </div>
  );
}

function DiffSummaryCard({ t, eyebrow, title, body, tone = "yellow" }) {
  const token = RISK_TOKEN(t, tone);
  return (
    <div style={{ borderRadius: 10, border: `1px solid ${token.fg}22`, background: token.bg, padding: 10 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: token.fg, marginBottom: 6 }}>
        {eyebrow}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: t.text, marginBottom: body ? 4 : 0 }}>{title}</div>
      {body ? <div style={{ fontSize: 11.5, color: t.textDim, lineHeight: 1.45 }}>{body}</div> : null}
    </div>
  );
}

function DiffPanel({ t, artifact, selectedNode, focusId, onFocusDiff, approvals, onApprove, onBlock, onRequireChanges, runState, isFreshView }) {
  const [expanded, setExpanded] = useDiffState({});
  const changes = getDisplayableProposedChanges(artifact);
  const advisoryChanges = getAdvisoryProposedChanges(artifact);
  const executionSummary = summarizeExecutionState(artifact);
  const selectedNodeId = selectedNode?.id || null;
  const affectedFileCount = countAffectedFiles(changes);

  useDiffEffect(() => {
    if (focusId) {
      setExpanded((current) => ({ ...current, [focusId]: true }));
    }
  }, [focusId]);

  useDiffEffect(() => {
    if (!selectedNodeId) return;
    const activeChange = changes.find((change) => getChangeNodeId(artifact, change) === selectedNodeId);
    if (activeChange) {
      setExpanded((current) => ({ ...current, [activeChange.id]: true }));
    }
  }, [artifact, changes, selectedNodeId]);

  const sortedChanges = useDiffMemo(() => {
    return changes.slice().sort((left, right) => {
      const leftActive = getChangeNodeId(artifact, left) === selectedNodeId ? 1 : 0;
      const rightActive = getChangeNodeId(artifact, right) === selectedNodeId ? 1 : 0;
      if (leftActive !== rightActive) return rightActive - leftActive;
      const leftBlocked = left.hasBlockingIssue || (left.policyState || left.policy) === "block" ? 1 : 0;
      const rightBlocked = right.hasBlockingIssue || (right.policyState || right.policy) === "block" ? 1 : 0;
      return rightBlocked - leftBlocked;
    });
  }, [artifact, changes, selectedNodeId]);

  const stats = changes.reduce(
    (accumulator, change) => {
      const entry = approvals[change.id];
      if (entry?.decision === "approve" && approvalEntryIsFresh(entry, artifact)) accumulator.approved += 1;
      else if (entry?.decision === "block" && approvalEntryIsFresh(entry, artifact)) accumulator.blocked += 1;
      else if ((change.policyState || change.policy) === "block") accumulator.policyBlocked += 1;
      else if (change.hasBlockingIssue) accumulator.issueBlocked += 1;
      else if ((change.policyState || change.policy) === "review_required") accumulator.review += 1;
      else accumulator.pending += 1;
      return accumulator;
    },
    { approved: 0, blocked: 0, policyBlocked: 0, issueBlocked: 0, review: 0, pending: 0 },
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${t.border}`, background: t.panel, flexShrink: 0 }}>
        <SectionTitle t={t} eyebrow="Approval loop" title="Diff and execution hold" meta={`${changes.length} admitted change${changes.length === 1 ? "" : "s"} · ${affectedFileCount} file${affectedFileCount === 1 ? "" : "s"}`} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11 }}>
          {affectedFileCount > 0 && <Pill t={t} risk="info">{affectedFileCount} affected file{affectedFileCount === 1 ? "" : "s"}</Pill>}
          {stats.approved > 0 && <Pill t={t} risk="green" strong>{stats.approved} approved</Pill>}
          {stats.policyBlocked > 0 && <Pill t={t} risk="red" strong>{stats.policyBlocked} policy-blocked</Pill>}
          {stats.issueBlocked > 0 && <Pill t={t} risk="red">{stats.issueBlocked} issue-flagged</Pill>}
          {stats.blocked > 0 && <Pill t={t} risk="red">{stats.blocked} blocked by reviewer</Pill>}
          {stats.review > 0 && <Pill t={t} risk="orange">{stats.review} review required</Pill>}
          {stats.pending > 0 && <Pill t={t}>{stats.pending} pending</Pill>}
          {advisoryChanges.length > 0 && <Pill t={t} risk="orange">{advisoryChanges.length} advisory preview{advisoryChanges.length === 1 ? "" : "s"} hidden</Pill>}
        </div>
        {selectedNode && (
          <div style={{ marginTop: 10, borderRadius: 10, border: `1px solid ${t.accent}22`, background: t.accentSoft, padding: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
              <Pill t={t} risk="info">active node</Pill>
              <span style={{ fontSize: 11, fontFamily: "ui-monospace, Menlo, monospace", color: t.textFaint }}>{selectedNode.id}</span>
            </div>
            <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.45 }}>
              {selectedNode.title}
            </div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {sortedChanges.length === 0 ? (
          <div style={{ borderRadius: 12, border: `1px dashed ${t.borderStrong}`, background: t.panel, padding: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: t.textFaint, marginBottom: 8 }}>
              Awaiting code changes
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: t.text, marginBottom: 6 }}>{executionSummary.title}</div>
            <div style={{ fontSize: 12.5, color: t.textDim, lineHeight: 1.5, marginBottom: executionSummary.items.length > 0 ? 12 : 0 }}>
              {executionSummary.body}
            </div>
            {executionSummary.items.length > 0 ? <DiffList t={t} items={executionSummary.items} bulletColor={t.info} /> : null}
          </div>
        ) : sortedChanges.map((change) => {
          const KindIcon = KIND_ICON[change.kind] || Icon.File;
          const policyState = change.policyState || change.policy;
          const entry = approvals[change.id];
          const freshDecision = approvalEntryIsFresh(entry, artifact);
          const open = expanded[change.id] || focusId === change.id;
          const lines = (change.preview || "").split("\n");
          const focused = focusId === change.id;
          const blockedByIssue = Boolean(change.hasBlockingIssue);
          const activeForNode = selectedNodeId && getChangeNodeId(artifact, change) === selectedNodeId;
          const approvalState = summarizeChangeApproval(change, artifact, approvals);
          const derivedIssues = collectReviewIssues(change, selectedNode, [change]);
          const primaryIssue = derivedIssues[0];
          const affectedScope = deriveAffectedScope(selectedNode, change, [change]);
          const targetLabel = getChangeTargetLabel(change);
          const effectRows = getChangeEffectRows(change);

          return (
            <div
              key={change.id}
              style={{
                marginBottom: 12,
                borderRadius: 12,
                border: `1px solid ${focused ? t.accent : activeForNode ? `${t.accent}66` : policyState === "block" || blockedByIssue ? `${t.red}66` : t.border}`,
                background: t.panel,
                boxShadow: focused ? `0 0 0 3px ${t.accent}20` : activeForNode ? `0 0 0 1px ${t.accent}18` : "none",
                overflow: "hidden",
              }}
            >
              <div onClick={() => setExpanded((current) => ({ ...current, [change.id]: !current[change.id] }))} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer" }}>
                <div style={{ color: policyState === "block" || blockedByIssue ? t.red : t.textDim }}>
                  <KindIcon />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontFamily: "ui-monospace, Menlo, monospace", color: t.textFaint, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {change.kind} · {change.operation}
                    </span>
                    {activeForNode && <Pill t={t} risk="info">active node</Pill>}
                    <span style={{ fontSize: 10, color: t.textFaint }}>from</span>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onFocusDiff("node", change.nodeId || change.node);
                      }}
                      style={{ fontSize: 10.5, fontFamily: "ui-monospace, Menlo, monospace", color: t.accent, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      {change.nodeId || change.node}
                    </button>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {targetLabel}
                  </div>
                  <div style={{ fontSize: 12, color: t.textDim, marginTop: 2 }}>{change.issueSummary || change.summary}</div>
                </div>
                <Icon.Chevron style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 160ms", color: t.textFaint }} />
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 14px 10px" }}>
                <PolicyPill t={t} policyState={policyState} />
                <ReversibilityPill t={t} reversibility={change.reversibility} />
                <EnforcementPill t={t} enforcement={change.enforcement} />
                <Pill t={t} risk={approvalState.tone}>{approvalState.label}</Pill>
                {blockedByIssue && <Pill t={t} risk="red">blocking issue</Pill>}
                {change.issues?.length > 0 && <Pill t={t} risk={blockedByIssue ? "red" : "orange"}>{change.issues.length} issue(s)</Pill>}
                {freshDecision && entry?.decision === "approve" && <Pill t={t} risk="green" strong>approved</Pill>}
                {freshDecision && entry?.decision === "block" && <Pill t={t} risk="red" strong>blocked</Pill>}
                {freshDecision && entry?.decision === "changes" && <Pill t={t} risk="orange" strong>changes requested</Pill>}
                {!isFreshView && <Pill t={t} risk="orange">stale view</Pill>}
              </div>

              {(change.riskFlags?.length > 0 || change.issues?.length > 0) && (
                <div style={{ padding: "0 14px 10px" }}>
                  {(change.issues || []).map((issue, index) => (
                    <div key={getScopedIssueKey(change.id, issue, index)} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 10px", background: RISK_TOKEN(t, issueTone(issue)).bg, borderRadius: 8, fontSize: 12.5, color: t.text, marginBottom: 4 }}>
                      <div style={{ color: RISK_TOKEN(t, issueTone(issue)).fg, marginTop: 1 }}>
                        <Icon.Alert />
                      </div>
                      <div style={{ flex: 1 }}>{issue.message}</div>
                    </div>
                  ))}
                  {change.issues?.length === 0 && (change.riskFlags || []).map((flag, index) => (
                    <div key={`${change.id}:${index}`} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 10px", background: t.orangeSoft, borderRadius: 8, fontSize: 12.5, color: t.text, marginBottom: 4 }}>
                      <div style={{ color: t.orange, marginTop: 1 }}>
                        <Icon.Alert />
                      </div>
                      <div style={{ flex: 1 }}>{flag}</div>
                    </div>
                  ))}
                </div>
              )}

              {open && (
                <div>
                  <div style={{ padding: "0 14px 12px" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                      <DiffSummaryCard
                        t={t}
                        eyebrow="Proposed action"
                        title={change.proposedAction || targetLabel}
                        body={change.summary}
                        tone="info"
                      />
                      <DiffSummaryCard
                        t={t}
                        eyebrow="Exact issue"
                        title={primaryIssue?.title || change.issueSummary || approvalState.label}
                        body={primaryIssue?.summary || primaryIssue?.evidence?.[0]?.summary || approvalState.detail}
                        tone={issueTone(primaryIssue)}
                      />
                    </div>
                  </div>

                  {(affectedScope.length > 0 || primaryIssue?.evidence?.length > 0) && (
                    <div style={{ padding: "0 14px 12px" }}>
                      {effectRows.length > 0 && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ fontSize: 11.5, color: t.textDim, marginBottom: 6 }}>File operations</div>
                          <DiffList t={t} items={effectRows} bulletColor={t.accent} />
                        </div>
                      )}
                      {affectedScope.length > 0 && (
                        <div style={{ marginBottom: primaryIssue?.evidence?.length ? 10 : 0 }}>
                          <div style={{ fontSize: 11.5, color: t.textDim, marginBottom: 6 }}>Affected files / symbols</div>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {affectedScope.map((item) => (
                              <span key={item.key || item.label} style={{ fontSize: 11.5, padding: "4px 8px", borderRadius: 8, background: t.panelAlt, color: t.text, border: `1px solid ${t.border}` }}>
                                {item.label}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {primaryIssue?.evidence?.length > 0 && (
                        <>
                          <div style={{ fontSize: 11.5, color: t.textDim, marginBottom: 6 }}>Evidence</div>
                          <DiffList
                            t={t}
                            items={primaryIssue.evidence.map((entry) => [entry.summary, entry.detail, entry.source, entry.locator].filter(Boolean).join(" · "))}
                            bulletColor={RISK_TOKEN(t, issueTone(primaryIssue)).fg}
                          />
                        </>
                      )}
                    </div>
                  )}

                  <div style={{ background: t.panelAlt, borderTop: `1px solid ${t.border}`, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12, padding: "10px 0", overflowX: "auto", lineHeight: 1.55 }}>
                    {lines.map((line, index) => renderDiffLine(line, t, index))}
                  </div>

                  {change.issues?.length > 0 && (
                    <div style={{ padding: "10px 14px", borderTop: `1px solid ${t.border}`, background: t.panel }}>
                      <div style={{ fontSize: 11.5, color: t.textDim, marginBottom: 6 }}>Evidence and actions</div>
                      {change.issues.map((issue, index) => (
                        <div key={getScopedIssueKey(change.id, issue, index)} style={{ marginBottom: 10 }}>
                          {issue.evidence?.length > 0 && (
                            <DiffList
                              t={t}
                              items={issue.evidence.map((entry) => [entry.message, entry.detail || entry.path, entry.symbol].filter(Boolean).join(" · "))}
                              bulletColor={RISK_TOKEN(t, issueTone(issue)).fg}
                            />
                          )}
                          {issue.suggestedInterventions?.length > 0 && (
                            <div style={{ marginTop: 6 }}>
                              <DiffList
                                t={t}
                                items={issue.suggestedInterventions.map((entry) =>
                                  entry.description ? `${entry.label} · ${entry.description}` : entry.label,
                                )}
                                bulletColor={t.accent}
                              />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {change.enforcement?.details && (
                    <div style={{ padding: "10px 14px", borderTop: `1px solid ${t.border}`, background: t.panel }}>
                      <div style={{ fontSize: 11.5, color: t.textDim, marginBottom: 4 }}>Enforcement details</div>
                      <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.5 }}>{change.enforcement.details}</div>
                    </div>
                  )}

                  <div style={{ padding: 10, borderTop: `1px solid ${t.border}`, display: "flex", gap: 6, flexWrap: "wrap", background: t.panel }}>
                    {policyState === "block" || blockedByIssue ? (
                      <div style={{ fontSize: 12.5, color: t.textDim, padding: "6px 4px", display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon.Lock style={{ color: t.red }} />
                        {policyState === "block"
                          ? "Blocked by policy. No approval path is exposed from this surface."
                          : "Blocked by deterministic issue detection. Resolve the issue or intervene before execution."}
                      </div>
                    ) : (
                      <>
                        <Btn t={t} variant="approve" icon={<Icon.Check />} onClick={() => onApprove(change.id)} disabled={runState !== "review" || !isFreshView}>
                          Approve and continue
                        </Btn>
                        <Btn t={t} variant="ghost" icon={<Icon.Edit />} onClick={() => onRequireChanges(change.id)} disabled={runState !== "review" || !isFreshView}>
                          Request intervention
                        </Btn>
                        <Btn t={t} variant="ghost" icon={<Icon.X />} onClick={() => onBlock(change.id)} disabled={runState !== "review" || !isFreshView}>
                          Block execution
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

Object.assign(window, { DiffPanel, PolicyPill, ReversibilityPill, EnforcementPill });
