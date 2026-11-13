import { createHash } from "node:crypto";

export const PLANNING_HANDOFF_CONTRACT_VERSION = "semantix.planning-handoff.v1";
export const PLANNING_HANDOFF_CANONICALIZATION_VERSION =
  "semantix.canonical-json.v1";
export const PLANNING_HANDOFF_DEFAULT_COMPILER_PROFILE_ID =
  "semantix.planning-handoff.v1.profile.1";

export const DEFAULT_PLANNING_HANDOFF_COMPILER_PROFILE = deepFreeze({
  id: PLANNING_HANDOFF_DEFAULT_COMPILER_PROFILE_ID,
  contractVersion: PLANNING_HANDOFF_CONTRACT_VERSION,
  mapperVersion: "semantix.planning-handoff.mapper.v1",
  validatorVersion: "semantix.planning-handoff.validator.v1",
  canonicalizationVersion: PLANNING_HANDOFF_CANONICALIZATION_VERSION,
});

export const PLANNING_HANDOFF_COMPILER_PROFILES = deepFreeze({
  [PLANNING_HANDOFF_DEFAULT_COMPILER_PROFILE_ID]:
    DEFAULT_PLANNING_HANDOFF_COMPILER_PROFILE,
});

export const SUPPORTED_PACKET_CONTRACT_VERSIONS_V1 = Object.freeze([
  "semantix.phalanx.spec-studio.v1",
]);

const HASH_ALGORITHM = "sha256";
const MAX_CANONICAL_BYTES_V1 = 1048576;

const TOP_LEVEL_BUILD_INPUT_KEYS = Object.freeze([
  "auditState",
  "compilerProfileId",
  "lockedArtifact",
  "packet",
]);

const AUDIT_STATE_KEYS = Object.freeze([
  "capabilityScopes",
  "coverage",
  "dataPolicy",
  "decisions",
  "evidence",
  "freshnessGate",
  "governance",
  "lineage",
  "lockMetadata",
  "overrideDecisions",
  "provenanceRecords",
  "sensitivityClassifications",
]);

const HANDOFF_TOP_LEVEL_KEYS = Object.freeze([
  "acceptanceCriteria",
  "alignedRequirement",
  "alignedRequirementSensitivity",
  "assumptions",
  "boundaries",
  "capabilityScopes",
  "compilerProfile",
  "contractVersion",
  "dataPolicy",
  "decisionAudit",
  "evidence",
  "fingerprint",
  "freshnessGate",
  "governance",
  "handoffId",
  "inputHashes",
  "lineage",
  "lockedArtifactId",
  "mode",
  "negativeRequirements",
  "originalUserRequest",
  "originalUserRequestSensitivity",
  "overrideDecisions",
  "plannerInputs",
  "provenanceRecords",
  "requirements",
  "risks",
  "semanticObligations",
  "sourcePacket",
  "targetSurfaces",
  "verificationObligations",
]);

const PROSE_KEYS = new Set([
  "acceptance",
  "alignedRequirement",
  "currentBehavior",
  "description",
  "name",
  "originalUserRequest",
  "purpose",
  "query",
  "question",
  "rationale",
  "reason",
  "readinessReason",
  "replacement",
  "summary",
  "text",
  "valueSummary",
]);

const STAFF_OWNED_KEYS = new Set([
  "architectureDoc",
  "decompositionPlan",
  "designDoc",
  "designDocs",
  "executionDispatch",
  "executionPlan",
  "featurePuzzle",
  "featurePuzzles",
  "fileChange",
  "fileChanges",
  "implementationPlan",
  "implementationPlans",
  "staffPlan",
  "taskGraph",
  "taskGraphs",
  "verifyCommand",
  "verifyCommands",
  "verificationCommandChoices",
]);

const FRESHNESS_STATE_RANK = Object.freeze({
  clean_resume: 0,
  soft_stale: 1,
  hard_stale: 2,
});

export class PlanningHandoffValidationError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = "PlanningHandoffValidationError";
    this.code = "PLANNING_HANDOFF_VALIDATION_ERROR";
    this.details = details;
  }
}

export function buildPlanningHandoff(input) {
  const resolvedInput = normalizeBuildInput(input);
  const { packet, lockedArtifact, auditState, compilerProfile } = resolvedInput;
  const inputHashes = createInputHashes(resolvedInput);

  if (
    typeof lockedArtifact.packetContentHash === "string" &&
    lockedArtifact.packetContentHash !== inputHashes.packet.value
  ) {
    throw new PlanningHandoffValidationError("Invalid planning handoff input.", {
      errors: [
        {
          path: "$.lockedArtifact.packetContentHash",
          code: "locked_artifact_packet_hash_mismatch",
          message:
            "lockedArtifact.packetContentHash must match the canonical packet input hash.",
        },
      ],
    });
  }

  const sourcePacket = {
    sessionId: packet.sessionId,
    iteration: packet.iteration,
    contractVersion: packet.contractVersion,
    contentHash: inputHashes.packet.value,
  };
  const lineage = canonicalClone(auditState.lineage);
  const handoffId = deterministicHandoffId({
    lockedArtifactId: lockedArtifact.id,
    sourcePacketContentHash: inputHashes.packet.value,
    compilerProfileId: compilerProfile.id,
    lineageRelationship: lineage.relationship,
  });

  const sensitivityIndex = createSensitivityIndex(auditState);
  const requirements = canonicalRequirements(packet, sensitivityIndex);
  const acceptanceCriteria = canonicalAcceptance(packet, sensitivityIndex);
  const negativeRequirements = canonicalNegativeRequirements(
    packet,
    sensitivityIndex,
  );
  const targetSurfaces = canonicalTargetSurfaces(packet, sensitivityIndex);
  const boundaries = canonicalBoundaries(packet, sensitivityIndex);
  const assumptions = canonicalAssumptions(packet, sensitivityIndex);
  const risks = canonicalRisks(packet, sensitivityIndex);
  const semanticObligations = canonicalSemanticObligations(
    packet,
    sensitivityIndex,
  );
  const verificationObligations = canonicalVerificationObligations({
    requirements,
    acceptanceCriteria,
    negativeRequirements,
    boundaries,
    semanticObligations,
  });
  attachVerificationRefs({
    negativeRequirements,
    boundaries,
    semanticObligations,
    verificationObligations,
  });

  const evidence = canonicalClone(auditState.evidence);
  const provenanceRecords = canonicalClone(auditState.provenanceRecords);
  assertEvidenceUse({ handoffEvidence: evidence, packet, provenanceRecords });

  const handoffWithoutFingerprint = canonicalClone({
    contractVersion: PLANNING_HANDOFF_CONTRACT_VERSION,
    handoffId,
    lockedArtifactId: lockedArtifact.id,
    sourcePacket,
    compilerProfile,
    lineage,
    governance: canonicalClone(auditState.governance),
    dataPolicy: canonicalClone(auditState.dataPolicy),
    inputHashes,
    originalUserRequest: normalizeProseString(packet.originalUserRequest),
    originalUserRequestSensitivity: getSensitivity(
      sensitivityIndex,
      "/packet/originalUserRequest",
    ),
    alignedRequirement: normalizeProseString(packet.alignedRequirement),
    alignedRequirementSensitivity: getSensitivity(
      sensitivityIndex,
      "/packet/alignedRequirement",
    ),
    mode: packet.existingSystemContext.mode,
    requirements,
    acceptanceCriteria,
    negativeRequirements,
    targetSurfaces,
    boundaries,
    assumptions,
    risks,
    evidence,
    provenanceRecords,
    capabilityScopes: canonicalClone(auditState.capabilityScopes),
    semanticObligations,
    verificationObligations,
    decisionAudit: canonicalClone(auditState.decisions),
    overrideDecisions: canonicalClone(auditState.overrideDecisions),
    freshnessGate: canonicalClone(auditState.freshnessGate),
    plannerInputs: canonicalPlannerInputs({
      requirements,
      acceptanceCriteria,
      boundaries,
      semanticObligations,
      verificationObligations,
      findings: packet.findings,
      sensitivityIndex,
    }),
  });

  const fingerprint = fingerprintPlanningHandoff(handoffWithoutFingerprint);
  const handoff = canonicalClone({ ...handoffWithoutFingerprint, fingerprint });
  assertPlanningHandoff(handoff);
  return handoff;
}

