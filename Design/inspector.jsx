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
      <div style={{ flex: 1, color: t.text, fontFamily: mono ? 'ui-monospace, Menlo, monospace' : "inherit", wordBreak: "break-word" }}>{children}</div>
    </div>
  );
}

function ListBlock({ t, items, bulletColor }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {items.map((item, index) => (
        <div key={`${index}:${item}`} style={{ display: "flex", gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
          <span style={{ color: bulletColor || t.textFaint }}>•</span>
          <span style={{ color: t.text }}>{item}</span>
        </div>
      ))}
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
  const { fg: riskFg, bg: riskBg } = RISK_TOKEN(t, risk);
  const sections = [];
  const proposedChanges = resolvedPayload.proposedChanges || [];
  const gates = resolvedPayload.approvals?.gates || (resolvedPayload.approvals?.gateId ? [{
    id: resolvedPayload.approvals.gateId,
    status: resolvedPayload.approvals.gateStatus || resolvedPayload.approvals.status,
    planVersion: resolvedPayload.approvals.planVersion,
  }] : []);
  const contextInputs = resolvedPayload.context?.inputs || resolvedPayload.context?.visibleSources || [];

  sections.push({
    title: "Overview",
    content: (
      <>
        <KV t={t} label="Node id" mono>{node.id}</KV>
        <KV t={t} label="Type">{node.nodeType}</KV>
        <KV t={t} label="Review status">{reviewStatusLabel(node.reviewStatus)}</KV>
        <KV t={t} label="Execution">{reviewStatusLabel(node.executionStatus)}</KV>
        {resolvedPayload.overview?.purpose && <KV t={t} label="Purpose">{resolvedPayload.overview.purpose}</KV>}
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
    sections.push({
      title: "Output preview",
      content: (
        <>
          <KV t={t} label="Summary">{resolvedPayload.outputPreview?.summary || node.outputSummary}</KV>
          {resolvedPayload.outputPreview?.preview && (
            <div style={{ fontSize: 12, fontFamily: 'ui-monospace, Menlo, monospace', color: t.text, background: t.panelAlt, padding: 10, borderRadius: 8, border: `1px solid ${t.border}`, whiteSpace: "pre-wrap" }}>
              {resolvedPayload.outputPreview.preview}
            </div>
          )}
          {resolvedPayload.outputPreview?.structuredData?.length > 0 && (
            <KV t={t} label="Structured">
              <ListBlock t={t} items={resolvedPayload.outputPreview.structuredData.map((entry) => `${entry.id} · ${entry.target} · ${entry.policyState}`)} />
            </KV>
          )}
        </>
      ),
    });
  }

  if (resolvedPayload.critique?.summary || resolvedPayload.critique?.riskFlags?.length || resolvedPayload.critique?.confidenceBand) {
    sections.push({
      title: "CT-MCP critique",
      content: (
        <div style={{ background: riskBg, border: `1px solid ${riskFg}40`, borderRadius: 10, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: riskFg, marginBottom: 6 }}>
            {resolvedPayload.critique?.severity || resolvedPayload.critique?.confidenceBand || "review warning"}
          </div>
          {resolvedPayload.critique?.summary && (
            <div style={{ fontSize: 12.5, color: t.text, lineHeight: 1.55 }}>{resolvedPayload.critique.summary}</div>
          )}
          {!resolvedPayload.critique?.summary && resolvedPayload.critique?.riskFlags?.length > 0 && (
            <ListBlock t={t} items={resolvedPayload.critique.riskFlags} bulletColor={riskFg} />
          )}
          {resolvedPayload.critique?.suggestion && (
            <div style={{ fontSize: 12, color: t.textDim, marginTop: 8 }}>→ {resolvedPayload.critique.suggestion}</div>
          )}
        </div>
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
                  <span key={tool} style={{ fontSize: 11.5, fontFamily: 'ui-monospace, Menlo, monospace', padding: "3px 8px", borderRadius: 7, background: t.panelAlt, color: t.text, border: `1px solid ${t.border}` }}>
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
                border: `1px solid ${t.border}`,
                background: t.panelAlt,
                color: t.text,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ color: t.textDim }}>
                {(KIND_ICON[change.kind] || Icon.File)()}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {change.target}
                </div>
                <div style={{ fontSize: 11.5, color: t.textDim }}>{change.summary}</div>
              </div>
              <Pill t={t} risk={(change.policyState || change.policy) === "block" ? "red" : (change.policyState || change.policy) === "review_required" ? "orange" : "green"}>
                {change.policyState || change.policy}
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
          {gates.length > 0 && (
            <KV t={t} label="Gates">
              <ListBlock
                t={t}
                items={gates.map((gate) => `${gate.id} · ${gate.status} · plan v${gate.planVersion}`)}
              />
            </KV>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            <Btn t={t} variant="ghost" icon={<Icon.Edit />} onClick={() => onIntervene(node.id, "add-source")}>
              Edit context
            </Btn>
            <Btn t={t} variant="ghost" icon={<Icon.Edit />} onClick={() => onIntervene(node.id, "tighten")}>
              Edit constraints
            </Btn>
            <Btn t={t} variant="ghost" icon={<Icon.Refresh />} onClick={() => onIntervene(node.id, "split-node")}>
              Split node
            </Btn>
            <Btn t={t} variant="ghost" icon={<Icon.Refresh />} onClick={() => onIntervene(node.id, "regenerate")}>
              Regenerate
            </Btn>
            <Btn t={t} variant="ghost" icon={<Icon.Lock />} onClick={() => onIntervene(node.id, "require-approval")}>
              Mark approval-required
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
          <span style={{ fontSize: 11, fontFamily: 'ui-monospace, Menlo, monospace', color: t.textFaint }}>{nodeRevisionKey(node)}</span>
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
