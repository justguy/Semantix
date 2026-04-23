function InspectorSection({ t, title, children }) {
  return (
    <div style={{ padding: "14px 14px 16px", borderBottom: `1px solid ${t.border}` }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: t.textFaint, marginBottom: 10 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function KV({ t, label, children, mono }) {
  return (
    <div style={{ display: "flex", gap: 10, fontSize: 12.5, lineHeight: 1.55, marginBottom: 6 }}>
      <div style={{ color: t.textDim, minWidth: 104, fontSize: 11.5 }}>{label}</div>
      <div style={{ flex: 1, color: t.text, fontFamily: mono ? "ui-monospace, Menlo, monospace" : "inherit", wordBreak: "break-word" }}>{children}</div>
    </div>
  );
}

function pickInspectorText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function formatListBlockItem(item) {
  if (item == null) return "";
  if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
    return String(item);
  }
  if (Array.isArray(item)) {
    return item.map((entry) => formatListBlockItem(entry)).filter(Boolean).join(" · ");
  }
  if (typeof item !== "object") {
    return String(item);
  }

  const primary = pickInspectorText(
    item.text,
    item.detail,
    item.summary,
    item.message,
    item.label,
    item.title,
    item.name,
    item.kind,
    item.type,
    item.id,
  );
  const segments = [];
  if (primary) segments.push(primary);

  const field = pickInspectorText(item.field);
  if (field) segments.push(`field=${field}`);

  if (typeof item.required === "boolean") {
    segments.push(item.required ? "required" : "optional");
  }

  const allowedRoots = Array.isArray(item.allowed_roots)
    ? item.allowed_roots
    : Array.isArray(item.allowedRoots)
      ? item.allowedRoots
      : [];
  if (allowedRoots.length > 0) {
    segments.push(`allowed=${allowedRoots.join(", ")}`);
  }

  const forbiddenRoots = Array.isArray(item.forbidden_roots)
    ? item.forbidden_roots
    : Array.isArray(item.forbiddenRoots)
      ? item.forbiddenRoots
      : [];
  if (forbiddenRoots.length > 0) {
    segments.push(`forbidden=${forbiddenRoots.join(", ")}`);
  }

  const locator = pickInspectorText(item.locator, item.path, item.source, item.reason);
  if (locator) segments.push(locator);

  return segments.join(" · ") || JSON.stringify(item);
}

function ListBlock({ t, items, bulletColor }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item, index) => {
        const label = formatListBlockItem(item);
        return (
        <div key={`${index}:${label}`} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
          <span style={{ color: bulletColor || t.textFaint }}>•</span>
          <span style={{ color: t.text }}>{label}</span>
        </div>
        );
      })}
    </div>
  );
}

function TypeBadge({ t, type }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        borderRadius: 999,
        padding: "3px 8px",
        background: t.panelAlt,
        color: t.textDim,
        border: `1px solid ${t.border}`,
      }}
    >
      {type?.replaceAll("_", " ") || "node"}
    </span>
  );
}

function issueRisk(issue) {
  if (issue?.blocking) return "red";
  if (issue?.severity === "error" || issue?.severity === "critical" || issue?.severity === "block") return "red";
  if (issue?.severity === "warning" || issue?.severity === "review_required" || issue?.severity === "low") return "orange";
  if (issue?.severity === "medium") return "yellow";
  return "yellow";
}

function ScopePills({ t, items }) {
  if (!items?.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      {items.map((item) => (
        <span key={item.key || item.label} style={{ fontSize: 11.5, padding: "4px 8px", borderRadius: 8, background: t.panelAlt, color: t.text, border: `1px solid ${t.border}` }}>
          {item.label}
          {item.detail ? <span style={{ color: t.textDim }}> · {item.detail}</span> : null}
        </span>
      ))}
    </div>
  );
}

function SummaryCard({ t, eyebrow, title, body, tone = "yellow" }) {
  const token = RISK_TOKEN(t, tone);
  return (
    <div style={{ borderRadius: 12, border: `1px solid ${token.fg}22`, background: token.bg, padding: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase", color: token.fg, marginBottom: 8 }}>
        {eyebrow}
      </div>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: body ? 5 : 0 }}>{title}</div>
      {body ? <div style={{ fontSize: 12, color: t.textDim, lineHeight: 1.45 }}>{body}</div> : null}
    </div>
  );
}