export function validatePlanningHandoff(handoff) {
  const errors = [];

  if (!isPlainObject(handoff)) {
    pushError(errors, "$", "handoff_not_object", "Handoff must be an object.");
    return { ok: false, errors };
  }

  validateNoUnknownKeys(handoff, HANDOFF_TOP_LEVEL_KEYS, "$", errors);
  rejectNullishJson(handoff, "$", errors);
  rejectStaffOwnedKeys(handoff, "$", errors);

  if (handoff.contractVersion !== PLANNING_HANDOFF_CONTRACT_VERSION) {
    pushError(
      errors,
      "$.contractVersion",
      "unsupported_handoff_contract_version",
      `contractVersion must equal ${PLANNING_HANDOFF_CONTRACT_VERSION}.`,
    );
  }
  if (!isHandoffId(handoff.handoffId)) {
    pushError(
      errors,
      "$.handoffId",
      "invalid_handoff_id",
      "handoffId must be handoff:<64 lowercase hex characters>.",
    );
  }
  if (!isNonEmptyString(handoff.lockedArtifactId)) {
    pushError(
      errors,
      "$.lockedArtifactId",
      "missing_locked_artifact_id",
      "lockedArtifactId is required.",
    );
  }
  validateCompilerProfile(handoff.compilerProfile, "$.compilerProfile", errors);
  validateSourcePacket(handoff.sourcePacket, "$.sourcePacket", errors);
  validateInputHashes(handoff.inputHashes, "$.inputHashes", errors);
  validateDecisionAudit(handoff.decisionAudit, "$.decisionAudit", errors);
  validateGovernance(handoff.governance, handoff.decisionAudit, "$.governance", errors);
  validateDataPolicy(handoff.dataPolicy, "$.dataPolicy", errors);
  validateLineage(handoff.lineage, "$.lineage", errors);
  validateEvidence(handoff.evidence, "$.evidence", errors);
  validateFreshnessPolicy(handoff.freshnessGate, handoff.evidence, "$.freshnessGate", errors);
  validatePersistedSensitivity(handoff, errors);

  if (
    handoff.sourcePacket?.contentHash &&
    handoff.inputHashes?.packet?.value &&
    handoff.sourcePacket.contentHash !== handoff.inputHashes.packet.value
  ) {
    pushError(
      errors,
      "$.sourcePacket.contentHash",
      "source_packet_hash_mismatch",
      "sourcePacket.contentHash must equal inputHashes.packet.value.",
    );
  }

  validateCollection(handoff.requirements, "$.requirements", errors);
  validateCollection(handoff.acceptanceCriteria, "$.acceptanceCriteria", errors);
  validateCollection(
    handoff.negativeRequirements,
    "$.negativeRequirements",
    errors,
  );
  validateCollection(handoff.targetSurfaces, "$.targetSurfaces", errors);
  validateCollection(handoff.boundaries, "$.boundaries", errors);
  validateCollection(handoff.assumptions, "$.assumptions", errors);
  validateCollection(handoff.risks, "$.risks", errors);
  validateCollection(handoff.evidence, "$.evidence", errors);
  validateCollection(handoff.provenanceRecords, "$.provenanceRecords", errors);
  validateCollection(handoff.capabilityScopes, "$.capabilityScopes", errors);
  validateCollection(handoff.semanticObligations, "$.semanticObligations", errors);
  validateCollection(
    handoff.verificationObligations,
    "$.verificationObligations",
    errors,
  );
  validateCollection(handoff.decisionAudit, "$.decisionAudit", errors);
  validateCollection(handoff.overrideDecisions, "$.overrideDecisions", errors);

  if (errors.length > 0) return { ok: false, errors };

  validateRequirementLinks(handoff, errors);
  validateVerificationLinks(handoff, errors);
  validateFreshnessGate(handoff, errors);
  validatePlannerInputs(handoff, errors);

  if (typeof handoff.fingerprint !== "string") {
    pushError(
      errors,
      "$.fingerprint",
      "missing_fingerprint",
      "fingerprint is required.",
    );
  } else if (!isSha256Fingerprint(handoff.fingerprint)) {
    pushError(
      errors,
      "$.fingerprint",
      "invalid_fingerprint",
      "fingerprint must be sha256:<64 lowercase hex characters>.",
    );
  } else {
    const expected = fingerprintPlanningHandoff(handoff);
    if (handoff.fingerprint !== expected) {
      pushError(
        errors,
        "$.fingerprint",
        "fingerprint_mismatch",
        "fingerprint must equal the SHA-256 digest of canonical handoff JSON without fingerprint.",
      );
    }
  }

  try {
    const canonical = canonicalizePlanningHandoff(handoff);
    if (Buffer.byteLength(canonical, "utf8") > MAX_CANONICAL_BYTES_V1) {
      pushError(
        errors,
        "$",
        "canonical_handoff_too_large",
        "Canonical handoff bytes exceed the v1 1 MiB limit.",
      );
    }
  } catch (error) {
    pushError(
      errors,
      "$",
      "canonicalization_failed",
      error instanceof Error ? error.message : String(error),
    );
  }

  return { ok: errors.length === 0, errors };
}

export function assertPlanningHandoff(handoff) {
  const result = validatePlanningHandoff(handoff);
  if (!result.ok) {
    throw new PlanningHandoffValidationError("Invalid planning handoff.", {
      errors: result.errors,
    });
  }
}

export function canonicalizePlanningHandoff(handoff) {
  return canonicalStringify(handoff);
}

export function fingerprintPlanningHandoff(handoff) {
  if (!isPlainObject(handoff)) {
    throw new PlanningHandoffValidationError(
      "fingerprintPlanningHandoff requires a handoff object.",
    );
  }
  const input = { ...handoff };
  delete input.fingerprint;
  return sha256Canonical(input);
}

export function classifyFreshnessGateResult(handoff, observationSet) {
  assertPlanningHandoff(handoff);
  if (!isPlainObject(observationSet)) {
    throw new PlanningHandoffValidationError(
      "classifyFreshnessGateResult requires an observation set object.",
    );
  }
  if (observationSet.handoffId !== handoff.handoffId) {
    throw new PlanningHandoffValidationError(
      "Freshness observation set handoffId does not match the handoff.",
      {
        expected: handoff.handoffId,
        actual: observationSet.handoffId,
      },
    );
  }
  if (!isCanonicalTimestamp(observationSet.checkedAt)) {
    throw new PlanningHandoffValidationError(
      "Freshness observation set checkedAt must be a canonical UTC timestamp.",
    );
  }
  const observations = Array.isArray(observationSet.observations)
    ? observationSet.observations
    : [];
  const observationByEvidence = new Map(
    observations
      .filter((observation) => isPlainObject(observation))
      .map((observation) => [observation.evidenceRef, observation]),
  );
  const evidenceById = new Map(handoff.evidence.map((evidence) => [evidence.id, evidence]));

  const evidenceResults = [...handoff.freshnessGate.evidenceRefs]
    .sort(byteCompare)
    .map((evidenceRef) =>
      classifyEvidenceFreshness(evidenceById.get(evidenceRef), observationByEvidence.get(evidenceRef)),
    );
  const state = evidenceResults.reduce(
    (current, result) =>
      FRESHNESS_STATE_RANK[result.state] > FRESHNESS_STATE_RANK[current]
        ? result.state
        : current,
    "clean_resume",
  );

  return canonicalClone({
    handoffId: handoff.handoffId,
    checkedAt: observationSet.checkedAt,
    state,
    evidenceResults,
  });
}

function normalizeBuildInput(input) {
  const errors = [];
  if (!isPlainObject(input)) {
    pushError(errors, "$", "build_input_not_object", "Build input must be an object.");
    throwInputError(errors);
  }
  validateNoUnknownKeys(input, TOP_LEVEL_BUILD_INPUT_KEYS, "$", errors);

  const compilerProfileId =
    input.compilerProfileId ?? PLANNING_HANDOFF_DEFAULT_COMPILER_PROFILE_ID;
  const compilerProfile = PLANNING_HANDOFF_COMPILER_PROFILES[compilerProfileId];
  if (!compilerProfile) {
    pushError(
      errors,
      "$.compilerProfileId",
      "unsupported_compiler_profile",
      "compilerProfileId is not supported by this planning handoff contract.",
    );
  }

  validatePacket(input.packet, "$.packet", errors);
  validateLockedArtifact(input.lockedArtifact, "$.lockedArtifact", errors);
  validateAuditState(input.auditState, "$.auditState", errors);

  if (
    isPlainObject(input.lockedArtifact) &&
    isPlainObject(input.auditState?.lockMetadata)
  ) {
    if (input.auditState.lockMetadata.lockedArtifactId !== input.lockedArtifact.id) {
      pushError(
        errors,
        "$.auditState.lockMetadata.lockedArtifactId",
        "lock_metadata_artifact_mismatch",
        "lockMetadata.lockedArtifactId must match lockedArtifact.id.",
      );
    }
  }

  if (isPlainObject(input.packet) && isPlainObject(input.lockedArtifact)) {
    const artifact = input.lockedArtifact;
    const metadata = input.auditState?.lockMetadata;
    const lockDecision = input.auditState?.decisions?.find?.(
      (decision) => decision?.id === artifact.lockDecisionRef,
    );
    if (
      artifact.sessionId !== input.packet.sessionId ||
      artifact.packetRef !== `packet:${input.packet.sessionId}:${input.packet.iteration}` ||
      metadata?.sourcePacket?.sessionId !== input.packet.sessionId ||
      metadata?.sourcePacket?.iteration !== input.packet.iteration ||
      metadata?.sourcePacket?.contractVersion !== input.packet.contractVersion
    ) {
      pushError(errors, "$.lockedArtifact", "lock_packet_identity_mismatch", "Locked artifact and lock metadata must identify the supplied packet.");
    }
    if (
      artifact.lockDecisionRef !== input.auditState?.governance?.lockDecisionRef ||
      artifact.lockDecisionRef !== metadata?.lockDecisionRef ||
      artifact.lockedByActorRef !== metadata?.lockedByActorRef ||
      artifact.lockedAt !== metadata?.lockedAt ||
      lockDecision?.kind !== "host_lock" ||
      lockDecision?.actorRef !== artifact.lockedByActorRef ||
      lockDecision?.at !== artifact.lockedAt ||
      !lockDecision?.targetRefs?.includes(artifact.id)
    ) {
      pushError(errors, "$.lockedArtifact", "lock_decision_identity_mismatch", "Locked artifact and metadata must match the governing host lock decision.");
    }
  }

  if (errors.length > 0) throwInputError(errors);

  return canonicalClone({
    packet: input.packet,
    lockedArtifact: input.lockedArtifact,
    auditState: input.auditState,
    compilerProfileId,
    compilerProfile,
  });
}

function throwInputError(errors) {
  throw new PlanningHandoffValidationError("Invalid planning handoff input.", {
    errors,
  });
}

