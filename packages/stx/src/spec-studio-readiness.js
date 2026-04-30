/**
 * Readiness classifier and update-safety rules for Spec Studio.
 *
 * Implements the readiness contract from
 * docs/phalanx-spec-studio-integration-contract.md (Readiness Semantics
 * lines 75-95 and Update-mode readiness rules around line 220):
 *
 * - Greenfield can reach `ready` only when alignedRequirement, scope,
 *   must-level acceptance, and obvious exclusions are clear.
 * - Update can reach `ready` only with at least one targetSurface plus
 *   at least one of doNotChange / reuseRequirements /
 *   compatibilityRequirements.
 * - Unknown new-vs-update returns `needs_user` with an open question
 *   and blocker finding.
 * - Duplicate or replacement of an existing surface without explicit
 *   approval returns `blocked` (or `needs_user` when the user has not
 *   yet been asked).
 * - Negative requirements and do-not-change boundaries are lifted into
 *   first-class requirement facts so Staff cannot mistake them for
 *   prose-only caveats after lock.
 *
 * Semantix readiness is advisory. Phalanx remains the lock authority
 * (see Lock Contract in the upstream spec).
 */

import {
  EXISTING_SYSTEM_MODE,
  READINESS,
} from "./spec-studio-contracts.js";

export const REPLACEMENT_APPROVAL = Object.freeze({
  EXPLICIT: "explicit",
  PENDING: "pending",
  ABSENT: "absent",
});

