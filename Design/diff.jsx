const { useState: useDiffState, useEffect: useDiffEffect } = React;

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

function DiffPanel({ t, artifact, focusId, onFocusDiff, approvals, onApprove, onBlock, onRequireChanges, runState, isFreshView }) {
  const [expanded, setExpanded] = useDiffState({});
  const changes = getProposedChanges(artifact);

  useDiffEffect(() => {
    if (focusId) {
      setExpanded((current) => ({ ...current, [focusId]: true }));
    }
  }, [focusId]);

  const stats = changes.reduce(
    (accumulator, change) => {
      const entry = approvals[change.id];
      if (entry?.decision === "approve" && approvalEntryIsFresh(entry, artifact)) accumulator.approved += 1;
      else if (entry?.decision === "block" && approvalEntryIsFresh(entry, artifact)) accumulator.blocked += 1;
      else if ((change.policyState || change.policy) === "block") accumulator.policyBlocked += 1;
      else if ((change.policyState || change.policy) === "review_required") accumulator.review += 1;
      else accumulator.pending += 1;
      return accumulator;
    },
    { approved: 0, blocked: 0, policyBlocked: 0, review: 0, pending: 0 }
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "14px 16px", borderBottom: `1px solid ${t.border}`, background: t.panel, flexShrink: 0 }}>
        <SectionTitle t={t} eyebrow="State diff" title="What becomes real" meta={`${changes.length} changes`} />
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11 }}>
          {stats.approved > 0 && <Pill t={t} risk="green" strong>{stats.approved} approved</Pill>}
          {stats.policyBlocked > 0 && <Pill t={t} risk="red" strong>{stats.policyBlocked} policy-blocked</Pill>}
          {stats.blocked > 0 && <Pill t={t} risk="red">{stats.blocked} blocked by reviewer</Pill>}
          {stats.review > 0 && <Pill t={t} risk="orange">{stats.review} review required</Pill>}
          {stats.pending > 0 && <Pill t={t}>{stats.pending} pending</Pill>}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {changes.map((change) => {
          const KindIcon = KIND_ICON[change.kind] || Icon.File;
          const policyState = change.policyState || change.policy;
          const entry = approvals[change.id];
          const freshDecision = approvalEntryIsFresh(entry, artifact);
          const open = expanded[change.id] || focusId === change.id;
          const lines = (change.preview || "").split("\n");
          const focused = focusId === change.id;

          return (
            <div
              key={change.id}
              style={{
                marginBottom: 12,
                borderRadius: 12,
                border: `1px solid ${focused ? t.accent : policyState === "block" ? `${t.red}66` : t.border}`,
                background: t.panel,
                boxShadow: focused ? `0 0 0 3px ${t.accent}20` : "none",
                overflow: "hidden",
              }}
            >
              <div onClick={() => setExpanded((current) => ({ ...current, [change.id]: !current[change.id] }))} style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: "pointer" }}>
                <div style={{ color: policyState === "block" ? t.red : t.textDim }}>
                  <KindIcon />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 10, fontFamily: 'ui-monospace, Menlo, monospace', color: t.textFaint, textTransform: "uppercase", letterSpacing: 0.5 }}>
                      {change.kind} · {change.operation}
                    </span>
                    <span style={{ fontSize: 10, color: t.textFaint }}>from</span>
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        onFocusDiff("node", change.nodeId || change.node);
                      }}
                      style={{ fontSize: 10.5, fontFamily: 'ui-monospace, Menlo, monospace', color: t.accent, background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
                    >
                      {change.nodeId || change.node}
                    </button>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: t.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {change.target}
                  </div>
                  <div style={{ fontSize: 12, color: t.textDim, marginTop: 2 }}>{change.summary}</div>
                </div>
                <Icon.Chevron style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 160ms", color: t.textFaint }} />
              </div>

              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", padding: "0 14px 10px" }}>
                <PolicyPill t={t} policyState={policyState} />
                <ReversibilityPill t={t} reversibility={change.reversibility} />
                <EnforcementPill t={t} enforcement={change.enforcement} />
                {freshDecision && entry?.decision === "approve" && <Pill t={t} risk="green" strong>approved</Pill>}
                {freshDecision && entry?.decision === "block" && <Pill t={t} risk="red" strong>blocked</Pill>}
                {freshDecision && entry?.decision === "changes" && <Pill t={t} risk="orange" strong>changes requested</Pill>}
                {!isFreshView && <Pill t={t} risk="orange">stale view</Pill>}
              </div>

              {change.riskFlags?.length > 0 && (
                <div style={{ padding: "0 14px 10px" }}>
                  {change.riskFlags.map((flag, index) => (
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
                  <div style={{ background: t.panelAlt, borderTop: `1px solid ${t.border}`, fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, padding: "10px 0", overflowX: "auto", lineHeight: 1.55 }}>
                    {lines.map((line, index) => renderDiffLine(line, t, index))}
                  </div>

                  {change.enforcement?.details && (
                    <div style={{ padding: "10px 14px", borderTop: `1px solid ${t.border}`, background: t.panel }}>
                      <div style={{ fontSize: 11.5, color: t.textDim, marginBottom: 4 }}>Enforcement details</div>
                      <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.5 }}>{change.enforcement.details}</div>
                    </div>
                  )}

                  <div style={{ padding: 10, borderTop: `1px solid ${t.border}`, display: "flex", gap: 6, flexWrap: "wrap", background: t.panel }}>
                    {policyState === "block" ? (
                      <div style={{ fontSize: 12.5, color: t.textDim, padding: "6px 4px", display: "flex", alignItems: "center", gap: 6 }}>
                        <Icon.Lock style={{ color: t.red }} />
                        Blocked by policy. No approval path is exposed from this surface.
                      </div>
                    ) : (
                      <>
                        <Btn t={t} variant="approve" icon={<Icon.Check />} onClick={() => onApprove(change.id)} disabled={runState !== "review"}>
                          Approve change
                        </Btn>
                        <Btn t={t} variant="ghost" icon={<Icon.Edit />} onClick={() => onRequireChanges(change.id)} disabled={runState !== "review"}>
                          Require changes
                        </Btn>
                        <Btn t={t} variant="ghost" icon={<Icon.X />} onClick={() => onBlock(change.id)} disabled={runState !== "review"}>
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

Object.assign(window, { DiffPanel, PolicyPill, ReversibilityPill, EnforcementPill });