function validatePacket(packet, path, errors) {
  if (!isPlainObject(packet)) {
    pushError(errors, path, "packet_not_object", "packet must be an object.");
    return;
  }
  rejectStaffOwnedKeys(packet, path, errors);
  if (!SUPPORTED_PACKET_CONTRACT_VERSIONS_V1.includes(packet.contractVersion)) {
    pushError(
      errors,
      `${path}.contractVersion`,
      "unsupported_packet_contract_version",
      "Packet contractVersion is not supported by planning handoff v1.",
    );
  }
  if (packet.source !== "semantix") {
    pushError(
      errors,
      `${path}.source`,
      "packet_source_not_semantix",
      'Packet source must equal "semantix".',
    );
  }
  if (!isNonEmptyString(packet.sessionId)) {
    pushError(errors, `${path}.sessionId`, "missing_session_id", "sessionId is required.");
  }
  if (!isNonNegativeInteger(packet.iteration)) {
    pushError(
      errors,
      `${path}.iteration`,
      "invalid_iteration",
      "iteration must be a non-negative integer.",
    );
  }
  if (packet.readiness !== "ready") {
    pushError(
      errors,
      `${path}.readiness`,
      "packet_not_ready",
      'Only readiness="ready" packets can be compiled into a planning handoff.',
    );
  }
  if (!isPlainObject(packet.existingSystemContext)) {
    pushError(
      errors,
      `${path}.existingSystemContext`,
      "existing_system_context_missing",
      "existingSystemContext is required.",
    );
  } else if (!["new", "update"].includes(packet.existingSystemContext.mode)) {
    pushError(
      errors,
      `${path}.existingSystemContext.mode`,
      "invalid_existing_system_mode",
      'Ready handoffs require mode "new" or "update".',
    );
  }
  if (!Array.isArray(packet.requirements) || packet.requirements.length === 0) {
    pushError(
      errors,
      `${path}.requirements`,
      "requirements_missing",
      "At least one requirement is required.",
    );
  } else {
    validateUniqueLocalIds(packet.requirements, `${path}.requirements`, errors);
    packet.requirements.forEach((requirement, index) => {
      validatePacketRequirement(requirement, `${path}.requirements[${index}]`, errors);
    });
  }
  if (Array.isArray(packet.findings)) {
    const unresolvedBlocker = packet.findings.find(
      (finding) => finding?.sev === "blocker" && finding.resolved !== true,
    );
    if (unresolvedBlocker) {
      pushError(
        errors,
        `${path}.findings`,
        "unresolved_blocker",
        "Unresolved blocker findings cannot be compiled into a planning handoff.",
      );
    }
  } else {
    pushError(errors, `${path}.findings`, "findings_missing", "findings must be an array.");
  }
  if (!isPlainObject(packet.coverage)) {
    pushError(errors, `${path}.coverage`, "coverage_missing", "coverage is required.");
  } else {
    if (packet.coverage.alignmentPct !== 100) {
      pushError(
        errors,
        `${path}.coverage.alignmentPct`,
        "packet_not_lockable",
        "coverage.alignmentPct must equal 100.",
      );
    }
    if (
      typeof packet.coverage.openBlockers === "number" &&
      packet.coverage.openBlockers !== 0
    ) {
      pushError(
        errors,
        `${path}.coverage.openBlockers`,
        "packet_not_lockable",
        "coverage.openBlockers must equal 0.",
      );
    }
  }
  if (
    packet.existingSystemContext?.mode === "update" &&
    !nonEmptyArray(packet.existingSystemContext.targetSurfaces)
  ) {
    pushError(
      errors,
      `${path}.existingSystemContext.targetSurfaces`,
      "update_target_surfaces_missing",
      "Update handoffs require targetSurfaces.",
    );
  }
  if (packet.existingSystemContext?.mode === "update") {
    const hasBoundary =
      nonEmptyArray(packet.existingSystemContext.doNotChange) ||
      nonEmptyArray(packet.existingSystemContext.reuseRequirements) ||
      nonEmptyArray(packet.existingSystemContext.compatibilityRequirements);
    if (!hasBoundary) {
      pushError(
        errors,
        `${path}.existingSystemContext`,
        "update_boundaries_missing",
        "Update handoffs require do_not_change, reuse, or compatibility boundaries.",
      );
    }
  }
}

function validatePacketRequirement(requirement, path, errors) {
  if (!isPlainObject(requirement)) {
    pushError(errors, path, "requirement_not_object", "Requirement must be an object.");
    return;
  }
  if (!isNonEmptyString(requirement.id)) {
    pushError(errors, `${path}.id`, "requirement_missing_id", "Requirement id is required.");
  }
  if (!isNonEmptyString(requirement.text)) {
    pushError(
      errors,
      `${path}.text`,
      "requirement_missing_text",
      "Requirement text is required.",
    );
  }
  if (!["functional", "nonfunctional", "negative", "constraint", "acceptance", "integration"].includes(requirement.type)) {
    pushError(
      errors,
      `${path}.type`,
      "requirement_invalid_type",
      "Requirement type is not supported.",
    );
  }
  if (!["must", "should", "could"].includes(requirement.priority)) {
    pushError(
      errors,
      `${path}.priority`,
      "requirement_invalid_priority",
      "Requirement priority is not supported.",
    );
  }
  if (!["confirmed", "contested"].includes(requirement.status)) {
    pushError(
      errors,
      `${path}.status`,
      "requirement_invalid_status",
      "Locked requirements must be confirmed or contested.",
    );
  }
  if (requirement.status !== "confirmed") {
    pushError(
      errors,
      `${path}.status`,
      "requirement_not_confirmed",
      "Locked handoffs must not contain proposed or unconfirmed requirements.",
    );
  }
  if (requirement.priority === "must" && !isNonEmptyString(requirement.acceptance)) {
    pushError(
      errors,
      `${path}.acceptance`,
      "must_requirement_missing_acceptance",
      "Must-level requirements require acceptance criteria.",
    );
  }
  if (!isNonEmptyString(requirement.sourceRef)) {
    pushError(
      errors,
      `${path}.sourceRef`,
      "requirement_missing_source_ref",
      "Requirement sourceRef is required.",
    );
  }
}

function validateLockedArtifact(artifact, path, errors) {
  if (!isPlainObject(artifact)) {
    pushError(errors, path, "locked_artifact_not_object", "lockedArtifact must be an object.");
    return;
  }
  if (!isSha256Fingerprint(artifact.packetContentHash)) {
    pushError(errors, `${path}.packetContentHash`, "locked_artifact_packet_hash_missing", "lockedArtifact.packetContentHash must be a SHA-256 fingerprint.");
  }
  for (const key of [
    "id",
    "sessionId",
    "lockedAt",
    "lockedByActorRef",
    "lockDecisionRef",
    "packetRef",
  ]) {
    if (!isNonEmptyString(artifact[key])) {
      pushError(
        errors,
        `${path}.${key}`,
        "locked_artifact_missing_field",
        `lockedArtifact.${key} is required.`,
      );
    }
  }
  if (artifact.lockedAt && !isCanonicalTimestamp(artifact.lockedAt)) {
    pushError(
      errors,
      `${path}.lockedAt`,
      "invalid_timestamp",
      "lockedAt must use UTC RFC3339 millisecond precision.",
    );
  }
}

function validateAuditState(auditState, path, errors) {
  if (!isPlainObject(auditState)) {
    pushError(errors, path, "audit_state_not_object", "auditState must be an object.");
    return;
  }
  validateNoUnknownKeys(auditState, AUDIT_STATE_KEYS, path, errors);
  validateDecisionAudit(auditState.decisions, `${path}.decisions`, errors);
  validateGovernance(auditState.governance, auditState.decisions, `${path}.governance`, errors);
  validateLineage(auditState.lineage, `${path}.lineage`, errors);
  validateDataPolicy(auditState.dataPolicy, `${path}.dataPolicy`, errors);
  validateRequiredArray(
    auditState.capabilityScopes,
    `${path}.capabilityScopes`,
    "capability_scopes_missing",
    errors,
  );
  validateRequiredArray(
    auditState.provenanceRecords,
    `${path}.provenanceRecords`,
    "provenance_records_missing",
    errors,
  );
  validateEvidence(auditState.evidence, `${path}.evidence`, errors);
  validateFreshnessPolicy(auditState.freshnessGate, auditState.evidence, `${path}.freshnessGate`, errors);
  validateRequiredArray(
    auditState.sensitivityClassifications,
    `${path}.sensitivityClassifications`,
    "sensitivity_classifications_missing",
    errors,
  );
  if (!Array.isArray(auditState.overrideDecisions)) {
    pushError(
      errors,
      `${path}.overrideDecisions`,
      "override_decisions_missing",
      "overrideDecisions must be an array.",
    );
  }
  if (!isPlainObject(auditState.lockMetadata)) {
    pushError(
      errors,
      `${path}.lockMetadata`,
      "lock_metadata_missing",
      "lockMetadata is required.",
    );
  }
}

function validateDecisionAudit(decisions, path, errors) {
  if (!Array.isArray(decisions) || decisions.length === 0) {
    pushError(errors, path, "decision_audit_missing", "decisions must be a non-empty array.");
    return;
  }
  const ids = new Set();
  const sequences = new Set();
  decisions.forEach((decision, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(decision)) {
      pushError(errors, itemPath, "decision_not_object", "Decision must be an object.");
      return;
    }
    if (!isNonEmptyString(decision.id)) {
      pushError(errors, `${itemPath}.id`, "decision_missing_id", "Decision id is required.");
    } else if (ids.has(decision.id)) {
      pushError(errors, `${itemPath}.id`, "duplicate_decision_id", "Decision ids must be unique.");
    } else {
      ids.add(decision.id);
    }
    if (!isNonNegativeInteger(decision.sequence)) {
      pushError(
        errors,
        `${itemPath}.sequence`,
        "decision_invalid_sequence",
        "Decision sequence must be a non-negative integer.",
      );
    } else if (sequences.has(decision.sequence)) {
      pushError(
        errors,
        `${itemPath}.sequence`,
        "duplicate_decision_sequence",
        "Decision sequence numbers must be unique.",
      );
    } else {
      sequences.add(decision.sequence);
    }
    if (!isCanonicalTimestamp(decision.at)) {
      pushError(
        errors,
        `${itemPath}.at`,
        "invalid_timestamp",
        "Decision at must use UTC RFC3339 millisecond precision.",
      );
    }
    if (!Array.isArray(decision.actorRoleRefs)) {
      pushError(
        errors,
        `${itemPath}.actorRoleRefs`,
        "decision_actor_roles_missing",
        "Decision actorRoleRefs must be an array.",
      );
    }
    if (!isSensitivityTag(decision.sensitivity)) {
      pushError(
        errors,
        `${itemPath}.sensitivity`,
        "decision_sensitivity_missing",
        "Decision valueSummary requires a sensitivity tag.",
      );
    }
  });
}