export const REPLACEMENT_APPROVAL_VALUES = Object.freeze([
  REPLACEMENT_APPROVAL.EXPLICIT,
  REPLACEMENT_APPROVAL.PENDING,
  REPLACEMENT_APPROVAL.ABSENT,
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function nonEmptyArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function pickArray(value) {
  return Array.isArray(value) ? value : [];
}

function findingFor({ id, kind, sev, section, ref, text }) {
  return {
    id,
    kind,
    sev,
    section,
    ref,
    text,
    resolved: false,
    raisedBy: "semantix",
  };
}

function classify(packet) {
  if (!isPlainObject(packet)) {
    return {
      readiness: READINESS.NEEDS_USER,
      blockingReasons: [
        { id: "BR-INPUT-001", text: "Cannot classify a non-object packet." },
      ],
      findings: [
        findingFor({
          id: "F-INPUT-001",
          kind: "gap",
          sev: "blocker",
          section: "intent",
          ref: "INPUT",
          text: "Packet input was missing or malformed; readiness defaults to needs_user.",
        }),
      ],
      openQuestions: [],
      reasons: ["packet_missing"],
    };
  }

  const blockingReasons = [];
  const findings = [];
  const openQuestions = [];
  const reasons = [];

  const esc = isPlainObject(packet.existingSystemContext)
    ? packet.existingSystemContext
    : null;

  if (!esc || !esc.mode) {
    blockingReasons.push({
      id: "BR-CTX-001",
      text: "existingSystemContext is missing; cannot classify readiness.",
    });
    findings.push(
      findingFor({
        id: "F-CTX-001",
        kind: "gap",
        sev: "blocker",
        section: "intent",
        ref: "EXISTING_SYSTEM_CONTEXT",
        text: "existingSystemContext is required for every Spec Studio packet.",
      }),
    );
    reasons.push("existing_system_context_missing");
    return {
      readiness: READINESS.NEEDS_USER,
      blockingReasons,
      findings,
      openQuestions,
      reasons,
    };
  }

  const replacementApprovalRaw =
    typeof packet.replacementApproval === "string"
      ? packet.replacementApproval
      : packet.replacementApproval ?? REPLACEMENT_APPROVAL.PENDING;
  const replacementApproval = REPLACEMENT_APPROVAL_VALUES.includes(replacementApprovalRaw)
    ? replacementApprovalRaw
    : REPLACEMENT_APPROVAL.PENDING;

  const duplicateDetected = Boolean(packet.duplicateDetected);
  const replacementDetected = Boolean(packet.replacementDetected);

  // Replacement / duplicate without approval is the strongest gate.
  if (duplicateDetected || replacementDetected) {
    if (replacementApproval === REPLACEMENT_APPROVAL.ABSENT) {
      blockingReasons.push({
        id: "BR-REP-001",
        text: "Existing surface replacement or duplication requires explicit user approval and a migration boundary.",
      });
      findings.push(
        findingFor({
          id: "F-REP-001",
          kind: "contradiction",
          sev: "blocker",
          section: "boundaries",
          ref: "BND-REPLACEMENT",
          text: "Existing surface is present, but the request asks for a duplicate or replacement and approval was withdrawn.",
        }),
      );
      reasons.push("replacement_explicitly_denied");
      return {
        readiness: READINESS.BLOCKED,
        blockingReasons,
        findings,
        openQuestions,
        reasons,
      };
    }
    if (replacementApproval === REPLACEMENT_APPROVAL.PENDING) {
      blockingReasons.push({
        id: "BR-REP-002",
        text: "Existing surface replacement or duplication needs explicit user approval before lock.",
      });
      findings.push(
        findingFor({
          id: "F-REP-002",
          kind: "gap",
          sev: "blocker",
          section: "boundaries",
          ref: "BND-REPLACEMENT",
          text: "User has not approved replacing or duplicating the existing surface.",
        }),
      );
      openQuestions.push({
        id: "Q-REP-001",
        section: "boundaries",
        question:
          "Replace or duplicate the existing surface? If replacement, what migration boundary applies?",
        options: [
          "Approve replacement with migration plan",
          "Reuse the existing surface instead",
          "Not sure",
        ],
      });
      reasons.push("replacement_pending_approval");
      return {
        readiness: READINESS.NEEDS_USER,
        blockingReasons,
        findings,
        openQuestions,
        reasons,
      };
    }
    // EXPLICIT approval falls through; remaining checks still apply.
    reasons.push("replacement_explicit_approval");
  }

  if (esc.mode === EXISTING_SYSTEM_MODE.UNKNOWN) {
    blockingReasons.push({
      id: "BR-MODE-001",
      text: "Target surface is ambiguous; cannot classify as new vs update.",
    });
    findings.push(
      findingFor({
        id: "F-MODE-001",
        kind: "gap",
        sev: "blocker",
        section: "scope",
        ref: "Q-MODE-001",
        text: "Target surface is ambiguous.",
      }),
    );
    openQuestions.push({
      id: "Q-MODE-001",
      section: "scope",
      question:
        "Should this update an existing Phalanx surface, or create a new one?",
      options: [
        "Update an existing surface",
        "Create a new surface",
        "Not sure",
      ],
    });
    reasons.push("mode_unknown");
    return {
      readiness: READINESS.NEEDS_USER,
      blockingReasons,
      findings,
      openQuestions,
      reasons,
    };
  }

  if (esc.mode === EXISTING_SYSTEM_MODE.UPDATE) {
    if (!nonEmptyArray(esc.targetSurfaces)) {
      blockingReasons.push({
        id: "BR-UPD-001",
        text: "Update mode requires at least one targetSurface before lock.",
      });
      findings.push(
        findingFor({
          id: "F-UPD-001",
          kind: "gap",
          sev: "blocker",
          section: "scope",
          ref: "TARGET_SURFACES",
          text: "Update flow is missing targetSurfaces.",
        }),
      );
      openQuestions.push({
        id: "Q-UPD-001",
        section: "scope",
        question:
          "Which existing surface (page, panel, route, module, API) does this work modify?",
      });
      reasons.push("update_missing_target_surface");
      return {
        readiness: READINESS.NEEDS_USER,
        blockingReasons,
        findings,
        openQuestions,
        reasons,
      };
    }
    const hasNonChange = nonEmptyArray(esc.doNotChange);
    const hasReuse = nonEmptyArray(esc.reuseRequirements);
    const hasCompatibility = nonEmptyArray(esc.compatibilityRequirements);
    if (!hasNonChange && !hasReuse && !hasCompatibility) {
      blockingReasons.push({
        id: "BR-UPD-002",
        text: "Update mode requires explicit non-change, reuse, or compatibility boundaries before lock.",
      });
      findings.push(
        findingFor({
          id: "F-UPD-002",
          kind: "gap",
          sev: "blocker",
          section: "boundaries",
          ref: "BOUNDARIES",
          text: "Update flow has no doNotChange / reuseRequirements / compatibilityRequirements boundaries.",
        }),
      );
      openQuestions.push({
        id: "Q-UPD-002",
        section: "boundaries",
        question:
          "Which boundaries must hold for this update (reuse what, do not change what, compatibility constraints)?",
      });
      reasons.push("update_missing_boundaries");
      return {
        readiness: READINESS.NEEDS_USER,
        blockingReasons,
        findings,
        openQuestions,
        reasons,
      };
    }
  }

  // Greenfield + update share these final clarity checks once the
  // mode-specific gates pass.
  const requirements = pickArray(packet.requirements);
  const scope = isPlainObject(packet.scope) ? packet.scope : {};

  if (!isNonEmptyString(packet.alignedRequirement)) {
    findings.push(
      findingFor({
        id: "F-ALIGN-001",
        kind: "gap",
        sev: "blocker",
        section: "intent",
        ref: "alignedRequirement",
        text: "alignedRequirement is empty; the canonical normalized requirement must be set before lock.",
      }),
    );
    openQuestions.push({
      id: "Q-ALIGN-001",
      section: "intent",
      question:
        "What is the canonical normalized requirement Phalanx Staff should treat as authoritative?",
    });
    reasons.push("aligned_requirement_missing");
  }

  if (
    !nonEmptyArray(scope.inScope) &&
    !nonEmptyArray(packet.inScope)
  ) {
    findings.push(
      findingFor({
        id: "F-SCOPE-001",
        kind: "gap",
        sev: "concern",
        section: "scope",
        ref: "SCOPE_IN",
        text: "scope.inScope is empty; lock requires explicit in-scope items.",
      }),
    );
    openQuestions.push({
      id: "Q-SCOPE-001",
      section: "scope",
      question: "What is in scope for this work?",
    });
    reasons.push("scope_in_missing");
  }
  if (
    !nonEmptyArray(scope.outOfScope) &&
    !nonEmptyArray(packet.outOfScope)
  ) {
    findings.push(
      findingFor({
        id: "F-SCOPE-002",
        kind: "gap",
        sev: "concern",
        section: "scope",
        ref: "SCOPE_OUT",
        text: "scope.outOfScope is empty; lock requires explicit obvious exclusions.",
      }),
    );
    reasons.push("scope_out_missing");
  }

  const mustLevel = requirements.filter((req) => req && req.priority === "must");
  if (mustLevel.length === 0) {
    findings.push(
      findingFor({
        id: "F-REQ-001",
        kind: "gap",
        sev: "blocker",
        section: "success",
        ref: "REQUIREMENTS",
        text: "No must-level requirements found; lock requires at least one must-level requirement with acceptance.",
      }),
    );
    reasons.push("must_level_requirements_missing");
  } else {
    const missingAcceptance = mustLevel.filter(
      (req) => !isNonEmptyString(req.acceptance),
    );
    if (missingAcceptance.length > 0) {
      for (const req of missingAcceptance) {
        findings.push(
          findingFor({
            id: `F-ACC-${req.id ?? "REQ"}`,
            kind: "gap",
            sev: "blocker",
            section: "success",
            ref: req.id ?? "REQUIREMENTS",
            text: `Must-level requirement "${req.id ?? "unnamed"}" lacks an acceptance criterion.`,
          }),
        );
      }
      reasons.push("must_level_acceptance_missing");
    }
  }

  // Aggregate blockingReasons from blocker findings so the packet
  // stays self-consistent.
  for (const finding of findings) {
    if (finding.sev === "blocker") {
      blockingReasons.push({
        id: `BR-${finding.id}`,
        text: finding.text,
      });
    }
  }

  if (findings.some((f) => f.sev === "blocker")) {
    return {
      readiness: READINESS.NEEDS_USER,
      blockingReasons,
      findings,
      openQuestions,
      reasons,
    };
  }

  if (findings.some((f) => f.sev === "concern")) {
    return {
      readiness: READINESS.NEEDS_USER,
      blockingReasons,
      findings,
      openQuestions,
      reasons,
    };
  }

  return {
    readiness: READINESS.READY,
    blockingReasons,
    findings,
    openQuestions,
    reasons: reasons.length > 0 ? reasons : ["all_lock_criteria_met"],
  };
}

/**
 * Classify readiness for a Spec Studio packet.
 *
 * Accepts either a candidate alignment packet directly or an extended
 * input that adds Semantix-side classification signals:
 *   - duplicateDetected: boolean
 *   - replacementDetected: boolean
 *   - replacementApproval: "explicit" | "pending" | "absent"
 *
 * Returns the verdict, blocker reasons, findings, open questions, and a
 * short array of human-readable reason codes. Phalanx still recomputes
 * lock eligibility server-side.
 *
 * @param {object} packet
 * @returns {{
 *   readiness: "ready" | "needs_user" | "blocked",
 *   blockingReasons: Array<{ id: string, text: string }>,
 *   findings: Array<object>,
 *   openQuestions: Array<object>,
 *   reasons: string[]
 * }}
 */
export function classifyReadiness(packet) {
  return classify(packet);
}

/**
 * Apply the classifier verdict back into a candidate packet so callers
 * can rely on `packet.readiness`, `packet.blockingReasons`,
 * `packet.findings`, and `packet.openQuestions` without manually
 * merging.
 *
 * @param {object} packet
 * @returns {object} a new packet with classifier output merged in
 */
export function applyReadinessVerdict(packet) {
  const verdict = classifyReadiness(packet);
  const existingFindings = pickArray(packet.findings).filter((finding) => {
    if (!isPlainObject(finding)) return false;
    // Preserve user-resolved findings; replace any prior Semantix-issued
    // gate findings (ids starting with F-INPUT/F-CTX/F-MODE/F-UPD/F-REP/F-ALIGN/F-SCOPE/F-REQ/F-ACC).
    return !/^F-(INPUT|CTX|MODE|UPD|REP|ALIGN|SCOPE|REQ|ACC)/.test(String(finding.id ?? ""));
  });
  const existingOpenQuestions = pickArray(packet.openQuestions).filter((q) => {
    if (!isPlainObject(q)) return false;
    return !/^Q-(MODE|UPD|REP|ALIGN|SCOPE)/.test(String(q.id ?? ""));
  });
  return {
    ...packet,
    readiness: verdict.readiness,
    blockingReasons: verdict.blockingReasons,
    findings: [...existingFindings, ...verdict.findings],
    openQuestions: [...existingOpenQuestions, ...verdict.openQuestions],
  };
}

function normalizeText(text) {
  return String(text).trim().toLowerCase();
}

/**
 * Promote scope.negativeRequirements and existingSystemContext.doNotChange
 * into first-class requirement facts (type: "negative") so Staff cannot
 * mistake them for prose-only caveats.
 *
 * Existing requirement facts of type "negative" are preserved and not
 * duplicated. New negatives carry priority="must" and an automatic
 * acceptance criterion.
 *
 * @param {{
 *   requirements?: Array<object>,
 *   scope?: { negativeRequirements?: string[] },
 *   existingSystemContext?: { doNotChange?: string[] },
 *   idPrefix?: string,
 *   sourceRef?: string
 * }} input
 * @returns {Array<object>} new requirements list with negatives promoted
 */
export function promoteNegativeRequirements({
  requirements = [],
  scope = {},
  existingSystemContext = {},
  idPrefix = "REQ-NEG-",
  sourceRef = "boundaries",
} = {}) {
  const out = [...requirements];
  const existingNegativeTexts = new Set(
    out
      .filter((req) => req && req.type === "negative" && typeof req.text === "string")
      .map((req) => normalizeText(req.text)),
  );
  let counter =
    out.filter((req) => req && typeof req.id === "string" && req.id.startsWith(idPrefix))
      .length + 1;

  const candidates = [
    ...pickArray(scope.negativeRequirements).map((text) => ({
      text,
      origin: "scope",
    })),
    ...pickArray(existingSystemContext.doNotChange).map((text) => ({
      text: text.toLowerCase().startsWith("do not") ? text : `Do not change ${text}.`,
      origin: "existingSystemContext.doNotChange",
    })),
  ];

  for (const candidate of candidates) {
    if (typeof candidate.text !== "string") continue;
    const normalized = normalizeText(candidate.text);
    if (normalized.length === 0) continue;
    if (existingNegativeTexts.has(normalized)) continue;
    existingNegativeTexts.add(normalized);
    const id = `${idPrefix}${String(counter).padStart(3, "0")}`;
    counter += 1;
    out.push({
      id,
      type: "negative",
      text: candidate.text,
      priority: "must",
      sourceRef: `${sourceRef}:${candidate.origin}`,
      acceptance: `No changes that violate "${candidate.text}".`,
      status: "confirmed",
    });
  }

  return out;
}
