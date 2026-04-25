const { useState: useAS, useEffect: useAE, useMemo: useAM, useRef: useAR } = React;

const PHASES = {
  prompt: "prompt",
  compiling: "compiling",
  review: "review",
  running: "running",
  done: "done",
};

const DEFAULT_PROMPT = "tell me a sad and not funny joke that will make me laugh";

function findFirstAttentionNode(artifact) {
  const nodes = getNodes(artifact);
  return nodes.find((node) => {
    const risk = resolveRiskFromNode(node);
    return risk === "orange" || risk === "red";
  }) || getPrimaryReviewNode(artifact);
}

function findFirstChangeForNode(artifact, nodeId) {
  return getDisplayableProposedChanges(artifact).find((change) => getChangeNodeId(artifact, change) === nodeId) || null;
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
  getDisplayableProposedChanges(artifact).forEach((change) => {
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
  const changes = getDisplayableProposedChanges(artifact).filter((change) => (change.policyState || change.policy) !== "block");
  const approved = changes.filter((change) => approvalEntryIsFresh(approvals[change.id], artifact)).length;
  return {
    approvableCount: changes.length,
    approvedCount: approved,
    allApproved: changes.length > 0 && approved === changes.length,
  };
}

function deriveScenarioLabel(scenarioKey, artifact, prompt) {
  const intent = getIntent(artifact);
  if (intent?.primaryDirective) {
    return {
      key: "live",
      label: "Live run",
      prompt: intent.primaryDirective,
    };
  }

  const scenario = getScenarioRecordByKey(scenarioKey);
  if (scenario && prompt === scenario.prompt) return scenario;

  return {
    key: "live",
    label: "Live run",
    prompt: prompt || "",
  };
}

function nextSelectionState(artifact, selectedNodeRef) {
  const selectedNodeId = selectedNodeRef?.split(":")[0];
  const nextNode = getNodeById(artifact, selectedNodeId) || findFirstAttentionNode(artifact);
  const nextChange = nextNode ? findFirstChangeForNode(artifact, nextNode.id) : getDisplayableProposedChanges(artifact)[0] || null;

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
  const [reviewMode, setReviewMode] = useAS("simple");
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
  const [previewCache, setPreviewCache] = useAS({});
  const [flowProjection, setFlowProjection] = useAS(null);
  const [inspectorLoading, setInspectorLoading] = useAS(false);
  const [inspectorError, setInspectorError] = useAS(null);
  const [actionError, setActionError] = useAS(null);
  const [actionNotice, setActionNotice] = useAS(null);
  const [busyAction, setBusyAction] = useAS(null);
  const [prompt, setPrompt] = useAS(DEFAULT_PROMPT);
  const [activeFlowStep, setActiveFlowStep] = useAS(1);

  const streamRef = useAR(null);
  const refreshTimerRef = useAR(null);
  const isFreshViewRef = useAR(true);

  useAE(() => {
    if (forceTheme) setThemeName(forceTheme);
  }, [forceTheme]);

  const graphLayout = forceLayout || "vertical";

  const hydratedLatestArtifact = useAM(
    () => hydrateArtifactWithInspectorCache(latestArtifact, inspectorCache, previewCache),
    [latestArtifact, inspectorCache, previewCache],
  );
  const hydratedDisplayedArtifact = useAM(
    () => hydrateArtifactWithInspectorCache(displayedArtifact, inspectorCache, previewCache),
    [displayedArtifact, inspectorCache, previewCache],
  );

  const isFreshView =
    hydratedDisplayedArtifact?.artifactHash === hydratedLatestArtifact?.artifactHash
    && hydratedDisplayedArtifact?.planVersion === hydratedLatestArtifact?.planVersion
    && hydratedDisplayedArtifact?.graphVersion === hydratedLatestArtifact?.graphVersion;

  useAE(() => {
    isFreshViewRef.current = Boolean(isFreshView);
  }, [isFreshView]);

  useAE(() => {
    if (!currentRunId || !hydratedLatestArtifact) {
      return undefined;
    }

    const missingPreviewRefs = getDisplayableProposedChanges(hydratedLatestArtifact)
      .map((change) => change.previewRef)
      .filter((previewRef) => previewRef && !previewCache[previewRef]);

    if (missingPreviewRefs.length === 0) {
      return undefined;
    }

    let cancelled = false;

    Promise.all(
      missingPreviewRefs.map(async (previewRef) => {
        try {
          return await requestJson(buildPreviewApiUrl(currentRunId, previewRef));
        } catch {
          return null;
        }
      }),
    ).then((records) => {
      if (cancelled) {
        return;
      }

      const nextRecords = records.filter((record) => record?.previewRef);
      if (nextRecords.length === 0) {
        return;
      }

      setPreviewCache((current) => ({
        ...current,
        ...Object.fromEntries(
          nextRecords.map((record) => [
            record.previewRef,
            {
              content: record.content,
              mediaType: record.mediaType,
              artifactHash: record.artifactHash,
              planVersion: record.planVersion,
              graphVersion: record.graphVersion,
            },
          ]),
        ),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [currentRunId, hydratedLatestArtifact, previewCache]);

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
    const artifact = decorateArtifact(rawArtifact, previewCache);
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
        setRunProgress(getDisplayableProposedChanges(artifact).length);
      }
    } else {
      setPhase(PHASES.review);
    }
    setActionError(null);
    if (notice != null) {
      setActionNotice(notice);
    }
  }

  async function refreshFlowProjection(runId) {
    if (!runId) return null;
    try {
      const flow = await requestJson(buildRunApiUrl(runId, "/flow"));
      setFlowProjection(flow);
      return flow;
    } catch {
      return null;
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

  async function loadArtifact(runId, { syncDisplay = true, notice = null, syncFlowStep = false } = {}) {
    const artifact = await requestJson(buildRunApiUrl(runId, "/artifact"));
    applyFreshArtifact(artifact, {
      syncDisplay,
      notice,
    });
    const flow = await refreshFlowProjection(runId);
    if (syncFlowStep) {
      setActiveFlowStep(recommendedFlowStep({ flow, phase: phaseFromArtifact(artifact) }));
    }
    return decorateArtifact(artifact, previewCache);
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
        syncFlowStep: true,
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

        const locationRunId = readRunIdFromLocation();
        if (!locationRunId) {
          const freshRunId = ensureRunId("", { reuseLocation: false });
          setCurrentRunId(freshRunId);
          setPhase(PHASES.prompt);
          return;
        }

        const preferredRunId = locationRunId;
        setCurrentRunId(preferredRunId);
        writeRunIdToLocation(preferredRunId);

        const summary = summaries.find((entry) => entry.runId === preferredRunId);
        if (summary?.artifact?.artifactHash) {
          await loadArtifact(preferredRunId, {
            syncDisplay: true,
            syncFlowStep: true,
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
          [cacheKey]: normalizeInspectorPayload(hydratedLatestArtifact, payload, previewCache),
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
  }, [currentRunId, isFreshView, inspectorCache, previewCache, selectedNodeRef, hydratedLatestArtifact, selectedNode]);

  function selectNode(nodeId) {
    const node = getNodeById(hydratedDisplayedArtifact, nodeId);
    if (!node) return;
    setSelectedNodeRef(nodeRevisionKey(node));
    const firstChange = findFirstChangeForNode(hydratedDisplayedArtifact, node.id);
    if (firstChange) setFocusChangeId(firstChange.id);
  }

  async function compile() {
    const intentPayload = deriveIntentFromPrompt(prompt, getScenarioRecordByKey(scenarioKey));
    const currentRunIsCompiled =
      (latestArtifact?.runId === currentRunId && latestArtifact?.artifactHash)
      || runSummaries.some(
        (entry) => entry.runId === currentRunId && entry.artifact?.artifactHash,
      );
    const runId = currentRunIsCompiled
      ? ensureRunId("", { reuseLocation: false })
      : ensureRunId(currentRunId || "");

    setCurrentRunId(runId);
    setPhase(PHASES.compiling);
    setActiveFlowStep(2);
    setActionError(null);
    setActionNotice(null);
    setBusyAction("compile");

    try {
      const flow = await requestJson(`${getApiBase()}/codex/runs`, {
        method: "POST",
        body: JSON.stringify({
          runId,
          actor: "browser",
          ...intentPayload,
        }),
      });
      setFlowProjection(flow);

      const artifact = await requestJson(buildRunApiUrl(flow.runId || runId, "/artifact"));

      await refreshRunSummaries(flow.runId || runId);
      setApprovals({});
      setDecisionHints({});
      applyFreshArtifact(artifact, {
        syncDisplay: true,
        notice: "Codex generated a Semantix-reviewed proposal and paused at the control gate.",
      });
      setActiveFlowStep(recommendedFlowStep({ flow, phase: phaseFromArtifact(artifact) }));
    } catch (error) {
      if (error?.status === 400 && runId) {
        try {
          await loadArtifact(runId, {
            syncDisplay: true,
            syncFlowStep: true,
          });
        } catch {
          setPhase(PHASES.prompt);
        }
      } else {
        setPhase(PHASES.prompt);
      }
      setActionError(error.message || "Failed to compile a review artifact.");
    } finally {
      setBusyAction(null);
    }
  }

  async function applyRecommendedFlowFix() {
    if (!currentRunId || !flowProjection) return;
    const issue = flowProjection.issues?.[0] || null;
    const recommendation = flowProjection.recommendations?.[0] || issue?.fixOptions?.find((option) => option.recommended) || issue?.fixOptions?.[0] || null;

    setActiveFlowStep(7);
    setBusyAction("fix");
    setActionError(null);
    setActionNotice(null);

    try {
      const flow = await requestJson(buildRunApiUrl(currentRunId, "/flow/fixes"), {
        method: "POST",
        body: JSON.stringify({
          actor: "reviewer",
          issueCode: issue?.code,
          issueId: issue?.id,
          symbol: issue?.affectedSymbols?.[0],
          action: recommendation?.action,
          fixOptionId: recommendation?.id,
          note: issue?.summary || recommendation?.label,
        }),
      });
      setFlowProjection(flow);

      const artifact = await requestJson(buildRunApiUrl(flow.runId || currentRunId, "/artifact"));
      setApprovals({});
      setDecisionHints({});
      applyFreshArtifact(artifact, {
        syncDisplay: true,
        notice: "Applied the selected fix and re-ran Codex through Semantix validation.",
      });
      setActiveFlowStep(8);
      await refreshRunSummaries(flow.runId || currentRunId);
    } catch (error) {
      setActionError(error.message || "Failed to apply the selected fix.");
    } finally {
      setBusyAction(null);
    }
  }

  async function approveAndRunFlow() {
    if (!currentRunId || !hydratedDisplayedArtifact) return;
    setActiveFlowStep(11);
    setPhase(PHASES.running);
    setRunProgress(0);
    setBusyAction("execute");
    setActionError(null);
    setActionNotice(null);

    try {
      const flow = await requestJson(buildRunApiUrl(currentRunId, "/flow/approve"), {
        method: "POST",
        body: JSON.stringify({
          actor: "reviewer",
          reason: "Approved from the Semantix demo flow.",
        }),
      });
      setFlowProjection(flow);

      const artifact = await requestJson(buildRunApiUrl(flow.runId || currentRunId, "/artifact"));
      applyFreshArtifact(artifact, {
        syncDisplay: true,
        notice: "Approved and executed through the Semantix flow.",
      });
      setActiveFlowStep(flow?.result?.completed ? 12 : 11);
      await refreshRunSummaries(flow.runId || currentRunId);
    } catch (error) {
      setPhase(PHASES.review);
      setActiveFlowStep(10);
      if (error?.code === "STALE_STATE") {
        setActionError(formatFreshnessError("Approval", error));
        scheduleArtifactRefresh(currentRunId, {
          syncDisplay: false,
        });
        return;
      }
      setActionError(error.message || "Approval or execution failed.");
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

    const change = getDisplayableProposedChanges(hydratedDisplayedArtifact).find((candidate) => candidate.id === changeId);
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
              ? "Approved from the Semantix demo flow."
              : "Rejected from the Semantix demo flow.",
        }),
      });

      const nextArtifact = decorateArtifact(result.artifact, previewCache);
      setDecisionHints((current) => ({
        ...current,
        [approvalKey(nextArtifact, gate)]: decision,
      }));
      applyFreshArtifact(nextArtifact, {
        syncDisplay: true,
        notice: decision === "approve" ? "Approval recorded by the control plane." : "Rejection recorded by the control plane.",
      });
      await refreshFlowProjection(currentRunId);
      await refreshRunSummaries(currentRunId);
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
    return applyFixForChange(changeId);
  }

  async function applyFixForChange(changeId) {
    if (!hydratedDisplayedArtifact) return;
    if (!isFreshView) {
      setActionError(formatFreshnessError("This fix", {
        details: {
          currentPlanVersion: hydratedLatestArtifact?.planVersion,
          currentGraphVersion: hydratedLatestArtifact?.graphVersion,
        },
      }));
      return;
    }

    const change = getDisplayableProposedChanges(hydratedDisplayedArtifact).find((candidate) => candidate.id === changeId);
    if (!change) return;

    const nodeId = getChangeNodeId(hydratedDisplayedArtifact, change);
    const node = getNodeById(hydratedDisplayedArtifact, nodeId);
    const primaryIssue = asArray(change.issues)[0] || {};
    const symbol = asArray(primaryIssue.affectedSymbols)[0] || asArray(change.affectedSymbols)[0] || "";

    setBusyAction("fix");
    setActionError(null);
    setActionNotice(null);

    try {
      const flow = await requestJson(buildRunApiUrl(currentRunId, "/flow/fixes"), {
        method: "POST",
        body: JSON.stringify({
          actor: "reviewer",
          action: "regenerate_with_constraints",
          changeId,
          nodeId: node?.id,
          nodeRevision: node?.revision,
          planVersion: hydratedDisplayedArtifact.planVersion,
          graphVersion: hydratedDisplayedArtifact.graphVersion,
          artifactHash: hydratedDisplayedArtifact.artifactHash,
          issueCode: primaryIssue.type || primaryIssue.code || change.issueCode || "review_issue",
          symbol,
          message: primaryIssue.message || primaryIssue.summary || change.issueSummary || change.summary,
        }),
      });
      setFlowProjection(flow);

      const artifact = await requestJson(buildRunApiUrl(flow.runId || currentRunId, "/artifact"));
      setApprovals({});
      setDecisionHints({});
      applyFreshArtifact(artifact, {
        syncDisplay: true,
        notice: "Applied the selected fix and re-ran Codex through Semantix validation.",
      });
      await refreshRunSummaries(flow.runId || currentRunId);
    } catch (error) {
      if (error?.code === "STALE_STATE") {
        setActionError(formatFreshnessError("This fix", error));
        scheduleArtifactRefresh(currentRunId, {
          syncDisplay: false,
        });
        return;
      }
      setActionError(error.message || "Failed to apply the selected fix.");
    } finally {
      setBusyAction(null);
    }
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

      const latestArtifactValue = decorateArtifact(latest, previewCache);
      const staleArtifact = buildStaleArtifactView(
        hydratedDisplayedArtifact,
        latestArtifactValue,
        nodeId,
        previewCache,
      );
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
      await refreshFlowProjection(currentRunId);
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
      }), previewCache);

      applyFreshArtifact(artifact, {
        syncDisplay: true,
      });

      let checkpoint = getLatestCheckpoint(artifact);
      const canResumeCheckpoint =
        checkpoint
        && !["awaiting_approval", "awaiting_issue_resolution", "awaiting_semantic_admission"].includes(checkpoint.reason);
      if (artifact.plan.status === "paused" && canResumeCheckpoint) {
        artifact = decorateArtifact(await requestJson(buildRunApiUrl(currentRunId, "/resume"), {
          method: "POST",
          body: JSON.stringify({
            actor: "operator",
            checkpointId: checkpoint.id,
            planVersion: artifact.planVersion,
            artifactHash: artifact.artifactHash,
          }),
        }), previewCache);

        applyFreshArtifact(artifact, {
          syncDisplay: true,
        });
      }

      const nextPhase = phaseFromArtifact(artifact);
      setRunProgress(nextPhase === PHASES.done ? getDisplayableProposedChanges(artifact).length : 0);
      setPhase(nextPhase);
      await refreshFlowProjection(currentRunId);
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
    const nextRunId = ensureRunId("", { reuseLocation: false });
    setCurrentRunId(nextRunId);
    setLatestArtifact(null);
    setDisplayedArtifact(null);
    setApprovals({});
    setDecisionHints({});
    setInspectorCache({});
    setPreviewCache({});
    setSelectedNodeRef(null);
    setFocusChangeId(null);
    setFlowProjection(null);
    setActionError(null);
    setActionNotice(null);
    setInspectorError(null);
    setInspectorLoading(false);
    setRunProgress(0);
    setPhase(PHASES.prompt);
    setActiveFlowStep(1);
    setPrompt(DEFAULT_PROMPT);
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
      <FlowExperience
        t={t}
        themeName={themeName}
        setThemeName={setThemeName}
        phase={phase}
        flow={flowProjection}
        artifact={hydratedDisplayedArtifact || hydratedLatestArtifact}
        latestArtifact={hydratedLatestArtifact}
        currentRunId={currentRunId}
        runSummaries={runSummaries}
        onSelectRun={loadExistingRun}
        onNewRun={startNewRun}
        prompt={prompt}
        setPrompt={setPrompt}
        activeStep={activeFlowStep}
        setActiveStep={setActiveFlowStep}
        onCompile={compile}
        onApplyFix={applyRecommendedFlowFix}
        onApproveAndRun={approveAndRunFlow}
        busyAction={busyAction}
        actionError={actionError}
        actionNotice={actionNotice}
      />
    </div>
  );
}

const FLOW_STORY_STEPS = [
  { id: 1, label: "Input", time: "0:00 - 0:05", caption: "Enter the outcome and start the run." },
  { id: 2, label: "Fast Classification", time: "0:05 - 0:07", caption: "Semantix classifies risk, effort, and constraints first." },
  { id: 3, label: "Plan Appears", time: "0:07 - 0:10", caption: "A plan is compiled before execution is possible." },
  { id: 4, label: "Issue Detection", time: "0:10 - 0:15", caption: "Problems are surfaced before any state change becomes real." },
  { id: 5, label: "Effort Indicator", time: "0:15 - 0:18", caption: "The run explains how much reasoning was required." },
  { id: 6, label: "Why? Explanation", time: "0:18 - 0:25", caption: "Evidence and boundaries explain the classification." },
  { id: 7, label: "Fix Issues", time: "0:25 - 0:40", caption: "The user picks the next fix instead of approving blindly." },
  { id: 8, label: "Re-evaluation", time: "0:40 - 0:45", caption: "Semantix re-checks the artifact after a fix." },
  { id: 9, label: "Advanced View", time: "0:45 - 1:05", caption: "Detailed graph and node data remain available on demand." },
  { id: 10, label: "Approval", time: "1:05 - 1:15", caption: "Fresh approval is recorded only when the artifact is ready." },
  { id: 11, label: "Execution", time: "1:15 - 1:25", caption: "Approved work executes through the deterministic boundary." },
  { id: 12, label: "Result", time: "1:25 - 1:30", caption: "The final state shows material effects, not mock success." },
];

function flowStoryStep(flow, stepId) {
  return flow?.steps?.find((step) => Number(step.id) === Number(stepId)) || null;
}

function inferMaxReachableFlowStep({ flow, phase }) {
  if (phase === PHASES.prompt) return 1;
  if (phase === PHASES.compiling) return 2;
  if (!flow) return 1;

  const touchedStepIds = (flow.steps || [])
    .filter((step) => !["pending", "not_started"].includes(step.status))
    .map((step) => Number(step.id))
    .filter(Number.isFinite);
  let maxStep = Math.max(3, ...touchedStepIds);

  if (flow.result?.completed || phase === PHASES.done) maxStep = 12;
  else if (flow.execution?.status === "running" || phase === PHASES.running) maxStep = Math.max(maxStep, 11);
  else if (flow.approval?.ready || flow.approval?.approved) maxStep = Math.max(maxStep, 10);
  else if ((flow.issues || []).length > 0) maxStep = Math.max(maxStep, 9);

  return Math.max(1, Math.min(12, maxStep));
}

function recommendedFlowStep({ flow, phase }) {
  if (phase === PHASES.prompt) return 1;
  if (phase === PHASES.compiling) return 2;
  if (!flow) return 3;
  if (flow.result?.completed || phase === PHASES.done) return 12;
  if (flow.execution?.status === "running" || phase === PHASES.running) return 11;
  if ((flow.issues || []).length > 0 || flow.approval?.blocked) return 4;
  if (flow.approval?.ready) return 10;
  if ((flow.steps || []).find((step) => Number(step.id) === 4)?.status === "pending") return 3;
  return 3;
}

function flowStepStatus(flow, phase, stepId) {
  if (stepId === 1) return phase === PHASES.prompt ? "active" : "complete";
  if (stepId === 2 && phase === PHASES.compiling) return "running";
  if (stepId === 2 && (flow?.plan?.items || []).some((item) => item.nodeType === "semantic_generation" && item.status === "running")) {
    return "running";
  }
  return flowStoryStep(flow, stepId)?.status || "pending";
}

function flowStoryTone(status, isActive) {
  if (isActive) return "info";
  if (status === "complete" || status === "available") return "green";
  if (status === "blocked" || status === "required" || status === "failed") return "red";
  if (status === "warning" || status === "ready" || status === "running") return "orange";
  return "yellow";
}

function flowText(...values) {
  return firstFlowText(...values);
}

function compactFlowLine(value, fallback = "") {
  const text = flowText(value, fallback);
  return text.length > 150 ? `${text.slice(0, 147)}...` : text;
}

function FlowExperience({
  t,
  themeName,
  setThemeName,
  phase,
  flow,
  artifact,
  latestArtifact,
  currentRunId,
  runSummaries,
  onSelectRun,
  onNewRun,
  prompt,
  setPrompt,
  activeStep,
  setActiveStep,
  onCompile,
  onApplyFix,
  onApproveAndRun,
  busyAction,
  actionError,
  actionNotice,
}) {
  const maxReachableStep = inferMaxReachableFlowStep({ flow, phase });
  const visibleStepId = Math.max(1, Math.min(activeStep, maxReachableStep));
  const step = FLOW_STORY_STEPS.find((entry) => entry.id === visibleStepId) || FLOW_STORY_STEPS[0];
  const backendStep = flowStoryStep(flow, step.id);
  const status = flowStepStatus(flow, phase, step.id);
  const tone = flowStoryTone(status, true);
  const token = RISK_TOKEN(t, tone);
  const intent = getIntent(artifact) || flow?.input || {};
  const title = step.id === 1
    ? "What would you like Semantix to compile?"
    : step.label;

  return (
    <div style={{ minHeight: 0, flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <FlowHeader
        t={t}
        themeName={themeName}
        setThemeName={setThemeName}
        phase={phase}
        flow={flow}
        currentRunId={currentRunId}
        runSummaries={runSummaries}
        onSelectRun={onSelectRun}
        onNewRun={onNewRun}
      />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "grid",
          gridTemplateColumns: "220px minmax(0, 1fr)",
          gap: 18,
          padding: 22,
          overflow: "hidden",
        }}
      >
        <FlowStepRail
          t={t}
          flow={flow}
          phase={phase}
          activeStep={visibleStepId}
          maxReachableStep={maxReachableStep}
          setActiveStep={setActiveStep}
        />

        <main
          style={{
            minWidth: 0,
            minHeight: 0,
            display: "grid",
            gridTemplateRows: "auto minmax(0, 1fr) auto",
            gap: 14,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 8, flexWrap: "wrap" }}>
              <Pill t={t} risk={tone} strong>{formatFlowStatus(status)}</Pill>
              {flow?.classification?.confidenceScore != null ? (
                <Pill t={t}>{Math.round(flow.classification.confidenceScore * 100)}% confidence</Pill>
              ) : null}
              {flow?.artifact?.artifactHash ? <Pill t={t}>hash:{shortHash(flow.artifact.artifactHash)}</Pill> : null}
            </div>
            <h1 style={{ margin: 0, color: t.text, fontSize: 30, lineHeight: 1.08, letterSpacing: -0.4 }}>
              {title}
            </h1>
            <div style={{ marginTop: 8, color: t.textDim, fontSize: 13.5, lineHeight: 1.5, maxWidth: 760 }}>
              {step.caption}
            </div>
          </div>

          <section
            style={{
              minHeight: 0,
              overflow: "auto",
              background: t.panel,
              border: `1px solid ${token.fg}55`,
              borderRadius: 12,
              boxShadow: t.shadowLg,
              padding: 18,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 14, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: t.text }}>
                <span style={{ color: t.textFaint, marginRight: 4 }}>{step.id}.</span>{step.label}
              </div>
              <div style={{ color: t.textFaint, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }}>
                {step.time}
              </div>
            </div>

            <FlowStepBody
              t={t}
              stepId={step.id}
              flow={flow}
              artifact={artifact}
              latestArtifact={latestArtifact}
              intent={intent}
              prompt={prompt}
              setPrompt={setPrompt}
              onCompile={onCompile}
              onApplyFix={onApplyFix}
              onApproveAndRun={onApproveAndRun}
              setActiveStep={setActiveStep}
              busyAction={busyAction}
              status={backendStep?.status || status}
            />
          </section>

          <div style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 34 }}>
            <Btn
              t={t}
              variant="solid"
              onClick={() => setActiveStep(Math.max(1, visibleStepId - 1))}
              disabled={visibleStepId <= 1}
            >
              Back
            </Btn>
            <Btn
              t={t}
              variant="primary"
              onClick={() => setActiveStep(Math.min(maxReachableStep, visibleStepId + 1))}
              disabled={visibleStepId >= maxReachableStep}
            >
              Next
            </Btn>
            <div style={{ flex: 1 }} />
            {actionNotice ? <span style={{ color: t.green, fontSize: 12 }}>{actionNotice}</span> : null}
            {actionError ? <span style={{ color: t.red, fontSize: 12 }}>{actionError}</span> : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function FlowHeader({
  t,
  themeName,
  setThemeName,
  phase,
  flow,
  currentRunId,
  runSummaries,
  onSelectRun,
  onNewRun,
}) {
  return (
    <header
      style={{
        flexShrink: 0,
        borderBottom: `1px solid ${t.border}`,
        background: t.panel,
        padding: "16px 22px",
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        gap: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <div
          style={{
            width: 34,
            height: 34,
            border: `1.5px solid ${t.text}`,
            borderRadius: 8,
            display: "grid",
            placeItems: "center",
            fontWeight: 800,
            color: t.text,
          }}
        >
          S
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: t.text, fontSize: 16 }}>Semantix</div>
          <div style={{ color: t.textFaint, fontSize: 11, fontFamily: "ui-monospace, Menlo, monospace" }}>
            v0.5 Demo Flow
          </div>
        </div>
      </div>

      <div style={{ textAlign: "center", fontWeight: 800, color: t.text, fontSize: 17, whiteSpace: "nowrap" }}>
        Stop Guessing <span style={{ color: t.accent }}>Before</span> It Acts.
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "flex-end", minWidth: 0 }}>
        <Pill t={t} risk={flowPhaseTone(flow?.phase || phase)}>
          {formatFlowStatus(flow?.phase || phase)}
        </Pill>
        {runSummaries.length > 0 ? (
          <select
            value={currentRunId || ""}
            onChange={(event) => onSelectRun(event.target.value)}
            style={{
              maxWidth: 190,
              fontSize: 11.5,
              padding: "7px 8px",
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
        ) : null}
        <Btn t={t} variant="solid" icon={<Icon.Spark />} onClick={onNewRun}>New run</Btn>
        <button
          onClick={() => setThemeName(themeName === "light" ? "dark" : "light")}
          style={{
            width: 32,
            height: 32,
            borderRadius: 999,
            border: `1px solid ${t.border}`,
            background: t.panel,
            color: t.textDim,
            cursor: "pointer",
            display: "grid",
            placeItems: "center",
          }}
          title="Toggle theme"
        >
          {themeName === "light" ? "Dark" : "Light"}
        </button>
      </div>
    </header>
  );
}

function FlowStepRail({ t, flow, phase, activeStep, maxReachableStep, setActiveStep }) {
  return (
    <aside
      style={{
        minHeight: 0,
        overflow: "auto",
        background: t.panel,
        border: `1px solid ${t.border}`,
        borderRadius: 12,
        padding: 10,
      }}
    >
      <div style={{ fontSize: 11, color: t.textFaint, letterSpacing: 1, textTransform: "uppercase", margin: "2px 6px 9px" }}>
        Flow
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {FLOW_STORY_STEPS.map((step) => {
          const locked = step.id > maxReachableStep;
          const active = step.id === activeStep;
          const status = flowStepStatus(flow, phase, step.id);
          const tone = flowStoryTone(status, active);
          const token = RISK_TOKEN(t, locked ? "" : tone);
          return (
            <button
              key={step.id}
              onClick={() => !locked && setActiveStep(step.id)}
              disabled={locked}
              style={{
                border: `1px solid ${active ? token.fg : "transparent"}`,
                background: active ? token.bg : "transparent",
                color: locked ? t.textFaint : t.text,
                opacity: locked ? 0.45 : 1,
                cursor: locked ? "not-allowed" : "pointer",
                borderRadius: 8,
                padding: "8px 8px",
                display: "grid",
                gridTemplateColumns: "20px minmax(0, 1fr)",
                gap: 7,
                textAlign: "left",
                fontFamily: "inherit",
              }}
            >
              <span
                style={{
                  width: 18,
                  height: 18,
                  borderRadius: 999,
                  display: "grid",
                  placeItems: "center",
                  background: active ? token.fg : t.panelAlt,
                  color: active ? "#fff" : token.fg,
                  fontSize: 10,
                  fontWeight: 800,
                }}
              >
                {step.id}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12, fontWeight: active ? 800 : 650, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {step.label}
                </span>
                <span style={{ display: "block", color: locked ? t.textFaint : token.fg, fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.4 }}>
                  {locked ? "locked" : formatFlowStatus(status)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

function FlowStepBody({
  t,
  stepId,
  flow,
  artifact,
  latestArtifact,
  intent,
  prompt,
  setPrompt,
  onCompile,
  onApplyFix,
  onApproveAndRun,
  setActiveStep,
  busyAction,
  status,
}) {
  const classification = flow?.classification || {};
  const issues = flow?.issues || [];
  const analysis = flow?.analysis || {};
  const recommendations = flow?.recommendations || [];
  const approval = flow?.approval || {};
  const result = flow?.result || {};
  const planItems = flow?.plan?.items?.length
    ? flow.plan.items
    : getNodes(artifact).map((node, index) => ({ id: node.id || `node-${index}`, title: node.title || node.id || `Step ${index + 1}` }));
  const nodes = flow?.advanced?.graph?.nodes || getNodes(artifact);
  const stateEffects = result.stateEffects?.length
    ? result.stateEffects
    : getDisplayableProposedChanges(artifact);
  const advisoryChanges = getAdvisoryProposedChanges(artifact);
  const firstIssue = issues[0] || null;
  const firstRecommendation = recommendations[0] || firstIssue?.fixOptions?.find((option) => option.recommended) || firstIssue?.fixOptions?.[0] || null;
  const confidence = Math.round((classification.confidenceScore || 0) * 100);
  const effort = classification.effort || "unknown";
  const risk = classification.riskLevel || "unknown";

  if (stepId === 1) {
    return (
      <div style={{ display: "grid", gap: 14, maxWidth: 780 }}>
        <textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Describe the outcome to compile for review."
          style={{
            width: "100%",
            minHeight: 130,
            border: `1px solid ${t.borderStrong}`,
            borderRadius: 8,
            background: t.panelAlt,
            color: t.text,
            resize: "vertical",
            padding: 14,
            font: "inherit",
            lineHeight: 1.5,
            outline: "none",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <Btn t={t} variant="primary" icon={<Icon.Spark />} onClick={onCompile} disabled={busyAction === "compile" || !prompt.trim()}>
            Run
          </Btn>
        </div>
      </div>
    );
  }

  if (stepId === 2) {
    return (
      <CenteredStep t={t}>
        <div style={{ fontSize: 13, color: t.textDim }}>
          {flow ? "Classification complete." : "Analyzing your request..."}
        </div>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 999,
            border: `2px dotted ${t.accent}`,
            margin: "6px auto",
          }}
        />
        <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          <Pill t={t} risk={risk === "high" ? "red" : risk === "medium" ? "orange" : "green"}>{risk} risk</Pill>
          <Pill t={t} risk={effort === "high" ? "red" : effort === "medium" ? "orange" : "green"}>{effort} effort</Pill>
          {confidence ? <Pill t={t}>{confidence}% confidence</Pill> : null}
        </div>
      </CenteredStep>
    );
  }

  if (stepId === 3) {
    return (
      <ListStep
        t={t}
        eyebrow={planItems.length ? "Plan ready" : "Plan pending"}
        tone={planItems.length ? "green" : "yellow"}
        items={planItems.map((item) => compactFlowLine(item.title || item.id))}
        empty="No plan nodes have been returned yet."
      />
    );
  }

  if (stepId === 4) {
    if (status === "pending" || status === "running") {
      return (
        <CenteredStep t={t}>
          <div style={{ fontSize: 13, color: t.textDim }}>Checking the admitted semantic artifact...</div>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 999,
              border: `2px dotted ${t.accent}`,
            }}
          />
          <div style={{ color: t.textDim, maxWidth: 520, lineHeight: 1.5 }}>
            Issue detection has not finished yet. Execution stays locked until the backend returns a reviewed artifact.
          </div>
        </CenteredStep>
      );
    }

    return (
      <ListStep
        t={t}
        eyebrow={issues.length ? "Issues detected" : "No issues detected"}
        tone={issues.length ? "orange" : "green"}
        items={issues.map((issue) => compactFlowLine(issue.summary, issue.code))}
        empty="The backend did not report blocking issues."
      />
    );
  }

  if (stepId === 5) {
    const thumb = effort === "high" ? "84%" : effort === "medium" ? "50%" : "16%";
    return (
      <div style={{ display: "grid", gap: 18, maxWidth: 620 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <Pill t={t} risk={effort === "high" ? "red" : effort === "medium" ? "orange" : "green"} strong>
            {effort} effort reasoning
          </Pill>
          <Btn t={t} variant="solid" onClick={() => setActiveStep(6)}>Why?</Btn>
        </div>
        <div>
          <div style={{ height: 5, borderRadius: 999, position: "relative", background: `linear-gradient(to right, ${t.green} 0%, ${t.green} 33%, ${t.yellow} 33%, ${t.yellow} 66%, ${t.red} 66%, ${t.red} 100%)` }}>
            <div style={{ position: "absolute", left: thumb, top: -5, width: 15, height: 15, borderRadius: 999, background: t.text, border: `2px solid ${t.yellow}`, transform: "translateX(-50%)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", marginTop: 9, fontSize: 11, color: t.textDim }}>
            <span>Low</span>
            <span style={{ textAlign: "center" }}>Medium</span>
            <span style={{ textAlign: "right" }}>High</span>
          </div>
        </div>
        <div style={{ color: t.textDim }}>
          Confidence: <span style={{ color: confidence < 70 ? t.orange : t.green, fontWeight: 800 }}>{confidence || "n/a"}%</span>
        </div>
      </div>
    );
  }

  if (stepId === 6) {
    const evidence = [
      ...asArray(analysis.evidence),
      ...asArray(classification.reasons),
      ...asArray(intent.strictBoundaries).map((boundary) => `Boundary: ${boundary}`),
    ];
    return (
      <ListStep
        t={t}
        eyebrow="Why this path was chosen"
        tone="info"
        items={evidence.map((item) => compactFlowLine(item))}
        empty="No backend evidence has been recorded yet."
      />
    );
  }

  if (stepId === 7) {
    if (status === "pending" || status === "running") {
      return (
        <CenteredStep t={t}>
          <div style={{ color: t.text, fontWeight: 850, fontSize: 18 }}>Waiting for issue detection</div>
          <div style={{ color: t.textDim, maxWidth: 520, lineHeight: 1.5 }}>
            Semantix has not produced a fix recommendation yet because the semantic review is still pending.
          </div>
        </CenteredStep>
      );
    }

    return (
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(260px, .8fr)", gap: 16 }}>
        <div>
          <SectionKicker t={t} tone={firstIssue ? "orange" : "green"}>
            {firstIssue ? compactFlowLine(firstIssue.summary, firstIssue.code) : "No fix required"}
          </SectionKicker>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {(recommendations.length ? recommendations : firstIssue?.fixOptions || []).map((recommendation, index) => (
              <div
                key={`${recommendation.id || recommendation.action || index}`}
                style={{
                  border: `1px solid ${index === 0 ? t.accent : t.border}`,
                  background: index === 0 ? t.accentSoft : t.panelAlt,
                  color: t.text,
                  borderRadius: 8,
                  padding: 10,
                  fontSize: 12.5,
                }}
              >
                <div style={{ fontWeight: 750 }}>{recommendation.label || recommendation.action || "Recommended fix"}</div>
                {recommendation.summary ? <div style={{ color: t.textDim, marginTop: 3 }}>{compactFlowLine(recommendation.summary)}</div> : null}
              </div>
            ))}
            {!firstRecommendation ? <div style={{ color: t.textDim }}>No backend recommendation recorded.</div> : null}
          </div>
        </div>
        <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.panelAlt, padding: 12 }}>
          <div style={{ fontSize: 11, color: t.textFaint, textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>
            Preview
          </div>
          <div style={{ fontFamily: "ui-monospace, Menlo, monospace", whiteSpace: "pre-wrap", color: t.textDim, fontSize: 11.5, lineHeight: 1.55 }}>
            {firstRecommendation?.action === "retry_semantic_admission"
              ? "Retry semantic admission with a clean Codex runtime configuration."
              : firstRecommendation
                ? `Apply: ${firstRecommendation.label || firstRecommendation.action}`
                : "No change preview available."}
          </div>
          <Btn
            t={t}
            variant="primary"
            onClick={onApplyFix}
            disabled={!firstRecommendation || busyAction === "fix"}
            style={{ marginTop: 14, width: "100%", justifyContent: "center" }}
          >
            {busyAction === "fix" ? "Applying..." : "Apply Fix"}
          </Btn>
        </div>
      </div>
    );
  }

  if (stepId === 8) {
    if (status === "pending" || status === "running") {
      return (
        <CenteredStep t={t}>
          <div style={{ width: 54, height: 54, borderRadius: 999, background: t.panelAlt, color: t.textDim, display: "grid", placeItems: "center", fontWeight: 900, fontSize: 18 }}>
            ...
          </div>
          <div style={{ color: t.text, fontWeight: 800, fontSize: 17 }}>Re-evaluation pending</div>
          <div style={{ color: t.textDim, maxWidth: 520, lineHeight: 1.5 }}>
            Re-evaluation will update after issue detection or a selected fix completes.
          </div>
        </CenteredStep>
      );
    }

    const stillBlocked = issues.length > 0 || status === "blocked";
    return (
      <CenteredStep t={t}>
        <div style={{ width: 54, height: 54, borderRadius: 999, background: stillBlocked ? t.redSoft : t.greenSoft, color: stillBlocked ? t.red : t.green, display: "grid", placeItems: "center", fontWeight: 900, fontSize: 22 }}>
          {stillBlocked ? "!" : "OK"}
        </div>
        <div style={{ color: stillBlocked ? t.red : t.green, fontWeight: 800, fontSize: 17 }}>
          {stillBlocked ? "Re-evaluation blocked" : "All issues resolved"}
        </div>
        <div style={{ color: t.textDim, maxWidth: 520, lineHeight: 1.5 }}>
          {stillBlocked
            ? compactFlowLine(firstIssue?.summary, "A backend issue still blocks approval.")
            : "The artifact can move forward to approval."}
        </div>
      </CenteredStep>
    );
  }

  if (stepId === 9) {
    const selectedNodeId = flow?.advanced?.selectedNodeId || nodes[0]?.id || "n/a";
    const inspector = flow?.advanced?.inspectors?.[selectedNodeId] || null;
    return (
      <div style={{ display: "grid", gridTemplateColumns: "220px minmax(0, 1fr) minmax(220px, .8fr)", gap: 14 }}>
        <MiniPanel t={t} title="Graph">
          {nodes.slice(0, 6).map((node) => (
            <div key={node.id} style={{ display: "flex", gap: 7, alignItems: "center", padding: "6px 0", color: node.id === selectedNodeId ? t.accent : t.textDim }}>
              <RiskDot t={t} risk={node.id === selectedNodeId ? "info" : "green"} />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.title || node.id}</span>
            </div>
          ))}
        </MiniPanel>
        <MiniPanel t={t} title="Inspector">
          <KeyValue t={t} name="Node" value={inspector?.node?.title || selectedNodeId} />
          <KeyValue t={t} name="Runtime" value={inspector?.overview?.runtimeKind || "n/a"} />
          <KeyValue t={t} name="Freshness" value={inspector?.overview?.freshnessState || flow?.artifact?.freshnessState || "n/a"} />
          <KeyValue t={t} name="Summary" value={compactFlowLine(inspector?.outputPreview?.summary || inspector?.node?.outputSummary || "No output summary recorded.")} />
        </MiniPanel>
        <MiniPanel t={t} title="State changes">
          {stateEffects.length > 0 ? stateEffects.slice(0, 6).map((effect, index) => (
            <div key={effect.id || index} style={{ color: t.textDim, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, lineHeight: 1.7 }}>
              + {effect.target || effect.workspace_path || effect.summary || effect.id}
            </div>
          )) : (
            <div style={{ color: t.textDim }}>No material state effects yet.</div>
          )}
          {advisoryChanges.length > 0 ? (
            <div style={{ marginTop: 8, color: t.orange, fontSize: 11 }}>
              {advisoryChanges.length} advisory preview hidden from execution.
            </div>
          ) : null}
        </MiniPanel>
      </div>
    );
  }

  if (stepId === 10) {
    const blocked = approval.blocked || issues.length > 0;
    const ready = !blocked && approval.ready;
    const pending = !blocked && !ready;
    return (
      <CenteredStep t={t}>
        <div style={{ width: 58, height: 58, borderRadius: 999, background: blocked ? t.redSoft : ready ? t.accentSoft : t.panelAlt, color: blocked ? t.red : ready ? t.accent : t.textDim, display: "grid", placeItems: "center", fontWeight: 900 }}>
          {blocked ? "Hold" : ready ? "Ready" : "..."}
        </div>
        <div style={{ color: t.text, fontWeight: 850, fontSize: 18 }}>
          {blocked ? "Approval is blocked" : ready ? "Ready to execute" : "Approval is not ready yet"}
        </div>
        <div style={{ color: t.textDim, maxWidth: 560, lineHeight: 1.5 }}>
          {blocked
            ? compactFlowLine(approval.reason || firstIssue?.summary, "Unresolved issues must be fixed before execution.")
            : pending
              ? "Semantix is still waiting for an admitted artifact that can be approved."
              : "Semantix will apply only the admitted, freshly approved state effects."}
        </div>
        <Btn
          t={t}
          variant="primary"
          onClick={onApproveAndRun}
          disabled={blocked || !ready || busyAction === "execute"}
          style={{ minWidth: 190, justifyContent: "center" }}
        >
          {busyAction === "execute" ? "Running..." : "Approve and Run"}
        </Btn>
      </CenteredStep>
    );
  }

  if (stepId === 11) {
    const progress = flow?.execution?.progress || [];
    return (
      <div style={{ display: "grid", gap: 16 }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.max(progress.length, 1)}, 1fr)`, gap: 10 }}>
          {(progress.length ? progress : [{ id: "pending", label: "Pending", current: true }]).map((entry) => (
            <div key={entry.id} style={{ textAlign: "center", color: entry.done ? t.green : entry.current ? t.accent : t.textFaint }}>
              <div style={{ margin: "0 auto 6px", width: 30, height: 30, borderRadius: 999, border: `2px solid ${entry.done ? t.green : entry.current ? t.accent : t.border}`, display: "grid", placeItems: "center", fontWeight: 900 }}>
                {entry.done ? "OK" : entry.current ? "*" : ""}
              </div>
              <div style={{ fontSize: 12, fontWeight: entry.current ? 800 : 600 }}>{entry.label}</div>
            </div>
          ))}
        </div>
        <MiniPanel t={t} title="Execution log">
          <div style={{ fontFamily: "ui-monospace, Menlo, monospace", color: t.textDim, fontSize: 12, lineHeight: 1.7 }}>
            <div>Plan compiled.</div>
            <div>Validation boundary active.</div>
            <div>{flow?.execution?.status ? `Execution ${formatFlowStatus(flow.execution.status)}.` : "Awaiting approved execution."}</div>
          </div>
        </MiniPanel>
      </div>
    );
  }

  if (stepId === 12) {
    const files = result.filesUpdated || stateEffects.map((effect) => effect.target || effect.workspace_path).filter(Boolean);
    return (
      <CenteredStep t={t}>
        <div style={{ width: 58, height: 58, borderRadius: 999, background: result.completed ? t.greenSoft : t.panelAlt, color: result.completed ? t.green : t.textDim, display: "grid", placeItems: "center", fontWeight: 900 }}>
          {result.completed ? "OK" : "--"}
        </div>
        <div style={{ color: result.completed ? t.green : t.text, fontWeight: 850, fontSize: 18 }}>
          {result.completed ? "Changes applied" : "No committed result yet"}
        </div>
        <div style={{ color: t.textDim }}>
          {files.length ? `${files.length} file${files.length === 1 ? "" : "s"} updated.` : "No material state effects have been committed."}
        </div>
        {files.length ? (
          <div style={{ fontFamily: "ui-monospace, Menlo, monospace", color: t.textDim, fontSize: 12, lineHeight: 1.7, textAlign: "left" }}>
            {files.slice(0, 8).map((file) => <div key={file}>+ {file}</div>)}
          </div>
        ) : null}
      </CenteredStep>
    );
  }

  return null;
}

function CenteredStep({ t, children }) {
  return (
    <div style={{ minHeight: 300, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 12, color: t.text }}>
      {children}
    </div>
  );
}

function ListStep({ t, eyebrow, tone, items, empty }) {
  const token = RISK_TOKEN(t, tone);
  return (
    <div style={{ display: "grid", gap: 12, maxWidth: 760 }}>
      <SectionKicker t={t} tone={tone}>{eyebrow}</SectionKicker>
      <div style={{ display: "grid", gap: 8 }}>
        {items.length ? items.map((item, index) => (
          <div
            key={`${index}:${item}`}
            style={{
              display: "grid",
              gridTemplateColumns: "24px minmax(0, 1fr)",
              gap: 9,
              alignItems: "center",
              borderRadius: 8,
              background: t.panelAlt,
              border: `1px solid ${t.border}`,
              padding: "9px 10px",
              color: t.text,
            }}
          >
            <span style={{ width: 22, height: 22, borderRadius: 999, background: token.bg, color: token.fg, display: "grid", placeItems: "center", fontSize: 11, fontWeight: 850 }}>
              {index + 1}
            </span>
            <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item}</span>
          </div>
        )) : (
          <div style={{ color: t.textDim }}>{empty}</div>
        )}
      </div>
    </div>
  );
}

function SectionKicker({ t, tone, children }) {
  const token = RISK_TOKEN(t, tone);
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: token.fg, fontWeight: 800, fontSize: 13 }}>
      <RiskDot t={t} risk={tone} size={9} />
      {children}
    </div>
  );
}

function MiniPanel({ t, title, children }) {
  return (
    <div style={{ border: `1px solid ${t.border}`, borderRadius: 8, background: t.panelAlt, padding: 12, minWidth: 0 }}>
      <div style={{ fontSize: 10.5, color: t.textFaint, textTransform: "uppercase", letterSpacing: 1, fontWeight: 850, marginBottom: 8 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function KeyValue({ t, name, value }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "82px minmax(0, 1fr)", gap: 8, fontSize: 12, lineHeight: 1.6 }}>
      <span style={{ color: t.textFaint }}>{name}</span>
      <span style={{ color: t.textDim, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</span>
    </div>
  );
}

function flowPhaseTone(phase) {
  if (phase === "completed") return "green";
  if (phase === "failed" || phase === "needs_intervention") return "red";
  if (phase === "awaiting_approval") return "orange";
  if (phase === "executing") return "info";
  return "yellow";
}

function flowStepTone(status) {
  if (status === "complete" || status === "available") return "green";
  if (status === "blocked" || status === "required") return "red";
  if (status === "warning" || status === "ready" || status === "running" || status === "optional") return "orange";
  return "info";
}

function formatFlowStatus(status) {
  return String(status || "pending").replaceAll("_", " ");
}

function firstFlowText(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" || typeof value === "boolean") return String(value);
  }
  return "";
}

function summarizeFlowStep(flow, step) {
  const classification = flow?.classification || {};
  const firstIssue = flow?.issues?.[0] || null;
  const firstPlanItem = flow?.plan?.items?.[0] || null;
  const analysis = flow?.analysis || {};
  const firstRecommendation = flow?.recommendations?.[0] || null;
  const approval = flow?.approval || {};
  const executionCurrent = flow?.execution?.progress?.find((entry) => entry.current);
  const result = flow?.result || {};

  if (step.id === 1) {
    return firstFlowText(flow?.input?.primaryDirective, "Request captured.");
  }
  if (step.id === 2) {
    return `${classification.effort || "unknown"} effort, ${classification.riskLevel || "unknown"} risk.`;
  }
  if (step.id === 3) {
    return firstPlanItem
      ? firstFlowText(firstPlanItem.title, firstPlanItem.id)
      : "No execution nodes returned yet.";
  }
  if (step.id === 4) {
    return firstIssue
      ? firstFlowText(firstIssue.summary, firstIssue.code)
      : `${analysis.metrics?.issueCount ?? 0} backend issue records.`;
  }
  if (step.id === 5) {
    return firstFlowText(analysis.summary, "No backend analysis summary recorded.");
  }
  if (step.id === 6) {
    return firstFlowText(
      analysis.evidence?.[0],
      classification.reasons?.[0],
      "No evidence records returned yet.",
    );
  }
  if (step.id === 7) {
    return firstFlowText(
      firstRecommendation?.label,
      firstIssue?.fixOptions?.[0]?.label,
      "No backend recommendation recorded.",
    );
  }
  if (step.id === 8) {
    return step.status === "blocked"
      ? firstFlowText(firstIssue?.summary, "Re-evaluation is blocked by a backend issue.")
      : firstFlowText(analysis.summary, "No re-evaluation summary recorded.");
  }
  if (step.id === 9) {
    return flow?.advanced?.selectedNodeId
      ? `Selected ${flow.advanced.selectedNodeId}.`
      : "Graph and inspector are available.";
  }
  if (step.id === 10) {
    if (approval.blocked) return "Approval is blocked by unresolved issues.";
    if (approval.ready) return "Fresh approval can be recorded.";
    return firstFlowText(approval.reason, `Approval ${approval.status || "pending"}.`);
  }
  if (step.id === 11) {
    return executionCurrent
      ? `${executionCurrent.label} is current.`
      : `Execution ${flow?.execution?.status || "pending"}.`;
  }
  if (step.id === 12) {
    if (result.filesUpdated?.length > 0) {
      return `${result.filesUpdated.length} file${result.filesUpdated.length === 1 ? "" : "s"} updated.`;
    }
    return result.completed ? "Run completed." : `${result.stateEffects?.length ?? 0} material state effects committed.`;
  }
  return formatFlowStatus(step.status);
}

function FlowStatusStrip({ t, flow }) {
  const classification = flow?.classification || {};
  const steps = flow?.steps || [];
  const issueCount = flow?.issues?.length || 0;
  const approval = flow?.approval || {};
  const result = flow?.result || {};
  const phaseTone = flowPhaseTone(flow?.phase);

  return (
    <div
      style={{
        flexShrink: 0,
        borderBottom: `1px solid ${t.border}`,
        background: t.panelAlt,
        padding: "10px 16px 12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, minWidth: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: t.text, whiteSpace: "nowrap" }}>
          Run flow
        </div>
        <Pill t={t} risk={phaseTone} strong>{formatFlowStatus(flow.phase)}</Pill>
        <Pill t={t} risk={classification.riskLevel === "high" ? "red" : classification.riskLevel === "medium" ? "orange" : "green"}>
          {classification.effort || "unknown"} effort
        </Pill>
        <Pill t={t}>{Math.round((classification.confidenceScore || 0) * 100)}% confidence</Pill>
        <Pill t={t} risk={issueCount > 0 ? "red" : "green"}>{issueCount} issue{issueCount === 1 ? "" : "s"}</Pill>
        {approval.required ? (
          <Pill t={t} risk={approval.ready || approval.approved ? "green" : approval.blocked ? "red" : "orange"}>
            approval {formatFlowStatus(approval.status)}
          </Pill>
        ) : null}
        {result.filesUpdated?.length > 0 ? (
          <Pill t={t} risk="info">{result.filesUpdated.length} file{result.filesUpdated.length === 1 ? "" : "s"}</Pill>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridAutoFlow: "column",
          gridAutoColumns: "minmax(160px, 1fr)",
          gap: 8,
          overflowX: "auto",
          paddingBottom: 2,
        }}
      >
        {steps.map((step) => {
          const tone = flowStepTone(step.status);
          const token = RISK_TOKEN(t, tone);
          return (
            <div
              key={step.id}
              title={`${step.label}: ${formatFlowStatus(step.status)}`}
              style={{
                minHeight: 92,
                borderRadius: 8,
                border: `1px solid ${token.fg}33`,
                background: step.status === "pending" ? t.panel : token.bg,
                padding: "10px 10px 9px",
                display: "flex",
                flexDirection: "column",
                gap: 7,
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 800, color: token.fg }}>{step.id}.</span>
                <span style={{ fontSize: 12, fontWeight: 750, color: t.text, lineHeight: 1.2 }}>
                  {step.label}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 700, color: token.fg, textTransform: "uppercase", letterSpacing: 0.4 }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: token.fg }} />
                {formatFlowStatus(step.status)}
              </div>
              <div style={{ fontSize: 11.5, color: t.textDim, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
                {summarizeFlowStep(flow, step)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TopBar({
  t,
  phase,
  scenarioKey,
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
          demo flow
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