function validateGovernance(governance, decisions, path, errors) {
  if (!isPlainObject(governance)) {
    pushError(errors, path, "governance_missing", "governance is required.");
    return;
  }
  if (governance.model !== "single_approver_v1") {
    pushError(
      errors,
      `${path}.model`,
      "unsupported_governance_model",
      "governance.model must equal single_approver_v1.",
    );
  }
  if (!Array.isArray(governance.actorRoles) || governance.actorRoles.length === 0) {
    pushError(
      errors,
      `${path}.actorRoles`,
      "governance_actor_roles_missing",
      "governance.actorRoles must be non-empty.",
    );
  }
  const authority = governance.authority;
  if (!isPlainObject(authority)) {
    pushError(
      errors,
      `${path}.authority`,
      "governance_authority_missing",
      "governance.authority is required.",
    );
    return;
  }
  for (const key of [
    "lockRoleRefs",
    "approvalRoleRefs",
    "blockerDemotionRoleRefs",
    "policyGateRoleRefs",
  ]) {
    if (!Array.isArray(authority[key])) {
      pushError(
        errors,
        `${path}.authority.${key}`,
        "governance_authority_roles_missing",
        `governance.authority.${key} must be an array.`,
      );
    }
  }
  if (authority.requireSeparateApprover !== false || authority.quorum !== "single_actor") {
    pushError(
      errors,
      `${path}.authority`,
      "unsupported_governance_authority",
      "v1 supports only single_actor quorum without separate approver.",
    );
  }
  const decisionsById = new Map(
    Array.isArray(decisions) ? decisions.filter(isPlainObject).map((decision) => [decision.id, decision]) : [],
  );
  const lockDecision = decisionsById.get(governance.lockDecisionRef);
  if (!lockDecision) {
    pushError(
      errors,
      `${path}.lockDecisionRef`,
      "lock_decision_missing",
      "governance.lockDecisionRef must resolve to a DecisionRecord.",
    );
  } else if (!hasAnyRole(lockDecision.actorRoleRefs, authority.lockRoleRefs)) {
    pushError(
      errors,
      `${path}.lockDecisionRef`,
      "lock_decision_unauthorized",
      "Lock decision actor lacks a lock-authorized role.",
    );
  }
}

function validateLineage(lineage, path, errors) {
  if (!isPlainObject(lineage)) {
    pushError(errors, path, "lineage_missing", "lineage is required.");
    return;
  }
  if (!["root", "amendment", "migration", "relock"].includes(lineage.relationship)) {
    pushError(
      errors,
      `${path}.relationship`,
      "lineage_invalid_relationship",
      "lineage.relationship is not supported.",
    );
  }
  if (lineage.relationship === "root") {
    for (const key of ["parentHandoffId", "parentLockedArtifactId", "amendmentDecisionRef"]) {
      if (lineage[key] !== undefined) {
        pushError(
          errors,
          `${path}.${key}`,
          "root_lineage_has_parent_ref",
          "Root lineage must not include parent refs.",
        );
      }
    }
  }
  if (!Array.isArray(lineage.supersedesHandoffRefs)) {
    pushError(
      errors,
      `${path}.supersedesHandoffRefs`,
      "lineage_supersedes_missing",
      "lineage.supersedesHandoffRefs must be an array.",
    );
  }
}

function validateDataPolicy(dataPolicy, path, errors) {
  if (!isPlainObject(dataPolicy)) {
    pushError(errors, path, "data_policy_missing", "dataPolicy is required.");
    return;
  }
  if (!["public", "internal", "confidential", "pii", "regulated", "secret", "unknown"].includes(dataPolicy.classification)) {
    pushError(
      errors,
      `${path}.classification`,
      "data_policy_invalid_classification",
      "dataPolicy.classification is not supported.",
    );
  }
  if (typeof dataPolicy.allowSensitivePersistence !== "boolean") {
    pushError(
      errors,
      `${path}.allowSensitivePersistence`,
      "data_policy_persistence_missing",
      "dataPolicy.allowSensitivePersistence must be boolean.",
    );
  }
  if (!Array.isArray(dataPolicy.sensitiveFieldRefs)) {
    pushError(
      errors,
      `${path}.sensitiveFieldRefs`,
      "data_policy_sensitive_fields_missing",
      "dataPolicy.sensitiveFieldRefs must be an array.",
    );
  }
  if (!Array.isArray(dataPolicy.redactions)) {
    pushError(
      errors,
      `${path}.redactions`,
      "data_policy_redactions_missing",
      "dataPolicy.redactions must be an array.",
    );
  }
  if (!Array.isArray(dataPolicy.policyDecisionRefs)) {
    pushError(
      errors,
      `${path}.policyDecisionRefs`,
      "data_policy_policy_decisions_missing",
      "dataPolicy.policyDecisionRefs must be an array.",
    );
  }
  if (dataPolicy.maxCanonicalBytes !== MAX_CANONICAL_BYTES_V1) {
    pushError(
      errors,
      `${path}.maxCanonicalBytes`,
      "data_policy_invalid_max_bytes",
      "dataPolicy.maxCanonicalBytes must equal the v1 1 MiB limit.",
    );
  }
}

function validatePersistedSensitivity(handoff, errors) {
  const policy = handoff.dataPolicy;
  if (!isPlainObject(policy)) return;
  const classes = ["public", "internal", "confidential", "pii", "regulated", "secret", "unknown"];
  let maximum = 0;
  const decisions = Array.isArray(handoff.decisionAudit) ? handoff.decisionAudit : [];
  const bindings = handoff.governance?.actorRoles;
  const gateRoles = handoff.governance?.authority?.policyGateRoleRefs;

  function visit(value, pointer) {
    if (Array.isArray(value)) {
      value.forEach((item, index) => visit(item, `${pointer}/${item?.id ?? index}`));
      return;
    }
    if (!isPlainObject(value)) return;
    for (const [key, tag] of Object.entries(value)) {
      if (key === "sensitivity" || key.endsWith("Sensitivity")) {
        const textKey = key === "sensitivity"
          ? ["text", "summary", "valueSummary", "name"].find((candidate) => typeof value[candidate] === "string")
          : key.slice(0, -"Sensitivity".length);
        const fieldRef = `${pointer}/${textKey ?? "text"}`;
        const rank = classes.indexOf(tag?.classification);
        if (!isSensitivityTag(tag) || rank < 0) {
          pushError(errors, fieldRef, "invalid_sensitivity_classification", "Persisted sensitivity tags must use a supported classification.");
          continue;
        }
        maximum = Math.max(maximum, rank);
        if (tag.classification === "secret") {
          pushError(errors, fieldRef, "secret_persistence_forbidden", "Secret text must be redacted and classified for its replacement before handoff build.");
        } else if (rank >= classes.indexOf("confidential")) {
          if (policy.allowSensitivePersistence !== true || !policy.sensitiveFieldRefs?.includes(fieldRef)) {
            pushError(errors, fieldRef, "sensitive_persistence_unauthorized", "Sensitive text requires explicit persistence permission for its field.");
          }
          if (tag.classification === "unknown") {
            const authorized = tag.policyDecisionRefs.some((ref) => {
              if (!policy.policyDecisionRefs?.includes(ref)) return false;
              const decision = decisions.find((item) => item?.id === ref);
              const binding = Array.isArray(bindings) ? bindings.find((item) => item?.actorRef === decision?.actorRef) : undefined;
              return decision?.kind === "policy_gate" &&
                hasAnyRole(decision.actorRoleRefs, gateRoles) &&
                hasAnyRole(binding?.roleRefs, decision.actorRoleRefs?.filter((role) => gateRoles?.includes(role)));
            });
            if (!authorized) {
              pushError(errors, fieldRef, "sensitivity_policy_gate_missing", "Unknown text requires an authorized policy-gate decision cited by the field and data policy.");
            }
          }
        }
      } else {
        visit(tag, `${pointer}/${key}`);
      }
    }
  }

  visit(handoff, "");
  if (policy.classification !== classes[maximum]) {
    pushError(errors, "$.dataPolicy.classification", "data_policy_classification_mismatch", "Data policy classification must match the maximum persisted text classification.");
  }
}

function validateEvidence(evidence, path, errors) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    pushError(errors, path, "evidence_missing", "evidence must be a non-empty array.");
    return;
  }
  validateUniqueLocalIds(evidence, path, errors);
  evidence.forEach((entry, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isPlainObject(entry)) {
      pushError(errors, itemPath, "evidence_not_object", "Evidence must be an object.");
      return;
    }
    for (const key of ["id", "source", "ref", "summary", "capturedAt"]) {
      if (!isNonEmptyString(entry[key])) {
        pushError(
          errors,
          `${itemPath}.${key}`,
          "evidence_missing_field",
          `Evidence ${key} is required.`,
        );
      }
    }
    if (!isCanonicalTimestamp(entry.capturedAt)) {
      pushError(
        errors,
        `${itemPath}.capturedAt`,
        "invalid_timestamp",
        "Evidence capturedAt must use UTC RFC3339 millisecond precision.",
      );
    }
    if (!isPlainObject(entry.freshness) || !isNonEmptyString(entry.freshness.kind) || !isNonEmptyString(entry.freshness.value)) {
      pushError(
        errors,
        `${itemPath}.freshness`,
        "evidence_freshness_missing",
        "Evidence freshness kind and value are required.",
      );
    }
    if (!isSensitivityTag(entry.sensitivity)) {
      pushError(
        errors,
        `${itemPath}.sensitivity`,
        "evidence_sensitivity_missing",
        "Evidence summary requires a sensitivity tag.",
      );
    }
  });
}

function validateFreshnessPolicy(freshnessGate, evidence, path, errors) {
  if (!isPlainObject(freshnessGate)) {
    pushError(errors, path, "freshness_gate_missing", "freshnessGate is required.");
    return;
  }
  if (!isNonEmptyString(freshnessGate.id)) {
    pushError(errors, `${path}.id`, "freshness_gate_missing_id", "freshnessGate id is required.");
  }
  if (
    freshnessGate.requiredBeforePlanning !== true ||
    freshnessGate.requiredBeforeExecutionResume !== true
  ) {
    pushError(
      errors,
      path,
      "freshness_gate_required_flags_missing",
      "freshnessGate must be required before planning and execution resume.",
    );
  }
  if (!Array.isArray(freshnessGate.evidenceRefs)) {
    pushError(
      errors,
      `${path}.evidenceRefs`,
      "freshness_gate_evidence_refs_missing",
      "freshnessGate.evidenceRefs must be an array.",
    );
    return;
  }
  const evidenceIds = new Set(Array.isArray(evidence) ? evidence.filter(isPlainObject).map((entry) => entry.id) : []);
  if ([...evidenceIds].some((id) => !freshnessGate.evidenceRefs.includes(id))) {
    pushError(errors, `${path}.evidenceRefs`, "freshness_gate_evidence_missing", "Freshness gate must cover every locked evidence item.");
  }
  for (const evidenceRef of freshnessGate.evidenceRefs) {
    if (!evidenceIds.has(evidenceRef)) {
      pushError(
        errors,
        `${path}.evidenceRefs`,
        "freshness_gate_unknown_evidence_ref",
        "freshnessGate.evidenceRefs must resolve to auditState.evidence.",
      );
    }
  }
}