function Inspector({ t, artifact, node, approvals, payload, isLoading, loadError, onJumpToDiff, onIntervene }) {
  if (!node) {
    return (
      <div style={{ padding: 42, textAlign: "center", color: t.textFaint, fontSize: 13 }}>
        <div style={{ fontSize: 48, marginBottom: 12, opacity: 0.3 }}>◎</div>
        Select an execution node to inspect its structured Semantix payload.
      </div>
    );
  }

  const resolvedPayload = payload || getNodeInspectorPayload(artifact, node.id) || { node };
  const risk = resolveRiskFromNode(node);
  const sections = [];
  const allProposedChanges = resolvedPayload.proposedChanges || [];
  const proposedChanges = filterDisplayableProposedChanges(allProposedChanges);
  const advisoryChanges = filterAdvisoryProposedChanges(allProposedChanges);
  const executionSummary = summarizeExecutionState(artifact);
  const issues = collectReviewIssues(resolvedPayload, node, proposedChanges);
  const primaryIssue = issues[0] || null;
  const evidence = [
    ...(primaryIssue?.evidence || []),
    ...(resolvedPayload.evidence || []),
  ];
  const suggestedInterventions = resolvedPayload.suggestedInterventions || [];
  const affectedScope = deriveAffectedScope(node, resolvedPayload, proposedChanges);
  const gates = resolvedPayload.approvals?.gates || (resolvedPayload.approvals?.gateId ? [{
    id: resolvedPayload.approvals.gateId,
    status: resolvedPayload.approvals.gateStatus || resolvedPayload.approvals.status,
    planVersion: resolvedPayload.approvals.planVersion,
  }] : []);
  const contextInputs = resolvedPayload.context?.inputs || resolvedPayload.context?.visibleSources || [];
  const approvalState = proposedChanges.length > 0
    ? summarizeNodeApproval(artifact, node, { ...resolvedPayload, proposedChanges }, approvals)
    : {
      tone: "info",
      label: executionSummary.title,
      detail: executionSummary.body,
      approvedCount: 0,
      approvableCount: 0,
      blockedCount: 0,
      changeRequestCount: 0,
      policyBlockedCount: 0,
      gateCount: gates.length,
    };
  const proposedAction = resolvedPayload.proposedAction?.summary
    || resolvedPayload.proposedAction
    || proposedChanges[0]?.proposedAction
    || proposedChanges[0]?.summary
    || node.outputSummary
    || executionSummary.body
    || "No proposed action attached.";
  const primaryTargetLabel = proposedChanges.length > 0
    ? getChangeTargetLabel(proposedChanges[0])
    : executionSummary.title;

  sections.push({
    title: "Execution brief",
    content: (
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        <SummaryCard
          t={t}
          eyebrow={proposedChanges.length > 0 ? "Proposed action" : "Execution state"}
          title={primaryTargetLabel}
          body={proposedAction}
          tone="info"
        />
        <SummaryCard
          t={t}
          eyebrow="Exact issue"
          title={primaryIssue?.title || resolvedPayload.issueSummary || "No explicit issue attached."}
          body={primaryIssue?.summary || primaryIssue?.evidence?.[0]?.summary || approvalState.detail}
          tone={issueRisk(primaryIssue)}
        />
        <SummaryCard
          t={t}
          eyebrow="Approval state"
          title={approvalState.label}
          body={approvalState.approvableCount > 0
            ? `${approvalState.approvedCount}/${approvalState.approvableCount} approvable actions approved${approvalState.gateCount ? ` · ${approvalState.gateCount} gate${approvalState.gateCount === 1 ? "" : "s"}` : ""}`
            : approvalState.detail}
          tone={approvalState.tone}
        />
      </div>
    ),
  });

  sections.push({
    title: "Overview",
    content: (
      <>
        <KV t={t} label="Node id" mono>{node.id}</KV>
        <KV t={t} label="Type">{node.nodeType}</KV>
        <KV t={t} label="Review status">{reviewStatusLabel(node.reviewStatus)}</KV>
        <KV t={t} label="Execution">{reviewStatusLabel(node.executionStatus)}</KV>
        {resolvedPayload.overview?.purpose && <KV t={t} label="Purpose">{resolvedPayload.overview.purpose}</KV>}
        <KV t={t} label={proposedChanges.length > 0 ? "Proposed action" : "Execution state"}>{proposedAction}</KV>
        <KV t={t} label="Owner">{prettySystemName(node.gatingOwner)}</KV>
        {node.contributingSystems?.length > 0 && (
          <KV t={t} label="Systems">{node.contributingSystems.map(prettySystemName).join(" · ")}</KV>
        )}
      </>
    ),
  });

  if (resolvedPayload.intentLinkage) {
    sections.push({
      title: "Intent linkage",
      content: (
        <>
          <KV t={t} label="Directive">{resolvedPayload.intentLinkage.primaryDirective}</KV>
          {resolvedPayload.intentLinkage.strictBoundaries?.length > 0 && (
            <KV t={t} label="Boundaries">
              <ListBlock t={t} items={resolvedPayload.intentLinkage.strictBoundaries} bulletColor={t.red} />
            </KV>
          )}
        </>
      ),
    });
  }

  if (contextInputs.length || resolvedPayload.context?.inputSummary || resolvedPayload.context?.grounding || node.sourceCount != null) {
    sections.push({
      title: "Context",
      content: (
        <>
          {resolvedPayload.context?.inputSummary && <KV t={t} label="Summary">{resolvedPayload.context.inputSummary}</KV>}
          {resolvedPayload.context?.grounding && <KV t={t} label="Grounding">{resolvedPayload.context.grounding}</KV>}
          {node.sourceCount != null && <KV t={t} label="Sources">{node.sourceCount}</KV>}
          {contextInputs.length > 0 && (
            <KV t={t} label="Inputs">
              <ListBlock t={t} items={contextInputs} />
            </KV>
          )}
          {resolvedPayload.context?.upstreamInputs?.length > 0 && (
            <KV t={t} label="Upstream">
              <ListBlock t={t} items={resolvedPayload.context.upstreamInputs} />
            </KV>
          )}
        </>
      ),
    });
  }

  if (proposedChanges.length === 0 && (executionSummary.items.length > 0 || advisoryChanges.length > 0 || node.outputSummary)) {
    sections.push({
      title: "Execution state",
      content: (
        <>
          <KV t={t} label="Summary">{executionSummary.body}</KV>
          {executionSummary.items.length > 0 && (
            <KV t={t} label="Signals">
              <ListBlock t={t} items={executionSummary.items} bulletColor={t.info} />
            </KV>
          )}
          {advisoryChanges.length > 0 && (
            <KV t={t} label="Hidden previews">
              {advisoryChanges.length} advisory host preview{advisoryChanges.length === 1 ? "" : "s"} omitted until admitted code-change output is available.
            </KV>
          )}
        </>
      ),
    });
  }

  if (issues.length > 0 || resolvedPayload.issueSummary) {
    sections.push({
      title: "Issue detection",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {affectedScope.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, color: t.textDim, marginBottom: 6 }}>Affected files / symbols</div>
              <ScopePills t={t} items={affectedScope} />
            </div>
          )}
          {resolvedPayload.issueSummary && (
            <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.55 }}>
              {resolvedPayload.issueSummary}
            </div>
          )}
          {issues.map((issue) => {
            const riskTone = issueRisk(issue);
            return (
              <div key={issue.key || issue.title} style={{ padding: 12, borderRadius: 10, background: RISK_TOKEN(t, riskTone).bg, border: `1px solid ${RISK_TOKEN(t, riskTone).fg}33` }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <Pill t={t} risk={riskTone} strong={riskTone === "red"}>
                    {issue.kind?.replaceAll("_", " ") || "issue"}
                  </Pill>
                  {issue.severity === "critical" || issue.severity === "error" || issue.severity === "block" ? <Pill t={t} risk="red">blocking</Pill> : null}
                </div>
                <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.55 }}>{issue.title}</div>
                {issue.summary ? <div style={{ marginTop: 6, fontSize: 12, color: t.textDim, lineHeight: 1.45 }}>{issue.summary}</div> : null}
                {issue.assumption ? <div style={{ marginTop: 6, fontSize: 12, color: t.textDim, lineHeight: 1.45 }}><strong style={{ color: t.text }}>Bad assumption:</strong> {issue.assumption}</div> : null}
                {issue.affected?.length > 0 && (
                  <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
                    <KV t={t} label="Scope">
                      <ScopePills t={t} items={issue.affected} />
                    </KV>
                  </div>
                )}
                {issue.evidence?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11.5, color: t.textDim, marginBottom: 6 }}>Evidence</div>
                    <ListBlock
                      t={t}
                      items={issue.evidence.map((entry) => [entry.summary, entry.detail, entry.source, entry.locator].filter(Boolean).join(" · "))}
                      bulletColor={RISK_TOKEN(t, riskTone).fg}
                    />
                  </div>
                )}
                {issue.interventions?.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11.5, color: t.textDim, marginBottom: 6 }}>Suggested actions</div>
                    <ListBlock
                      t={t}
                      items={issue.interventions.map((entry) =>
                        entry.detail ? `${entry.label} · ${entry.detail}` : entry.label,
                      )}
                      bulletColor={t.accent}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ),
    });
  }

  if (evidence.length > 0) {
    sections.push({
      title: "Evidence",
      content: (
        <ListBlock
          t={t}
          items={evidence.map((entry) => [entry.message, entry.detail || entry.path, entry.symbol].filter(Boolean).join(" · "))}
          bulletColor={t.info}
        />
      ),
    });
  }

  if (resolvedPayload.constraints?.hard?.length || resolvedPayload.constraints?.soft?.length) {
    sections.push({
      title: "Constraints",
      content: (
        <>
          {resolvedPayload.constraints.hard?.length > 0 && (
            <div style={{ marginBottom: resolvedPayload.constraints.soft?.length ? 10 : 0 }}>
              <div style={{ fontSize: 11.5, color: t.textDim, marginBottom: 6 }}>Hard constraints</div>
              <ListBlock t={t} items={resolvedPayload.constraints.hard} bulletColor={t.red} />
            </div>
          )}
          {resolvedPayload.constraints.soft?.length > 0 && (
            <div>
              <div style={{ fontSize: 11.5, color: t.textDim, marginBottom: 6 }}>Soft constraints</div>
              <ListBlock t={t} items={resolvedPayload.constraints.soft} bulletColor={t.yellow} />
            </div>
          )}
        </>
      ),
    });
  }

  if (resolvedPayload.outputPreview?.summary || resolvedPayload.outputPreview?.preview || node.outputSummary || resolvedPayload.outputPreview?.structuredData?.length) {
    const structuredOutput = filterDisplayableProposedChanges(
      resolvedPayload.outputPreview?.structuredData || resolvedPayload.outputPreview?.stateEffects || [],
    );
    const outputPreviewIsAdvisory = isAdvisoryPreviewChange(
      resolvedPayload.outputPreview,
      resolvedPayload.outputPreview?.preview || resolvedPayload.outputPreview?.diff || resolvedPayload.outputPreview?.diffPreview || "",
    );
    sections.push({
      title: "Output preview",
      content: (
        <>
          <KV t={t} label="Summary">
            {outputPreviewIsAdvisory && structuredOutput.length === 0
              ? executionSummary.body
              : resolvedPayload.outputPreview?.summary || node.outputSummary}
          </KV>
          {resolvedPayload.outputPreview?.preview && !outputPreviewIsAdvisory && (
            <div style={{ fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", color: t.text, background: t.panelAlt, padding: 10, borderRadius: 8, border: `1px solid ${t.border}`, whiteSpace: "pre-wrap" }}>
              {resolvedPayload.outputPreview.preview}
            </div>
          )}
          {structuredOutput.length > 0 && (
            <KV t={t} label="Structured">
              <ListBlock t={t} items={structuredOutput.map((entry) => `${entry.id} · ${getChangeTargetLabel(entry)} · ${entry.policyState}`)} />
            </KV>
          )}
        </>
      ),
    });
  }

  if (resolvedPayload.tooling?.visibleTools?.length || resolvedPayload.tooling?.runtimeBinding?.runtimeKind || resolvedPayload.tooling?.permissionLevel || resolvedPayload.tooling?.capabilityScope?.length) {
    sections.push({
      title: "Tooling",
      content: (
        <>
          {resolvedPayload.tooling?.runtimeBinding?.runtimeKind && (
            <KV t={t} label="Runtime">{resolvedPayload.tooling.runtimeBinding.runtimeKind}</KV>
          )}
          {resolvedPayload.tooling?.permissionLevel && (
            <KV t={t} label="Permission">{resolvedPayload.tooling.permissionLevel}</KV>
          )}
          {resolvedPayload.tooling?.capabilityScope?.length > 0 && (
            <KV t={t} label="Scope">
              <ListBlock t={t} items={resolvedPayload.tooling.capabilityScope} />
            </KV>
          )}
          {resolvedPayload.tooling?.visibleTools?.length > 0 && (
            <KV t={t} label="Visible tools">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {resolvedPayload.tooling.visibleTools.map((tool) => (
                  <span key={tool} style={{ fontSize: 11.5, fontFamily: "ui-monospace, Menlo, monospace", padding: "3px 8px", borderRadius: 7, background: t.panelAlt, color: t.text, border: `1px solid ${t.border}` }}>
                    {tool}
                  </span>
                ))}
              </div>
            </KV>
          )}
          {resolvedPayload.tooling?.approvalPreconditions?.length > 0 && (
            <KV t={t} label="Preconditions">
              <ListBlock t={t} items={resolvedPayload.tooling.approvalPreconditions} />
            </KV>
          )}
        </>
      ),
    });
  }

  if (proposedChanges.length > 0) {
    sections.push({
      title: "Proposed changes",
      content: (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {proposedChanges.map((change) => (
            <button
              key={change.id}
              onClick={() => onJumpToDiff(change.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 12px",
                borderRadius: 10,
                border: `1px solid ${change.hasBlockingIssue ? `${t.red}44` : t.border}`,
                background: t.panelAlt,
                color: t.text,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ color: change.hasBlockingIssue ? t.red : t.textDim }}>
                {(KIND_ICON[change.kind] || Icon.File)()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {getChangeTargetLabel(change)}
                </div>
                <div style={{ fontSize: 11.5, color: t.textDim }}>{change.issueSummary || change.summary}</div>
              </div>
              <Pill t={t} risk={change.hasBlockingIssue ? "red" : (change.policyState || change.policy) === "block" ? "red" : (change.policyState || change.policy) === "review_required" ? "orange" : "green"}>
                {change.hasBlockingIssue ? "issue flagged" : (change.policyState || change.policy)}
              </Pill>
            </button>
          ))}
        </div>
      ),
    });
  }

  if (resolvedPayload.approvals?.approvalRequired || resolvedPayload.approvals?.required || gates.length > 0) {
    sections.push({
      title: "Approvals and gates",
      content: (
        <>
          <KV t={t} label="Approval required">{resolvedPayload.approvals?.approvalRequired || resolvedPayload.approvals?.required ? "yes" : "no"}</KV>
          <KV t={t} label="State">{approvalState.label}</KV>
          <KV t={t} label="Detail">{approvalState.detail}</KV>
          {gates.length > 0 && (
            <KV t={t} label="Gates">
              <ListBlock
                t={t}
                items={gates.map((gate) => `${gate.id} · ${gate.status} · plan v${gate.planVersion}`)}
              />
            </KV>
          )}
          {suggestedInterventions.length > 0 && (
            <KV t={t} label="Intervene">
              <ListBlock
                t={t}
                items={suggestedInterventions.map((entry) =>
                  entry.description ? `${entry.label} · ${entry.description}` : entry.label,
                )}
                bulletColor={t.accent}
              />
            </KV>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            <Btn t={t} variant="ghost" icon={<Icon.Edit />} onClick={() => onIntervene(node.id, "add-source")}>
              Add source
            </Btn>
            <Btn t={t} variant="ghost" icon={<Icon.Edit />} onClick={() => onIntervene(node.id, "tighten")}>
              Tighten
            </Btn>
            <Btn t={t} variant="ghost" icon={<Icon.Refresh />} onClick={() => onIntervene(node.id, "split-node")}>
              Split step
            </Btn>
            <Btn t={t} variant="ghost" icon={<Icon.Refresh />} onClick={() => onIntervene(node.id, "regenerate")}>
              Regenerate
            </Btn>
            <Btn t={t} variant="ghost" icon={<Icon.Lock />} onClick={() => onIntervene(node.id, "require-approval")}>
              Require approval
            </Btn>
          </div>
        </>
      ),
    });
  }

  if (resolvedPayload.replay?.traceHandle || resolvedPayload.replay?.checkpointId || resolvedPayload.replay?.command || resolvedPayload.replay?.runId || resolvedPayload.replay?.checkpoints?.length) {
    sections.push({
      title: "Replay and trace",
      content: (
        <>
          {resolvedPayload.replay?.checkpointId && <KV t={t} label="Checkpoint" mono>{resolvedPayload.replay.checkpointId}</KV>}
          {resolvedPayload.replay?.traceHandle && <KV t={t} label="Trace" mono>{resolvedPayload.replay.traceHandle}</KV>}
          {resolvedPayload.replay?.command && <KV t={t} label="Command" mono>{resolvedPayload.replay.command}</KV>}
          {resolvedPayload.replay?.runId && <KV t={t} label="Run" mono>{resolvedPayload.replay.runId}</KV>}
          {resolvedPayload.replay?.checkpoints?.length > 0 && (
            <KV t={t} label="Checkpoints">
              <ListBlock t={t} items={resolvedPayload.replay.checkpoints.map((checkpoint) => `${checkpoint.id} · ${checkpoint.reason}`)} />
            </KV>
          )}
        </>
      ),
    });
  }

  if (resolvedPayload.audit?.artifactId || resolvedPayload.audit?.artifactHash || resolvedPayload.audit?.lastArtifactHash || resolvedPayload.audit?.nodeRevision != null || resolvedPayload.audit?.riskSignals?.length) {
    sections.push({
      title: "Audit metadata",
      content: (
        <>
          {resolvedPayload.audit.artifactId && <KV t={t} label="Artifact" mono>{resolvedPayload.audit.artifactId}</KV>}
          {resolvedPayload.audit.artifactHash && <KV t={t} label="Hash" mono>{shortHash(resolvedPayload.audit.artifactHash)}</KV>}
          {!resolvedPayload.audit.artifactHash && resolvedPayload.audit.lastArtifactHash && (
            <KV t={t} label="Hash" mono>{shortHash(resolvedPayload.audit.lastArtifactHash)}</KV>
          )}
          {resolvedPayload.audit.planVersion != null && <KV t={t} label="Plan version">{resolvedPayload.audit.planVersion}</KV>}
          {resolvedPayload.audit.graphVersion != null && <KV t={t} label="Graph version">{resolvedPayload.audit.graphVersion}</KV>}
          {resolvedPayload.audit.nodeRevision != null && <KV t={t} label="Node revision">{resolvedPayload.audit.nodeRevision}</KV>}
          {resolvedPayload.audit.riskSignals?.length > 0 && (
            <KV t={t} label="Risk signals">
              <ListBlock t={t} items={resolvedPayload.audit.riskSignals.map((signal) => `${signal.severity} · ${signal.message}`)} />
            </KV>
          )}
        </>
      ),
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "auto" }}>
      <div style={{ padding: "16px 14px", borderBottom: `1px solid ${t.border}`, background: t.panel }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <RiskDot t={t} risk={risk} />
          <span style={{ fontSize: 11, fontFamily: "ui-monospace, Menlo, monospace", color: t.textFaint }}>{nodeRevisionKey(node)}</span>
          <TypeBadge t={t} type={node.nodeType} />
          <div style={{ flex: 1 }} />
          <Pill t={t} risk={risk}>{node.confidenceBand || "review"}</Pill>
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: t.text, marginBottom: 6 }}>{node.title}</div>
        {node.reviewStatus === "stale" && (
          <div style={{ padding: "8px 10px", borderRadius: 8, background: t.redSoft, color: t.text, fontSize: 12.5, border: `1px solid ${t.red}33` }}>
            This node is stale and must be re-reviewed on the latest artifact.
          </div>
        )}
        {isLoading && (
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: t.panelAlt, color: t.textDim, fontSize: 12.5, border: `1px solid ${t.border}` }}>
            Loading live inspector payload from the control plane…
          </div>
        )}
        {loadError && (
          <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: t.redSoft, color: t.text, fontSize: 12.5, border: `1px solid ${t.red}33` }}>
            {loadError}
          </div>
        )}
      </div>

      {sections.filter((section) => section.content).map((section) => (
        <InspectorSection key={section.title} t={t} title={section.title}>
          {section.content}
        </InspectorSection>
      ))}
    </div>
  );
}

Object.assign(window, { Inspector, InspectorSection, KV });
