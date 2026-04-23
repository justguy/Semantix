const { useState: useAS, useEffect: useAE, useMemo: useAM, useRef: useAR } = React;

const PHASES = {
  prompt: "prompt",
  compiling: "compiling",
  review: "review",
  running: "running",
  done: "done",
};

function findFirstAttentionNode(artifact) {
  const nodes = getNodes(artifact);
  return nodes.find((node) => {
    const risk = resolveRiskFromNode(node);
    return risk === "orange" || risk === "red";
  }) || getPrimaryReviewNode(artifact);
}

function findFirstChangeForNode(artifact, nodeId) {
  return getProposedChanges(artifact).find((change) => getChangeNodeId(artifact, change) === nodeId) || null;
}

function gateForNode(artifact, nodeId) {
  return artifact?.plan?.approvalGates?.find((gate) => gate.required && gate.targetNodeId === nodeId)
    || artifact?.plan?.approvalGates?.find((gate) => gate.required)
    || null;
}

function approvalKey(artifact, gate) {
  return `${artifact?.artifactHash || "artifact"}:${gate?.id || "gate"}`;
}

function buildApprovalEntry(decision, artifact, node) {
  return {
    decision,
    planVersion: artifact.planVersion,
    graphVersion: artifact.graphVersion,
    artifactHash: artifact.artifactHash,
    nodeRevision: node?.revision,
  };
}

function syncApprovalsFromArtifact(artifact, decisionHints = {}) {
  if (!artifact) return {};

  const approvals = {};
  getProposedChanges(artifact).forEach((change) => {
    const nodeId = getChangeNodeId(artifact, change);
    const node = getNodeById(artifact, nodeId);
    const gate = gateForNode(artifact, nodeId);
    if (!gate || !gate.required) return;

    if (gate.status === "approved") {
      approvals[change.id] = buildApprovalEntry("approve", artifact, node);
      return;
    }

    if (gate.status === "rejected") {
      const decision = decisionHints[approvalKey(artifact, gate)] || "block";
      approvals[change.id] = buildApprovalEntry(decision, artifact, node);
    }
  });

  return approvals;
}

function freshApprovalSummary(artifact, approvals) {
  const changes = getProposedChanges(artifact).filter((change) => (change.policyState || change.policy) !== "block");
  const approved = changes.filter((change) => approvalEntryIsFresh(approvals[change.id], artifact)).length;
  return {
    approvableCount: changes.length,
    approvedCount: approved,
    allApproved: changes.length > 0 && approved === changes.length,
  };
}

function deriveScenarioLabel(scenarioKey, artifact, prompt) {
  const scenario = getScenarioRecordByKey(scenarioKey);
  if (scenario) return scenario;

  const intent = getIntent(artifact);
  return {
    key: "live",
    label: "Live run",
    prompt: prompt || intent?.primaryDirective || "",
  };
}

function nextSelectionState(artifact, selectedNodeRef) {
  const selectedNodeId = selectedNodeRef?.split(":")[0];
  const nextNode = getNodeById(artifact, selectedNodeId) || findFirstAttentionNode(artifact);
  const nextChange = nextNode ? findFirstChangeForNode(artifact, nextNode.id) : getProposedChanges(artifact)[0] || null;

  return {
    selectedNodeRef: nextNode ? nodeRevisionKey(nextNode) : null,
    focusChangeId: nextChange?.id || null,
  };
}

function createInterventionChanges(node, kind) {
  const hardConstraints = node?.constraints?.hard || [];

  if (kind === "add-source") {
    return {
      contextPatch: {
        reviewerNote: "Add grounding evidence before approval.",
      },
    };
  }

  if (kind === "tighten") {
    return {
      constraintPatch: {
        hard: [...hardConstraints, "Fresh reviewer confirmation required after intervention."],
      },
    };
  }

  if (kind === "split-node") {
    return {
      title: `${node.title} (split requested)`,
      outputSummary: "Reviewer requested a narrower split before execution.",
    };
  }

  if (kind === "regenerate") {
    return {
      outputSummary: "Reviewer requested regeneration against the latest artifact.",
    };
  }

  if (kind === "require-approval") {
    return {
      approvalRequired: true,
      constraintPatch: {
        hard: [...hardConstraints, "Execution requires an explicit approval gate."],
      },
    };
  }

  return {
    contextPatch: {
      reviewerNote: `Reviewer applied ${kind}.`,
    },
  };
}