function validateRequiredArray(value, path, code, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    pushError(errors, path, code, `${path} must be a non-empty array.`);
  }
}

function createInputHashes({ packet, lockedArtifact, auditState, compilerProfileId }) {
  const normalizedPacket = canonicalClone(packet);
  const normalizedLockedArtifact = canonicalClone(lockedArtifact);
  const normalizedAuditState = canonicalClone(auditState);
  return canonicalClone({
    packet: inputHash(normalizedPacket),
    lockedArtifact: inputHash(normalizedLockedArtifact),
    auditState: inputHash(normalizedAuditState),
    buildInput: inputHash({
      packet: normalizedPacket,
      lockedArtifact: normalizedLockedArtifact,
      auditState: normalizedAuditState,
      compilerProfileId,
    }),
  });
}

function inputHash(value) {
  return {
    algorithm: HASH_ALGORITHM,
    canonicalizationVersion: PLANNING_HANDOFF_CANONICALIZATION_VERSION,
    value: sha256Canonical(value),
  };
}

function deterministicHandoffId(input) {
  return `handoff:${sha256Canonical(input).slice("sha256:".length)}`;
}

function canonicalRequirements(packet, sensitivityIndex) {
  return (packet.requirements ?? [])
    .filter((requirement) => requirement.type !== "negative")
    .map((requirement) => {
      const id = namespaceRef("requirement", requirement.id);
      return {
        id,
        text: normalizeProseString(requirement.text),
        sensitivity: getSensitivity(
          sensitivityIndex,
          `/packet/requirements/${requirement.id}/text`,
        ),
        type: requirement.type,
        priority: requirement.priority,
        status: requirement.status,
        sourceRef: namespaceSourceRef(requirement.sourceRef),
        acceptanceCriteriaRefs: [
          namespaceRef("acceptance", `${requirement.id}:acceptance`),
        ],
        evidenceRefs: normalizeRefArray(requirement.evidenceRefs),
        grounding: normalizeGrounding(requirement.grounding, {
          sourceRef: namespaceSourceRef(requirement.sourceRef),
          evidenceRefs: normalizeRefArray(requirement.evidenceRefs),
        }),
      };
    });
}

function canonicalAcceptance(packet, sensitivityIndex) {
  return (packet.requirements ?? [])
    .filter((requirement) => requirement.type !== "negative")
    .map((requirement) => {
      const id = namespaceRef("acceptance", `${requirement.id}:acceptance`);
      return {
        id,
        requirementRef: namespaceRef("requirement", requirement.id),
        text: normalizeProseString(requirement.acceptance),
        sensitivity: getSensitivity(
          sensitivityIndex,
          `/packet/requirements/${requirement.id}/acceptance`,
        ),
        sourceRef: namespaceSourceRef(requirement.sourceRef),
        evidenceRefs: normalizeRefArray(requirement.evidenceRefs),
        grounding: normalizeGrounding(requirement.grounding, {
          sourceRef: namespaceSourceRef(requirement.sourceRef),
          evidenceRefs: normalizeRefArray(requirement.evidenceRefs),
        }),
      };
    });
}

function canonicalNegativeRequirements(packet, sensitivityIndex) {
  const fromRequirements = (packet.requirements ?? [])
    .filter((requirement) => requirement.type === "negative")
    .map((requirement) => ({
      id: namespaceRef("negative_requirement", requirement.id),
      text: normalizeProseString(requirement.text),
      sensitivity: getSensitivity(
        sensitivityIndex,
        `/packet/requirements/${requirement.id}/text`,
      ),
      sourceRef: namespaceSourceRef(requirement.sourceRef),
      grounding: normalizeGrounding(requirement.grounding, {
        sourceRef: namespaceSourceRef(requirement.sourceRef),
        evidenceRefs: normalizeRefArray(requirement.evidenceRefs),
      }),
      evidenceRefs: normalizeRefArray(requirement.evidenceRefs),
      relatedRequirementRefs: normalizeRelatedRequirementRefs(requirement),
      verificationObligationRef: namespaceRef(
        "verification_obligation",
        `negative:${requirement.id}`,
      ),
    }));

  const fromScope = (packet.scope?.negativeRequirements ?? []).map((text, index) => {
    const object = typeof text === "string" ? { text } : text;
    const idSuffix =
      object?.id ?? `scope-negative-${String(index + 1).padStart(3, "0")}`;
    const sourceRef = namespaceSourceRef(
      object?.sourceRef ?? packet.lockDecisionRef ?? "external:packet:scope",
    );
    const evidenceRefs = normalizeRefArray(object?.evidenceRefs);
    return {
      id: namespaceRef("negative_requirement", idSuffix),
      text: normalizeProseString(object?.text),
      sensitivity: getSensitivity(
        sensitivityIndex,
        `/packet/scope/negativeRequirements/${idSuffix}/text`,
      ),
      sourceRef,
      grounding: normalizeGrounding(object?.grounding, {
        sourceRef,
        evidenceRefs,
      }),
      evidenceRefs,
      relatedRequirementRefs: normalizeRelatedRequirementRefs(object),
      verificationObligationRef: namespaceRef(
        "verification_obligation",
        `negative:${idSuffix}`,
      ),
    };
  });

  return [...fromRequirements, ...fromScope];
}

function canonicalTargetSurfaces(packet, sensitivityIndex) {
  return (packet.existingSystemContext?.targetSurfaces ?? []).map((surface) => ({
    id: namespaceRef("target_surface", surface.id),
    kind: normalizeIdentityString(surface.kind),
    name: normalizeProseString(surface.name),
    sensitivity: getOptionalSensitivity(
      sensitivityIndex,
      `/packet/existingSystemContext/targetSurfaces/${surface.id}/name`,
    ),
    sourceRef: namespaceSourceRef(surface.sourceRef ?? "external:packet:targetSurface"),
    evidenceRefs: normalizeRefArray(surface.evidenceRefs),
    grounding: normalizeGrounding(surface.grounding, {
      sourceRef: namespaceSourceRef(surface.sourceRef ?? "external:packet:targetSurface"),
      evidenceRefs: normalizeRefArray(surface.evidenceRefs),
    }),
  }));
}

function canonicalBoundaries(packet, sensitivityIndex) {
  const context = packet.existingSystemContext ?? {};
  const groups = [
    ["do_not_change", context.doNotChange ?? []],
    ["reuse", context.reuseRequirements ?? []],
    ["compatibility", context.compatibilityRequirements ?? []],
    ["scope_out", packet.scope?.outOfScope ?? []],
    ["migration", context.migrationConcerns ?? []],
  ];
  return groups.flatMap(([kind, entries]) =>
    entries.map((entry, index) => {
      const text = typeof entry === "string" ? entry : entry.text;
      const sourceRef =
        typeof entry === "object" && entry !== null
          ? entry.sourceRef
          : "external:packet:boundary";
      const suffix =
        typeof entry === "object" && entry !== null && entry.id
          ? entry.id
          : `${kind}-${String(index + 1).padStart(3, "0")}`;
      return {
        id: namespaceRef("boundary", suffix),
        kind,
        text: normalizeProseString(text),
        sensitivity: getOptionalSensitivity(
          sensitivityIndex,
          `/packet/boundaries/${suffix}/text`,
        ),
        sourceRef: namespaceSourceRef(sourceRef),
        grounding: normalizeGrounding(entry?.grounding, {
          sourceRef: namespaceSourceRef(sourceRef),
          evidenceRefs: normalizeRefArray(entry?.evidenceRefs),
        }),
        evidenceRefs: normalizeRefArray(entry?.evidenceRefs),
        relatedRequirementRefs: normalizeRelatedRequirementRefs(entry),
        ...(["do_not_change", "reuse", "compatibility"].includes(kind)
          ? {
              verificationObligationRef: namespaceRef(
                "verification_obligation",
                `${kind}:${suffix}`,
              ),
            }
          : {}),
      };
    }),
  );
}

function canonicalAssumptions(packet, sensitivityIndex) {
  return normalizeTextFactArray(packet.assumptions ?? [], "assumption", sensitivityIndex);
}

function canonicalRisks(packet, sensitivityIndex) {
  return normalizeTextFactArray(packet.risks ?? [], "risk", sensitivityIndex).map((risk) => ({
    ...risk,
    severity: risk.severity ?? "concern",
  }));
}

function normalizeTextFactArray(items, kind, sensitivityIndex) {
  return items.map((item, index) => {
    const object = typeof item === "string" ? { text: item } : item;
    const suffix = object.id ?? `${kind}-${String(index + 1).padStart(3, "0")}`;
    const sourceRef = namespaceSourceRef(object.sourceRef ?? "external:packet");
    return {
      id: namespaceRef(kind, suffix),
      text: normalizeProseString(object.text),
      sensitivity: getSensitivity(sensitivityIndex, `/packet/${kind}s/${suffix}/text`),
      sourceRef,
      grounding: normalizeGrounding(object.grounding, {
        sourceRef,
        evidenceRefs: normalizeRefArray(object.evidenceRefs),
      }),
      ...(object.demotedFromFindingRef
        ? { demotedFromFindingRef: namespaceSourceRef(object.demotedFromFindingRef) }
        : {}),
      ...(object.overrideDecisionRef
        ? { overrideDecisionRef: namespaceRef("override", object.overrideDecisionRef) }
        : {}),
    };
  });
}

function canonicalSemanticObligations(packet, sensitivityIndex) {
  return (packet.semanticObligations ?? []).map((obligation, index) => {
    const suffix = obligation.id ?? `semantic-${String(index + 1).padStart(3, "0")}`;
    const sourceRef = namespaceSourceRef(obligation.sourceRef ?? "external:packet:semantic");
    return {
      id: namespaceRef("semantic_obligation", suffix),
      kind: obligation.kind ?? "semantic_fidelity",
      text: normalizeProseString(obligation.text),
      sensitivity: getSensitivity(
        sensitivityIndex,
        `/packet/semanticObligations/${suffix}/text`,
      ),
      priority: obligation.priority ?? "should",
      sourceRef,
      grounding: normalizeGrounding(obligation.grounding, {
        sourceRef,
        evidenceRefs: normalizeRefArray(obligation.evidenceRefs),
      }),
      requiredReview: true,
      verificationObligationRef: namespaceRef("verification_obligation", `semantic:${suffix}`),
    };
  });
}

function canonicalVerificationObligations({
  requirements,
  acceptanceCriteria,
  negativeRequirements,
  boundaries,
  semanticObligations,
}) {
  const acceptanceByRequirement = new Map();
  for (const criterion of acceptanceCriteria) {
    const list = acceptanceByRequirement.get(criterion.requirementRef) ?? [];
    list.push(criterion);
    acceptanceByRequirement.set(criterion.requirementRef, list);
  }
  const safetyObligationsByRequirement = new Map();
  for (const item of [
    ...negativeRequirements,
    ...boundaries.filter((boundary) => boundary.verificationObligationRef),
  ]) {
    for (const requirementRef of item.relatedRequirementRefs ?? []) {
      const list = safetyObligationsByRequirement.get(requirementRef) ?? [];
      list.push(item.verificationObligationRef);
      safetyObligationsByRequirement.set(requirementRef, list);
    }
  }

  const requirementObligations = requirements
    .filter((requirement) => requirement.priority === "must")
    .map((requirement) => {
      const related = (acceptanceByRequirement.get(requirement.id) ?? []).map((criterion) =>
        namespaceRef("verification_obligation", `acceptance:${localSuffix(criterion.id)}`),
      );
      related.push(...(safetyObligationsByRequirement.get(requirement.id) ?? []));
      return {
        id: namespaceRef("verification_obligation", `requirement:${localSuffix(requirement.id)}`),
        kind: "requirement",
        sourceRef: requirement.id,
        sourceRefs: [requirement.id],
        requirementRef: requirement.id,
        relatedObligationRefs: related,
        text: requirement.text,
        sensitivity: requirement.sensitivity,
        priority: requirement.priority,
        requiredMapping: true,
      };
    });

  const acceptanceObligations = acceptanceCriteria.map((criterion) => {
    const requirementObligationRef = namespaceRef(
      "verification_obligation",
      `requirement:${localSuffix(criterion.requirementRef)}`,
    );
    return {
      id: namespaceRef("verification_obligation", `acceptance:${localSuffix(criterion.id)}`),
      kind: "acceptance",
      sourceRef: criterion.id,
      sourceRefs: [criterion.id, criterion.requirementRef],
      acceptanceCriterionRef: criterion.id,
      requirementRef: criterion.requirementRef,
      relatedObligationRefs: [requirementObligationRef],
      text: criterion.text,
      sensitivity: criterion.sensitivity,
      priority: "must",
      requiredMapping: true,
    };
  });

  const negativeObligations = negativeRequirements.map((negativeRequirement) => ({
    id: negativeRequirement.verificationObligationRef,
    kind: "negative",
    sourceRef: negativeRequirement.id,
    sourceRefs: [negativeRequirement.id],
    negativeRequirementRef: negativeRequirement.id,
    relatedRequirementRefs: normalizeRefArray(negativeRequirement.relatedRequirementRefs),
    relatedObligationRefs: verificationObligationRefsForRequirements(
      negativeRequirement.relatedRequirementRefs,
    ),
    text: negativeRequirement.text,
    sensitivity: negativeRequirement.sensitivity,
    priority: "must",
    requiredMapping: true,
  }));

  const boundaryObligations = boundaries
    .filter((boundary) => boundary.verificationObligationRef)
    .map((boundary) => ({
      id: boundary.verificationObligationRef,
      kind: boundary.kind,
      sourceRef: boundary.id,
      sourceRefs: [boundary.id],
      boundaryRef: boundary.id,
      relatedRequirementRefs: normalizeRefArray(boundary.relatedRequirementRefs),
      relatedObligationRefs: verificationObligationRefsForRequirements(
        boundary.relatedRequirementRefs,
      ),
      text: boundary.text,
      sensitivity: boundary.sensitivity,
      priority: "must",
      requiredMapping: true,
    }));

  const semanticVerificationObligations = semanticObligations.map((obligation) => ({
    id: obligation.verificationObligationRef,
    kind: "semantic",
    sourceRef: obligation.id,
    sourceRefs: [obligation.id],
    semanticObligationRef: obligation.id,
    relatedObligationRefs: [],
    text: obligation.text,
    sensitivity: obligation.sensitivity,
    priority: obligation.priority,
    requiredMapping: true,
  }));

  return [
    ...requirementObligations,
    ...acceptanceObligations,
    ...negativeObligations,
    ...boundaryObligations,
    ...semanticVerificationObligations,
  ];
}

function attachVerificationRefs({
  negativeRequirements,
  boundaries,
  semanticObligations,
  verificationObligations,
}) {
  const obligationIds = new Set(verificationObligations.map((obligation) => obligation.id));
  for (const item of [...negativeRequirements, ...boundaries, ...semanticObligations]) {
    if (item.verificationObligationRef && !obligationIds.has(item.verificationObligationRef)) {
      throw new PlanningHandoffValidationError("Invalid verification obligation linkage.", {
        sourceRef: item.id,
        verificationObligationRef: item.verificationObligationRef,
      });
    }
  }
}

function canonicalPlannerInputs({
  requirements,
  acceptanceCriteria,
  boundaries,
  semanticObligations,
  verificationObligations,
  findings,
  sensitivityIndex,
}) {
  const obligationRefsByRequirement = new Map();
  for (const obligation of verificationObligations) {
    if (obligation.requirementRef) {
      const list = obligationRefsByRequirement.get(obligation.requirementRef) ?? [];
      list.push(obligation.id);
      obligationRefsByRequirement.set(obligation.requirementRef, list);
    }
  }
  for (const criterion of acceptanceCriteria) {
    const obligation = verificationObligations.find(
      (candidate) => candidate.acceptanceCriterionRef === criterion.id,
    );
    if (obligation) {
      const list = obligationRefsByRequirement.get(criterion.requirementRef) ?? [];
      list.push(obligation.id);
      obligationRefsByRequirement.set(criterion.requirementRef, list);
    }
  }

  const featureChecklistSeeds = requirements.map((requirement) => ({
    id: namespaceRef("coverage", `seed:${localSuffix(requirement.id)}`),
    text: requirement.text,
    sensitivity: requirement.sensitivity,
    sourceRef: requirement.sourceRef,
    requirementRefs: [requirement.id],
    verificationObligationRefs: uniqueSortedStrings(
      obligationRefsByRequirement.get(requirement.id) ?? [],
    ),
    grounding: requirement.grounding,
  }));

  const openNonBlockingConcerns = (findings ?? [])
    .filter((finding) => finding && finding.resolved !== true && finding.sev !== "blocker")
    .map((finding) => {
      const suffix = finding.id ?? "concern";
      return {
        id: namespaceRef("coverage", `concern:${suffix}`),
        sourceFindingRef: namespaceRef("external", `packet-finding:${suffix}`),
        text: normalizeProseString(finding.text),
        sensitivity: getOptionalSensitivity(
          sensitivityIndex,
          `/packet/findings/${suffix}/text`,
        ),
        sourceRef: namespaceSourceRef(finding.ref ?? "external:packet:finding"),
        grounding: normalizeGrounding(null, {
          sourceRef: namespaceSourceRef(finding.ref ?? "external:packet:finding"),
          evidenceRefs: [],
        }),
      };
    });

  return {
    featureChecklistSeeds,
    doNotChangeBoundaryRefs: boundaries
      .filter((boundary) => boundary.kind === "do_not_change")
      .map((boundary) => boundary.id),
    reuseBoundaryRefs: boundaries
      .filter((boundary) => boundary.kind === "reuse")
      .map((boundary) => boundary.id),
    compatibilityBoundaryRefs: boundaries
      .filter((boundary) => boundary.kind === "compatibility")
      .map((boundary) => boundary.id),
    openNonBlockingConcerns,
  };
}

function assertEvidenceUse({ handoffEvidence, packet, provenanceRecords }) {
  const auditEvidenceIds = new Set(handoffEvidence.map((entry) => entry.id));
  const used = new Set();

  collectEvidenceRefs(packet, used);
  collectEvidenceRefs(provenanceRecords, used);

  for (const ref of used) {
    if (!auditEvidenceIds.has(ref)) {
      throw new PlanningHandoffValidationError("Invalid planning handoff input.", {
        errors: [
          {
            path: "$.auditState.evidence",
            code: "packet_evidence_ref_missing",
            message: `Evidence ref ${ref} is used by the packet but absent from auditState.evidence.`,
          },
        ],
      });
    }
  }
  for (const ref of auditEvidenceIds) {
    if (!used.has(ref)) {
      throw new PlanningHandoffValidationError("Invalid planning handoff input.", {
        errors: [
          {
            path: "$.auditState.evidence",
            code: "unused_audit_evidence",
            message: `Evidence ref ${ref} is present in auditState.evidence but unused by packet facts.`,
          },
        ],
      });
    }
  }
}

function collectEvidenceRefs(value, refs) {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectEvidenceRefs(entry, refs));
    return;
  }
  if (!isPlainObject(value)) return;
  if (Array.isArray(value.evidenceRefs)) {
    for (const ref of value.evidenceRefs) {
      if (typeof ref === "string") refs.add(ref);
    }
  }
  if (typeof value.evidenceRef === "string") {
    refs.add(value.evidenceRef);
  }
  for (const child of Object.values(value)) {
    collectEvidenceRefs(child, refs);
  }
}