function SemantixApp({
  initialScenario = "swe",
  initialPhase = "prompt",
  embedded = false,
  forceTheme,
  forceLayout,
}) {
  const [themeName, setThemeName] = useAS(forceTheme || "light");
  const [layout, setLayout] = useAS(forceLayout || "vertical");
  const [scenarioKey, setScenarioKey] = useAS(initialScenario);
  const [phase, setPhase] = useAS(initialPhase);
  const [runProgress, setRunProgress] = useAS(0);
  const [runSummaries, setRunSummaries] = useAS([]);
  const [currentRunId, setCurrentRunId] = useAS(readRunIdFromLocation() || "");
  const [latestArtifact, setLatestArtifact] = useAS(null);
  const [displayedArtifact, setDisplayedArtifact] = useAS(null);
  const [selectedNodeRef, setSelectedNodeRef] = useAS(null);
  const [focusChangeId, setFocusChangeId] = useAS(null);
  const [approvals, setApprovals] = useAS({});
  const [decisionHints, setDecisionHints] = useAS({});
  const [inspectorCache, setInspectorCache] = useAS({});
  const [inspectorLoading, setInspectorLoading] = useAS(false);
  const [inspectorError, setInspectorError] = useAS(null);
  const [actionError, setActionError] = useAS(null);
  const [actionNotice, setActionNotice] = useAS(null);
  const [busyAction, setBusyAction] = useAS(null);
  const [prompt, setPrompt] = useAS(getScenarioRecordByKey(initialScenario)?.prompt || "");

  const streamRef = useAR(null);
  const refreshTimerRef = useAR(null);
  const isFreshViewRef = useAR(true);

  useAE(() => {
    if (forceTheme) setThemeName(forceTheme);
  }, [forceTheme]);

  useAE(() => {
    if (forceLayout) setLayout(forceLayout);
  }, [forceLayout]);

  useAE(() => {
    setPrompt(getScenarioRecordByKey(scenarioKey)?.prompt || "");
  }, [scenarioKey]);

  const hydratedLatestArtifact = useAM(
    () => hydrateArtifactWithInspectorCache(latestArtifact, inspectorCache),
    [latestArtifact, inspectorCache],
  );
  const hydratedDisplayedArtifact = useAM(
    () => hydrateArtifactWithInspectorCache(displayedArtifact, inspectorCache),
    [displayedArtifact, inspectorCache],
  );

  const isFreshView =
    hydratedDisplayedArtifact?.artifactHash === hydratedLatestArtifact?.artifactHash
    && hydratedDisplayedArtifact?.planVersion === hydratedLatestArtifact?.planVersion
    && hydratedDisplayedArtifact?.graphVersion === hydratedLatestArtifact?.graphVersion;

  useAE(() => {
    isFreshViewRef.current = Boolean(isFreshView);
  }, [isFreshView]);

  const scenario = deriveScenarioLabel(scenarioKey, hydratedLatestArtifact, prompt);

  const selectedNode = useAM(() => {
    if (!hydratedDisplayedArtifact) return null;
    const selectedNodeId = selectedNodeRef?.split(":")[0];
    return getNodeById(hydratedDisplayedArtifact, selectedNodeId) || findFirstAttentionNode(hydratedDisplayedArtifact);
  }, [hydratedDisplayedArtifact, selectedNodeRef]);

  const approvalSummary = useAM(
    () => freshApprovalSummary(hydratedDisplayedArtifact, approvals),
    [hydratedDisplayedArtifact, approvals],
  );
  const staleApprovalCount = useAM(
    () => countStaleApprovals(approvals, hydratedLatestArtifact),
    [approvals, hydratedLatestArtifact],
  );

  function syncSelectionsForArtifact(artifact, preserveSelectedNodeRef = selectedNodeRef) {
    const next = nextSelectionState(artifact, preserveSelectedNodeRef);
    setSelectedNodeRef(next.selectedNodeRef);
    setFocusChangeId(next.focusChangeId);
  }

  function applyFreshArtifact(rawArtifact, { syncDisplay = true, notice = null } = {}) {
    const artifact = decorateArtifact(rawArtifact);
    const nextApprovals = syncApprovalsFromArtifact(artifact, decisionHints);
    setLatestArtifact(artifact);
    setCurrentRunId(artifact.runId);
    writeRunIdToLocation(artifact.runId);
    setApprovals((current) => (syncDisplay ? nextApprovals : { ...current, ...nextApprovals }));
    if (syncDisplay) {
      setDisplayedArtifact(artifact);
      syncSelectionsForArtifact(artifact);
      setPhase(phaseFromArtifact(artifact));
      if (phaseFromArtifact(artifact) === PHASES.done) {
        setRunProgress(getProposedChanges(artifact).length);
      }
    } else {
      setPhase(PHASES.review);
    }
    setActionError(null);
    if (notice != null) {
      setActionNotice(notice);
    }
  }

  async function refreshRunSummaries(preferredRunId) {
    const summaries = await requestJson(`${getApiBase()}/runs`);
    setRunSummaries(summaries);
    if (preferredRunId) {
      const found = summaries.find((entry) => entry.runId === preferredRunId);
      if (found) {
        setCurrentRunId(found.runId);
      }
    }
    return summaries;
  }

  async function loadArtifact(runId, { syncDisplay = true, notice = null } = {}) {
    const artifact = await requestJson(buildRunApiUrl(runId, "/artifact"));
    applyFreshArtifact(artifact, {
      syncDisplay,
      notice,
    });
    return decorateArtifact(artifact);
  }

  function scheduleArtifactRefresh(runId, { syncDisplay } = {}) {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    refreshTimerRef.current = setTimeout(async () => {
      try {
        await loadArtifact(runId, {
          syncDisplay,
        });
        await refreshRunSummaries(runId);
      } catch (error) {
        if (error?.status !== 400 && error?.status !== 404) {
          setActionError(error.message || "Failed to refresh the latest artifact.");
        }
      }
    }, 75);
  }

  async function loadExistingRun(runId) {
    try {
      setBusyAction("load-run");
      setActionError(null);
      setActionNotice(null);
      setInspectorError(null);
      setCurrentRunId(runId);
      writeRunIdToLocation(runId);
      await loadArtifact(runId, {
        syncDisplay: true,
      });
    } catch (error) {
      if (error?.status === 400 || error?.status === 404) {
        setLatestArtifact(null);
        setDisplayedArtifact(null);
        setApprovals({});
        setPhase(PHASES.prompt);
        setActionNotice(`Run ${runId} does not have a compiled review artifact yet.`);
        return;
      }
      setActionError(error.message || `Unable to load run ${runId}.`);
    } finally {
      setBusyAction(null);
    }
  }

  useAE(() => {
    let cancelled = false;

    async function initialize() {
      try {
        const summaries = await refreshRunSummaries();
        if (cancelled) return;

        const preferredRunId = readRunIdFromLocation() || summaries[0]?.runId || ensureRunId("");
        setCurrentRunId(preferredRunId);
        writeRunIdToLocation(preferredRunId);

        const summary = summaries.find((entry) => entry.runId === preferredRunId);
        if (summary?.artifact?.artifactHash) {
          await loadArtifact(preferredRunId, {
            syncDisplay: true,
          });
          return;
        }
      } catch {
        // Fall back to prompt mode with a generated run id.
      }

      if (!cancelled) {
        setCurrentRunId(ensureRunId(readRunIdFromLocation() || ""));
        setPhase(PHASES.prompt);
      }
    }

    initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  useAE(() => {
    if (!currentRunId) return undefined;

    const stream = createEventStream(currentRunId);
    streamRef.current = stream;

    const onRunEvent = (event) => {
      let payload = null;
      try {
        payload = JSON.parse(event.data);
      } catch {
        payload = null;
      }

      if (!payload?.type) return;
      scheduleArtifactRefresh(currentRunId, {
        syncDisplay: isFreshViewRef.current,
      });
    };

    stream.addEventListener("run-event", onRunEvent);
    stream.onerror = () => {
      // Keep the current screen usable; the next user action can rehydrate state.
    };

    return () => {
      stream.removeEventListener("run-event", onRunEvent);
      stream.close();
    };
  }, [currentRunId]);

  useAE(() => {
    if (!currentRunId || !isFreshView || !selectedNode || !hydratedLatestArtifact) {
      return undefined;
    }

    const cacheKey = inspectorCacheKey(currentRunId, selectedNode);
    if (inspectorCache[cacheKey]) {
      setInspectorLoading(false);
      setInspectorError(null);
      return undefined;
    }

    let cancelled = false;
    setInspectorLoading(true);
    setInspectorError(null);
    requestJson(
      buildRunApiUrl(currentRunId, `/nodes/${encodeURIComponent(selectedNode.id)}/inspector`),
    )
      .then((payload) => {
        if (cancelled) return;
        setInspectorCache((current) => ({
          ...current,
          [cacheKey]: normalizeInspectorPayload(hydratedLatestArtifact, payload),
        }));
        setInspectorLoading(false);
      })
      .catch((error) => {
        if (cancelled) return;
        setInspectorLoading(false);
        if (error?.status !== 404) {
          setInspectorError(error.message || `Unable to load inspector payload for ${selectedNode.id}.`);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentRunId, isFreshView, inspectorCache, selectedNodeRef, hydratedLatestArtifact, selectedNode]);

  function selectNode(nodeId) {
    const node = getNodeById(hydratedDisplayedArtifact, nodeId);
    if (!node) return;
    setSelectedNodeRef(nodeRevisionKey(node));
    const firstChange = findFirstChangeForNode(hydratedDisplayedArtifact, node.id);
    if (firstChange) setFocusChangeId(firstChange.id);
  }

  async function compile() {
    const intentPayload = deriveIntentFromPrompt(prompt, getScenarioRecordByKey(scenarioKey));
    const runId = ensureRunId(currentRunId || "");

    setCurrentRunId(runId);
    setPhase(PHASES.compiling);
    setActionError(null);
    setActionNotice(null);
    setBusyAction("compile");

    try {
      const artifact = await requestJson(`${getApiBase()}/runs`, {
        method: "POST",
        body: JSON.stringify({
          runId,
          actor: "browser",
          ...intentPayload,
        }),
      });

      await refreshRunSummaries(runId);
      setApprovals({});
      setDecisionHints({});
      applyFreshArtifact(artifact, {
        syncDisplay: true,
        notice: "Compiled a fresh review artifact from the control plane.",
      });
    } catch (error) {
      setPhase(PHASES.prompt);
      setActionError(error.message || "Failed to compile a review artifact.");
    } finally {
      setBusyAction(null);
    }
  }

  function reopenLatestArtifact() {
    if (!hydratedLatestArtifact) return;
    setDisplayedArtifact(hydratedLatestArtifact);
    syncSelectionsForArtifact(hydratedLatestArtifact, selectedNodeRef);
    setApprovals(syncApprovalsFromArtifact(hydratedLatestArtifact, decisionHints));
    setActionError(null);
    setActionNotice("Re-opened the latest review artifact from backend truth.");
    setPhase(PHASES.review);
  }

  async function submitDecision(changeId, decision) {
    if (!hydratedDisplayedArtifact) return;
    if (!isFreshView) {
      setActionError(formatFreshnessError("This approval", {
        details: {
          currentPlanVersion: hydratedLatestArtifact?.planVersion,
          currentGraphVersion: hydratedLatestArtifact?.graphVersion,
        },
      }));
      return;
    }

    const change = getProposedChanges(hydratedDisplayedArtifact).find((candidate) => candidate.id === changeId);
    if (!change) return;

    const nodeId = getChangeNodeId(hydratedDisplayedArtifact, change);
    const node = getNodeById(hydratedDisplayedArtifact, nodeId);
    const gate = gateForNode(hydratedDisplayedArtifact, nodeId);
    if (!gate) {
      setActionError("No approval gate exists for this proposed change.");
      return;
    }

    const backendAction = decision === "approve" ? "approve" : "reject";
    setBusyAction("approval");

    try {
      const result = await requestJson(buildRunApiUrl(currentRunId, "/approvals"), {
        method: "POST",
        body: JSON.stringify({
          actor: "reviewer",
          action: backendAction,
          gateId: gate.id,
          nodeId: node.id,
          nodeRevision: node.revision,
          planVersion: hydratedDisplayedArtifact.planVersion,
          graphVersion: hydratedDisplayedArtifact.graphVersion,
          artifactHash: hydratedDisplayedArtifact.artifactHash,
          reason:
            decision === "approve"
              ? "Approved from the Semantix browser control surface."
              : "Rejected from the Semantix browser control surface.",
        }),
      });

      const nextArtifact = decorateArtifact(result.artifact);
      setDecisionHints((current) => ({
        ...current,
        [approvalKey(nextArtifact, gate)]: decision,
      }));
      applyFreshArtifact(nextArtifact, {
        syncDisplay: true,
        notice: decision === "approve" ? "Approval recorded by the control plane." : "Rejection recorded by the control plane.",
      });
    } catch (error) {
      if (error?.code === "STALE_STATE") {
        setActionError(formatFreshnessError("This approval", error));
        scheduleArtifactRefresh(currentRunId, {
          syncDisplay: false,
        });
        return;
      }
      setActionError(error.message || "Failed to submit the approval decision.");
    } finally {
      setBusyAction(null);
    }
  }

  function onApprove(changeId) {
    return submitDecision(changeId, "approve");
  }

  function onBlock(changeId) {
    return submitDecision(changeId, "block");
  }

  function onRequireChanges(changeId) {
    return submitDecision(changeId, "changes");
  }

  async function onIntervene(nodeId, kind) {
    if (!hydratedDisplayedArtifact) return;
    const node = getNodeById(hydratedDisplayedArtifact, nodeId);
    if (!node) return;
    setBusyAction("intervention");

    try {
      const latest = await requestJson(
        buildRunApiUrl(currentRunId, `/nodes/${encodeURIComponent(nodeId)}/interventions`),
        {
          method: "POST",
          body: JSON.stringify({
            actor: "reviewer",
            planVersion: hydratedDisplayedArtifact.planVersion,
            graphVersion: hydratedDisplayedArtifact.graphVersion,
            artifactHash: hydratedDisplayedArtifact.artifactHash,
            nodeId,
            nodeRevision: node.revision,
            changes: createInterventionChanges(node, kind),
          }),
        },
      );

      const latestArtifactValue = decorateArtifact(latest);
      const staleArtifact = buildStaleArtifactView(hydratedDisplayedArtifact, latestArtifactValue, nodeId);
      const selection = nextSelectionState(staleArtifact, nodeRevisionKey(node));

      setLatestArtifact(latestArtifactValue);
      setDisplayedArtifact(staleArtifact);
      setApprovals(syncApprovalsFromArtifact(latestArtifactValue, decisionHints));
      setSelectedNodeRef(selection.selectedNodeRef);
      setFocusChangeId(selection.focusChangeId);
      setPhase(PHASES.review);
      setActionNotice(`Applied ${kind} on ${nodeId}. The backend regenerated a fresh artifact.`);
      setActionError(
        `Your current view is now stale. The backend produced artifact ${shortHash(latestArtifactValue.artifactHash)} at plan v${latestArtifactValue.planVersion}. Re-open the latest artifact before approving.`,
      );
      await refreshRunSummaries(currentRunId);
    } catch (error) {
      if (error?.code === "STALE_STATE") {
        setActionError(formatFreshnessError("This intervention", error));
        scheduleArtifactRefresh(currentRunId, {
          syncDisplay: false,
        });
        return;
      }
      setActionError(error.message || "Failed to apply the intervention.");
    } finally {
      setBusyAction(null);
    }
  }

  async function execute() {
    if (!hydratedDisplayedArtifact) return;
    if (!isFreshView) {
      setActionError(formatFreshnessError("Execution", {
        details: {
          currentPlanVersion: hydratedLatestArtifact?.planVersion,
          currentGraphVersion: hydratedLatestArtifact?.graphVersion,
        },
      }));
      return;
    }

    setPhase(PHASES.running);
    setRunProgress(0);
    setActionError(null);
    setBusyAction("execute");

    try {
      let artifact = decorateArtifact(await requestJson(buildRunApiUrl(currentRunId, "/execute"), {
        method: "POST",
        body: JSON.stringify({
          actor: "operator",
        }),
      }));

      applyFreshArtifact(artifact, {
        syncDisplay: true,
      });

      let checkpoint = getLatestCheckpoint(artifact);
      if (artifact.plan.status === "paused" && checkpoint && checkpoint.reason !== "awaiting_approval") {
        artifact = decorateArtifact(await requestJson(buildRunApiUrl(currentRunId, "/resume"), {
          method: "POST",
          body: JSON.stringify({
            actor: "operator",
            checkpointId: checkpoint.id,
            planVersion: artifact.planVersion,
            artifactHash: artifact.artifactHash,
          }),
        }));

        applyFreshArtifact(artifact, {
          syncDisplay: true,
        });
      }

      const nextPhase = phaseFromArtifact(artifact);
      setRunProgress(nextPhase === PHASES.done ? getProposedChanges(artifact).length : 0);
      setPhase(nextPhase);
      await refreshRunSummaries(currentRunId);
    } catch (error) {
      setPhase(PHASES.review);
      if (error?.code === "STALE_STATE") {
        setActionError(formatFreshnessError("Execution", error));
        scheduleArtifactRefresh(currentRunId, {
          syncDisplay: false,
        });
        return;
      }
      setActionError(error.message || "Execution failed.");
    } finally {
      setBusyAction(null);
    }
  }

  function startNewRun() {
    const nextRunId = ensureRunId("");
    setCurrentRunId(nextRunId);
    setLatestArtifact(null);
    setDisplayedArtifact(null);
    setApprovals({});
    setDecisionHints({});
    setInspectorCache({});
    setSelectedNodeRef(null);
    setFocusChangeId(null);
    setActionError(null);
    setActionNotice(null);
    setInspectorError(null);
    setInspectorLoading(false);
    setRunProgress(0);
    setPhase(PHASES.prompt);
    setPrompt(getScenarioRecordByKey(scenarioKey)?.prompt || "");
  }

  const containerStyle = {
    background: THEMES[themeName].bg,
    color: THEMES[themeName].text,
    fontFamily: "Inter, system-ui, sans-serif",
    height: embedded ? "100%" : "100vh",
    width: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    fontSize: 13,
  };
  const t = THEMES[themeName];

  return (
    <div style={containerStyle}>
      <TopBar
        t={t}
        phase={phase}
        scenarioKey={scenarioKey}
        setScenarioKey={setScenarioKey}
        artifact={hydratedLatestArtifact}
        currentRunId={currentRunId}
        runSummaries={runSummaries}
        onSelectRun={loadExistingRun}
        onNewRun={startNewRun}
        themeName={themeName}
        setThemeName={setThemeName}
      />

      {phase === PHASES.prompt && (
        <PromptView
          t={t}
          scenario={scenario}
          prompt={prompt}
          setPrompt={setPrompt}
          onCompile={compile}
          isBusy={busyAction === "compile"}
        />
      )}

      {phase === PHASES.compiling && <CompilingView t={t} scenario={scenario} />}

      {phase === PHASES.review && hydratedDisplayedArtifact && (
        <ReviewView
          t={t}
          scenario={scenario}
          artifact={hydratedDisplayedArtifact}
          latestArtifact={hydratedLatestArtifact}
          layout={layout}
          setLayout={setLayout}
          selectedNode={selectedNode}
          selectedNodeRef={selectedNodeRef}
          onSelectNode={selectNode}
          focusChangeId={focusChangeId}
          setFocusChangeId={setFocusChangeId}
          approvals={approvals}
          onApprove={onApprove}
          onBlock={onBlock}
          onReqChanges={onRequireChanges}
          onIntervene={onIntervene}
          onExecute={execute}
          runState="review"
          actionError={actionError}
          actionNotice={actionNotice}
          onReopenLatest={reopenLatestArtifact}
          isFreshView={isFreshView}
          staleApprovalCount={staleApprovalCount}
          approvalSummary={approvalSummary}
          inspectorPayload={selectedNode ? inspectorCache[inspectorCacheKey(currentRunId, selectedNode)] || null : null}
          inspectorLoading={inspectorLoading}
          inspectorError={inspectorError}
          busyAction={busyAction}
        />
      )}

      {phase === PHASES.running && hydratedLatestArtifact && (
        <RunningView t={t} artifact={hydratedLatestArtifact} progress={runProgress} approvals={approvals} />
      )}

      {phase === PHASES.done && hydratedLatestArtifact && (
        <DoneView
          t={t}
          scenario={scenario}
          artifact={hydratedLatestArtifact}
          approvals={approvals}
          onNewRun={startNewRun}
        />
      )}
    </div>
  );
}

function TopBar({
  t,
  phase,
  scenarioKey,
  setScenarioKey,
  artifact,
  currentRunId,
  runSummaries,
  onSelectRun,
  onNewRun,
  themeName,
  setThemeName,
}) {
  const phaseLabels = {
    prompt: "New run",
    compiling: "Compiling review artifact",
    review: "Pending review",
    running: "Executing approved work",
    done: "Run complete",
  };
  const phaseColors = {
    prompt: t.textDim,
    compiling: t.info,
    review: t.orange,
    running: t.accent,
    done: t.green,
  };

  return (
    <div
      style={{
        height: 52,
        flexShrink: 0,
        borderBottom: `1px solid ${t.border}`,
        background: t.panel,
        display: "flex",
        alignItems: "center",
        padding: "0 16px",
        gap: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 7,
            background: `linear-gradient(135deg, ${t.accent}, ${t.accent}bb)`,
            display: "grid",
            placeItems: "center",
            color: "#fff",
          }}
        >
          <Icon.Check />
        </div>
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: -0.1 }}>Semantix</span>
        <span style={{ fontSize: 11, color: t.textFaint, fontFamily: "ui-monospace, Menlo, monospace" }}>
          control surface
        </span>
      </div>

      <div style={{ width: 1, height: 20, background: t.border }} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: phaseColors[phase] }} />
        <span style={{ color: t.textDim }}>{phaseLabels[phase]}</span>
        <span style={{ color: t.textFaint }}>·</span>
        <span style={{ color: t.textFaint, fontFamily: "ui-monospace, Menlo, monospace" }}>
          {artifact?.runId || currentRunId || "run_pending"}
        </span>
      </div>

      <div style={{ flex: 1 }} />

      {phase === PHASES.prompt && (
        <div style={{ display: "flex", gap: 2, background: t.panelAlt, borderRadius: 7, padding: 2, border: `1px solid ${t.border}` }}>
          {Object.values(window.SEMANTIX_SCENARIOS || {}).map((item) => (
            <button
              key={item.key}
              onClick={() => setScenarioKey(item.key)}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                padding: "5px 10px",
                borderRadius: 5,
                background: scenarioKey === item.key ? t.panel : "transparent",
                color: scenarioKey === item.key ? t.text : t.textDim,
                border: "none",
                cursor: "pointer",
                boxShadow: scenarioKey === item.key ? t.shadow : "none",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {runSummaries.length > 0 && (
        <select
          value={currentRunId || ""}
          onChange={(event) => onSelectRun(event.target.value)}
          style={{
            maxWidth: 220,
            fontSize: 11.5,
            padding: "6px 8px",
            borderRadius: 8,
            border: `1px solid ${t.border}`,
            background: t.panel,
            color: t.text,
          }}
        >
          {runSummaries.map((summary) => (
            <option key={summary.runId} value={summary.runId}>
              {summary.runId}
            </option>
          ))}
        </select>
      )}

      <Btn t={t} variant="ghost" icon={<Icon.Spark />} onClick={onNewRun}>
        New run
      </Btn>

      <button
        onClick={() => setThemeName(themeName === "light" ? "dark" : "light")}
        style={{
          width: 30,
          height: 30,
          borderRadius: 7,
          border: `1px solid ${t.border}`,
          background: t.panel,
          color: t.textDim,
          cursor: "pointer",
          display: "grid",
          placeItems: "center",
        }}
        title="Toggle theme"
      >
        {themeName === "light" ? (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12.8A9 9 0 0111.2 3a7 7 0 109.8 9.8z" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
          </svg>
        )}
      </button>
    </div>
  );
}

Object.assign(window, {
  SemantixApp,
  TopBar,
  PHASES,
});