function createSensitivityIndex(auditState) {
  const index = new Map();
  for (const assignment of auditState.sensitivityClassifications ?? []) {
    if (isPlainObject(assignment) && typeof assignment.fieldRef === "string") {
      index.set(assignment.fieldRef, canonicalClone(assignment.sensitivity));
    }
  }
  return index;
}

function getSensitivity(index, fieldRef) {
  const sensitivity = index.get(fieldRef);
  if (!isSensitivityTag(sensitivity)) {
    throw new PlanningHandoffValidationError("Invalid planning handoff input.", {
      errors: [
        {
          path: "$.auditState.sensitivityClassifications",
          code: "missing_sensitivity_classification",
          message: `Missing sensitivity classification for ${fieldRef}.`,
        },
      ],
    });
  }
  return canonicalClone(sensitivity);
}

function getOptionalSensitivity(index, fieldRef) {
  const sensitivity = index.get(fieldRef);
  if (isSensitivityTag(sensitivity)) return canonicalClone(sensitivity);
  return publicSensitivity();
}

function publicSensitivity() {
  return {
    classification: "public",
    redactionRefs: [],
    policyDecisionRefs: [],
  };
}

function normalizeGrounding(grounding, fallback) {
  if (isPlainObject(grounding)) {
    return canonicalClone({
      status: grounding.status ?? "grounded",
      confidence: grounding.confidence ?? "high",
      sourceFactRefs: normalizeRefArray(grounding.sourceFactRefs),
      evidenceRefs: normalizeRefArray(grounding.evidenceRefs),
      decisionRefs: normalizeRefArray(grounding.decisionRefs),
      assumptionRefs: normalizeRefArray(grounding.assumptionRefs),
      provenanceRefs: normalizeRefArray(grounding.provenanceRefs),
    });
  }
  return {
    status: "grounded",
    confidence: "high",
    sourceFactRefs: [],
    evidenceRefs: normalizeRefArray(fallback.evidenceRefs),
    decisionRefs:
      fallback.sourceRef && fallback.sourceRef.startsWith("decision:")
        ? [fallback.sourceRef]
        : [],
    assumptionRefs: [],
    provenanceRefs: [],
  };
}

function classifyEvidenceFreshness(evidence, observation) {
  if (!evidence) {
    return {
      evidenceRef: "unknown",
      state: "hard_stale",
      reason: "locked_evidence_missing",
    };
  }
  if (!observation) {
    return {
      evidenceRef: evidence.id,
      state: "hard_stale",
      reason: "observation_missing",
    };
  }
  if (!observation.observedFreshness) {
    return {
      evidenceRef: evidence.id,
      state: "hard_stale",
      reason: "observation_missing",
    };
  }
  if (observation.observedFreshness.kind !== evidence.freshness.kind) {
    return {
      evidenceRef: evidence.id,
      state: "hard_stale",
      reason: "kind_mismatch",
      observedFreshness: canonicalClone(observation.observedFreshness),
    };
  }
  if (observation.sourceIdentity !== "verified") {
    return {
      evidenceRef: evidence.id,
      state: "hard_stale",
      reason: "source_identity_unverified",
      observedFreshness: canonicalClone(observation.observedFreshness),
    };
  }
  if (observation.lockedEvidence !== "resolvable") {
    return {
      evidenceRef: evidence.id,
      state: "hard_stale",
      reason: "locked_evidence_missing",
      observedFreshness: canonicalClone(observation.observedFreshness),
    };
  }

  const lockedValue = normalizeIdentityString(evidence.freshness.value);
  const observedValue = normalizeIdentityString(observation.observedFreshness.value);
  if (lockedValue === observedValue) {
    return {
      evidenceRef: evidence.id,
      state: "clean_resume",
      reason: "exact_match",
      observedFreshness: canonicalClone(observation.observedFreshness),
    };
  }

  if (evidence.freshness.kind === "external_timestamp") {
    if (!isCanonicalTimestamp(lockedValue) || !isCanonicalTimestamp(observedValue)) {
      return {
        evidenceRef: evidence.id,
        state: "hard_stale",
        reason: "unparsable_timestamp",
        observedFreshness: canonicalClone(observation.observedFreshness),
      };
    }
    return {
      evidenceRef: evidence.id,
      state: observedValue > lockedValue ? "soft_stale" : "hard_stale",
      reason: "different_resolvable_value",
      observedFreshness: canonicalClone(observation.observedFreshness),
    };
  }

  if (evidence.freshness.kind === "upload_sha256") {
    return {
      evidenceRef: evidence.id,
      state: "hard_stale",
      reason: "different_resolvable_value",
      observedFreshness: canonicalClone(observation.observedFreshness),
    };
  }

  return {
    evidenceRef: evidence.id,
    state: "soft_stale",
    reason: "different_resolvable_value",
    observedFreshness: canonicalClone(observation.observedFreshness),
  };
}

function validateSourcePacket(sourcePacket, path, errors) {
  if (!isPlainObject(sourcePacket)) {
    pushError(errors, path, "source_packet_missing", "sourcePacket is required.");
    return;
  }
  if (!isNonEmptyString(sourcePacket.sessionId)) {
    pushError(errors, `${path}.sessionId`, "source_packet_session_missing", "sessionId is required.");
  }
  if (!isNonNegativeInteger(sourcePacket.iteration)) {
    pushError(
      errors,
      `${path}.iteration`,
      "source_packet_iteration_invalid",
      "iteration must be a non-negative integer.",
    );
  }
  if (!SUPPORTED_PACKET_CONTRACT_VERSIONS_V1.includes(sourcePacket.contractVersion)) {
    pushError(
      errors,
      `${path}.contractVersion`,
      "source_packet_version_invalid",
      "source packet contract version is unsupported.",
    );
  }
  if (!isSha256Fingerprint(sourcePacket.contentHash)) {
    pushError(
      errors,
      `${path}.contentHash`,
      "source_packet_hash_invalid",
      "sourcePacket.contentHash must be sha256:<64 lowercase hex characters>.",
    );
  }
}

function validateInputHashes(inputHashes, path, errors) {
  if (!isPlainObject(inputHashes)) {
    pushError(errors, path, "input_hashes_missing", "inputHashes is required.");
    return;
  }
  for (const key of ["packet", "lockedArtifact", "auditState", "buildInput"]) {
    const hash = inputHashes[key];
    if (!isPlainObject(hash)) {
      pushError(errors, `${path}.${key}`, "input_hash_missing", `${key} hash is required.`);
      continue;
    }
    if (hash.algorithm !== HASH_ALGORITHM) {
      pushError(
        errors,
        `${path}.${key}.algorithm`,
        "input_hash_algorithm_invalid",
        "input hash algorithm must be sha256.",
      );
    }
    if (hash.canonicalizationVersion !== PLANNING_HANDOFF_CANONICALIZATION_VERSION) {
      pushError(
        errors,
        `${path}.${key}.canonicalizationVersion`,
        "input_hash_canonicalization_invalid",
        "input hash canonicalizationVersion is unsupported.",
      );
    }
    if (!isSha256Fingerprint(hash.value)) {
      pushError(
        errors,
        `${path}.${key}.value`,
        "input_hash_value_invalid",
        "input hash value must be sha256:<64 lowercase hex characters>.",
      );
    }
  }
}

function validateCompilerProfile(profile, path, errors) {
  if (!isPlainObject(profile)) {
    pushError(errors, path, "compiler_profile_missing", "compilerProfile is required.");
    return;
  }
  const expected = DEFAULT_PLANNING_HANDOFF_COMPILER_PROFILE;
  for (const [key, value] of Object.entries(expected)) {
    if (profile[key] !== value) {
      pushError(
        errors,
        `${path}.${key}`,
        "compiler_profile_mismatch",
        `compilerProfile.${key} must equal ${value}.`,
      );
    }
  }
}

function validateCollection(value, path, errors) {
  if (!Array.isArray(value)) {
    pushError(errors, path, "collection_missing", `${path} must be an array.`);
    return;
  }
  value.forEach((item, index) => {
    if (!isPlainObject(item) || !isNonEmptyString(item.id)) {
      pushError(errors, `${path}[${index}]`, "collection_item_invalid", "Collection items must be objects with an id.");
    }
  });
  validateUniqueLocalIds(value, path, errors);
}

function validateRequirementLinks(handoff, errors) {
  const requirementIds = new Set(handoff.requirements?.map((item) => item.id));
  const acceptanceIds = new Set(handoff.acceptanceCriteria?.map((item) => item.id));
  for (const requirement of handoff.requirements ?? []) {
    for (const ref of requirement.acceptanceCriteriaRefs ?? []) {
      if (!acceptanceIds.has(ref)) {
        pushError(
          errors,
          "$.requirements",
          "requirement_acceptance_ref_unresolved",
          "Requirement acceptanceCriteriaRefs must resolve.",
        );
      }
    }
  }
  for (const criterion of handoff.acceptanceCriteria ?? []) {
    if (!requirementIds.has(criterion.requirementRef)) {
      pushError(
        errors,
        "$.acceptanceCriteria",
        "acceptance_requirement_ref_unresolved",
        "Acceptance criterion requirementRef must resolve.",
      );
    }
  }
}

function validateVerificationLinks(handoff, errors) {
  const obligationIds = new Set(handoff.verificationObligations?.map((item) => item.id));
  const requirementIds = new Set(handoff.requirements?.map((item) => item.id));
  const acceptanceIds = new Set(handoff.acceptanceCriteria?.map((item) => item.id));
  const negativeIds = new Set(handoff.negativeRequirements?.map((item) => item.id));
  const boundaryIds = new Set(handoff.boundaries?.map((item) => item.id));
  const semanticIds = new Set(handoff.semanticObligations?.map((item) => item.id));

  for (const obligation of handoff.verificationObligations ?? []) {
    if (obligation.requirementRef && !requirementIds.has(obligation.requirementRef)) {
      pushError(errors, "$.verificationObligations", "obligation_requirement_ref_unresolved", "requirementRef must resolve.");
    }
    if (obligation.acceptanceCriterionRef && !acceptanceIds.has(obligation.acceptanceCriterionRef)) {
      pushError(errors, "$.verificationObligations", "obligation_acceptance_ref_unresolved", "acceptanceCriterionRef must resolve.");
    }
    if (obligation.negativeRequirementRef && !negativeIds.has(obligation.negativeRequirementRef)) {
      pushError(errors, "$.verificationObligations", "obligation_negative_ref_unresolved", "negativeRequirementRef must resolve.");
    }
    if (obligation.boundaryRef && !boundaryIds.has(obligation.boundaryRef)) {
      pushError(errors, "$.verificationObligations", "obligation_boundary_ref_unresolved", "boundaryRef must resolve.");
    }
    if (obligation.semanticObligationRef && !semanticIds.has(obligation.semanticObligationRef)) {
      pushError(errors, "$.verificationObligations", "obligation_semantic_ref_unresolved", "semanticObligationRef must resolve.");
    }
    for (const ref of obligation.relatedObligationRefs ?? []) {
      if (!obligationIds.has(ref)) {
        pushError(errors, "$.verificationObligations", "related_obligation_ref_unresolved", "relatedObligationRefs must resolve.");
      }
    }
  }
}

function validateFreshnessGate(handoff, errors) {
  if (!isPlainObject(handoff.freshnessGate)) {
    pushError(errors, "$.freshnessGate", "freshness_gate_missing", "freshnessGate is required.");
    return;
  }
  const evidenceIds = new Set(handoff.evidence?.map((entry) => entry.id));
  for (const ref of handoff.freshnessGate.evidenceRefs ?? []) {
    if (!evidenceIds.has(ref)) {
      pushError(
        errors,
        "$.freshnessGate.evidenceRefs",
        "freshness_gate_evidence_ref_unresolved",
        "freshnessGate.evidenceRefs must resolve to evidence.",
      );
    }
  }
}

function validatePlannerInputs(handoff, errors) {
  if (!isPlainObject(handoff.plannerInputs)) {
    pushError(errors, "$.plannerInputs", "planner_inputs_missing", "plannerInputs is required.");
    return;
  }
  const boundaryIds = new Set(handoff.boundaries?.map((entry) => entry.id));
  for (const key of [
    "doNotChangeBoundaryRefs",
    "reuseBoundaryRefs",
    "compatibilityBoundaryRefs",
  ]) {
    if (!Array.isArray(handoff.plannerInputs[key])) {
      pushError(errors, `$.plannerInputs.${key}`, "planner_boundary_refs_missing", `${key} must be an array.`);
      continue;
    }
    for (const ref of handoff.plannerInputs[key]) {
      if (!boundaryIds.has(ref)) {
        pushError(
          errors,
          `$.plannerInputs.${key}`,
          "planner_boundary_ref_unresolved",
          "Planner boundary refs must resolve to boundaries.",
        );
      }
    }
  }
}

function validateNoUnknownKeys(object, allowedKeys, path, errors) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      pushError(
        errors,
        `${path}.${key}`,
        "unknown_field",
        `Unknown field "${key}" is not allowed.`,
      );
    }
  }
}

function validateUniqueLocalIds(items, path, errors) {
  if (!Array.isArray(items)) return;
  const ids = new Set();
  items.forEach((item, index) => {
    if (!isPlainObject(item) || !isNonEmptyString(item.id)) return;
    if (ids.has(item.id)) {
      pushError(
        errors,
        `${path}[${index}].id`,
        "duplicate_id",
        `Duplicate id "${item.id}" is not allowed.`,
      );
    }
    ids.add(item.id);
  });
}

function rejectNullishJson(value, path, errors) {
  if (value === null || value === undefined) {
    pushError(errors, path, "nullish_value_disallowed", "Null and undefined are disallowed in v1 handoffs.");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectNullishJson(entry, `${path}[${index}]`, errors));
    return;
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      rejectNullishJson(child, `${path}.${key}`, errors);
    }
  }
}

function rejectStaffOwnedKeys(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectStaffOwnedKeys(entry, `${path}[${index}]`, errors));
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (STAFF_OWNED_KEYS.has(key)) {
      pushError(
        errors,
        `${path}.${key}`,
        "staff_owned_field_present",
        `"${key}" is downstream planning authority and must not appear in the handoff.`,
      );
    }
    rejectStaffOwnedKeys(child, `${path}.${key}`, errors);
  }
}

function sha256Canonical(value) {
  const canonical = canonicalStringify(value);
  return `sha256:${createHash(HASH_ALGORITHM).update(canonical, "utf8").digest("hex")}`;
}

function canonicalClone(value) {
  return JSON.parse(canonicalStringify(value));
}

function canonicalStringify(value) {
  return stringifyCanonical(canonicalValue(value, ""));
}

function canonicalValue(value, parentKey) {
  if (value === null) return null;
  if (value === undefined) {
    throw new PlanningHandoffValidationError("undefined is not valid canonical JSON.");
  }
  if (typeof value === "string") {
    return PROSE_KEYS.has(parentKey)
      ? normalizeProseString(value)
      : normalizeIdentityString(value);
  }
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!isNonNegativeInteger(value)) {
      throw new PlanningHandoffValidationError(
        "v1 canonical JSON supports only finite non-negative integers.",
      );
    }
    return value;
  }
  if (Array.isArray(value)) {
    const normalized = value.map((entry) => canonicalValue(entry, singularKey(parentKey)));
    if (normalized.every((entry) => typeof entry === "string")) {
      return uniqueSortedStrings(normalized);
    }
    if (normalized.every((entry) => isPlainObject(entry))) {
      return [...normalized].sort((a, b) =>
        byteCompare(canonicalArraySortKey(a, parentKey), canonicalArraySortKey(b, parentKey)),
      );
    }
    return normalized;
  }
  if (isPlainObject(value)) {
    const object = {};
    for (const key of Object.keys(value).sort(byteCompare)) {
      if (value[key] !== undefined) {
        object[normalizeIdentityString(key)] = canonicalValue(value[key], key);
      }
    }
    return object;
  }
  throw new PlanningHandoffValidationError(
    `Unsupported canonical JSON value type: ${typeof value}.`,
  );
}

function stringifyCanonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stringifyCanonical(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort(byteCompare)
    .map((key) => `${JSON.stringify(key)}:${stringifyCanonical(value[key])}`)
    .join(",")}}`;
}

function canonicalArraySortKey(object, parentKey) {
  if ((parentKey === "decisionAudit" || parentKey === "decisions") && isNonNegativeInteger(object.sequence)) {
    return `sequence:${String(object.sequence).padStart(16, "0")}:${object.id ?? ""}`;
  }
  return [
    object.id ?? "",
    object.sourceRef ?? "",
    object.text ?? object.name ?? "",
    stringifyCanonical(object),
  ].join("\u0000");
}

function normalizeProseString(value) {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trim().replace(/[ \t]+/g, " "))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeIdentityString(value) {
  if (typeof value !== "string") return "";
  return value.normalize("NFC");
}

function singularKey(key) {
  if (typeof key !== "string") return key;
  if (key.endsWith("ies")) return `${key.slice(0, -3)}y`;
  if (key.endsWith("s")) return key.slice(0, -1);
  return key;
}

function namespaceRef(namespace, value) {
  const normalized = normalizeIdentityString(value);
  if (normalized.startsWith(`${namespace}:`)) return normalized;
  return `${namespace}:${normalized}`;
}

function namespaceSourceRef(value) {
  const normalized = normalizeIdentityString(value);
  if (normalized.includes(":")) return normalized;
  if (/^dec[_-]/i.test(normalized)) return namespaceRef("decision", normalized);
  if (/^req[_-]/i.test(normalized)) return namespaceRef("requirement", normalized);
  if (/^fact[_-]/i.test(normalized)) return namespaceRef("external", `fact:${normalized}`);
  return namespaceRef("external", normalized);
}

function normalizeRefArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => normalizeIdentityString(entry)).filter(Boolean);
}

function normalizeRelatedRequirementRefs(value) {
  if (!isPlainObject(value)) return [];
  const refs =
    value.relatedRequirementRefs ?? value.requirementRefs ?? value.requirementRef;
  const normalizedRefs = Array.isArray(refs) ? normalizeRefArray(refs) : normalizeRefArray([refs]);
  return normalizedRefs.map((ref) => namespaceRef("requirement", ref));
}

function verificationObligationRefsForRequirements(requirementRefs) {
  const refs = Array.isArray(requirementRefs)
    ? normalizeRefArray(requirementRefs)
    : normalizeRefArray([requirementRefs]);
  return refs.map((ref) =>
    namespaceRef("verification_obligation", `requirement:${localSuffix(ref)}`),
  );
}

function uniqueSortedStrings(values) {
  return [...new Set(values.map((value) => normalizeIdentityString(value)))].sort(byteCompare);
}

function localSuffix(ref) {
  const normalized = normalizeIdentityString(ref);
  const index = normalized.indexOf(":");
  return index === -1 ? normalized : normalized.slice(index + 1);
}

function pushError(errors, path, code, message) {
  errors.push({ path, code, message });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeInteger(value) {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isFinite(value) &&
    value >= 0 &&
    !Object.is(value, -0)
  );
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}

function isSha256Fingerprint(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isHandoffId(value) {
  return typeof value === "string" && /^handoff:[0-9a-f]{64}$/.test(value);
}

function isSensitivityTag(value) {
  return (
    isPlainObject(value) &&
    typeof value.classification === "string" &&
    Array.isArray(value.redactionRefs) &&
    Array.isArray(value.policyDecisionRefs)
  );
}

function hasAnyRole(actorRoleRefs, allowedRoleRefs) {
  if (!Array.isArray(actorRoleRefs) || !Array.isArray(allowedRoleRefs)) return false;
  return actorRoleRefs.some((roleRef) => allowedRoleRefs.includes(roleRef));
}

function byteCompare(a, b) {
  return Buffer.compare(Buffer.from(String(a), "utf8"), Buffer.from(String(b), "utf8"));
}

function deepFreeze(value) {
  if (!isPlainObject(value) && !Array.isArray(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if ((isPlainObject(child) || Array.isArray(child)) && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}
