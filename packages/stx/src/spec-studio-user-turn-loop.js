/**
 * Spec Studio user-turn loop semantics.
 *
 * Phalanx drives the user side of Spec Studio: it receives chat input,
 * routes it to Semantix as a SemantixEvaluateRequest, and persists the
 * audit trail. This module implements the deterministic packet
 * mutations that follow each user turn shape:
 *
 * - choice answer (`applyUserChoiceTurn`)
 * - free-text answer (`applyUserFreeTurn`)
 * - reconsider (`applyReconsiderTurn`)
 * - skip / flag-as-gap (`applySkipTurn`)
 * - decide-all (`applyDecideAllTurn`)
 *
 * The mutations are deterministic enough for tests and intentionally
 * minimal: they update decisions, openQuestions, findings, and
 * coverage hints, but they never mint canonical Phalanx audit
 * decision IDs and never silently dismiss findings. A caller can pass
 * the Phalanx-minted decision id; otherwise Semantix uses a
 * `sem_dec_*` prefix that signals the id is provisional and must be
 * replaced by Phalanx.
 *
 * Source: docs/phalanx-spec-studio-integration-contract.md:372
 * (turn shape) and :418 (decision kinds).
 */

import { ValidationError } from "@semantix/core/contracts";

import { READINESS } from "./spec-studio-contracts.js";

export const TURN_ACTION = Object.freeze({
  CHOICE: "choice",
  FREE: "free",
  RECONSIDER: "reconsider",
  SKIP: "skip",
  DECIDE_ALL: "decide_all",
});

const SEM_DECISION_ID_PREFIX = "sem_dec_";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function pickArray(value) {
  return Array.isArray(value) ? value : [];
}

function nowIso(now) {
  if (typeof now === "string" && now.length > 0) return now;
  if (typeof now === "function") return now();
  return new Date().toISOString();
}

function ensureArrays(packet) {
  packet.userDecisions = pickArray(packet.userDecisions);
  packet.openQuestions = pickArray(packet.openQuestions);
  packet.findings = pickArray(packet.findings);
  packet.requirements = pickArray(packet.requirements);
}

function nextSemDecisionId(packet, prefix = SEM_DECISION_ID_PREFIX) {
  const maxSuffix = pickArray(packet.userDecisions).reduce((max, decision) => {
    if (!isPlainObject(decision) || typeof decision.id !== "string") return max;
    if (!decision.id.startsWith(prefix)) return max;
    const suffix = Number.parseInt(decision.id.slice(prefix.length), 10);
    return Number.isFinite(suffix) ? Math.max(max, suffix) : max;
  }, 0);
  return `${prefix}${String(maxSuffix + 1).padStart(3, "0")}`;
}

function findOpenQuestion(packet, questionRef) {
  return pickArray(packet.openQuestions).find(
    (q) => isPlainObject(q) && q.id === questionRef,
  );
}

function findFindingByQuestionRef(packet, questionRef) {
  return pickArray(packet.findings).find(
    (f) => isPlainObject(f) && f.ref === questionRef && !f.resolved,
  );
}

function resolveFindingsForQuestion({ packet, questionRef, decisionId, at }) {
  for (const finding of packet.findings) {
    if (!isPlainObject(finding)) continue;
    if (finding.ref === questionRef && !finding.resolved) {
      finding.resolved = true;
      finding.resolvedAt = at;
      finding.resolutionDecisionId = decisionId;
    }
  }
}

function consumeOpenQuestion(packet, questionRef) {
  packet.openQuestions = pickArray(packet.openQuestions).filter(
    (q) => !(isPlainObject(q) && q.id === questionRef),
  );
}

function reopenFindingsForDecision({ packet, decisionId, reason, at }) {
  for (const finding of packet.findings) {
    if (!isPlainObject(finding)) continue;
    if (finding.resolved && finding.resolutionDecisionId === decisionId) {
      finding.resolved = false;
      finding.active = true;
      finding.resolvedAt = undefined;
      finding.reopenedAt = at;
      finding.reopenReason = reason;
    }
  }
}

function clearReadinessGate(packet) {
  // The readiness classifier owns final assignment; clear the local
  // readiness signal so the next evaluator pass recomputes it.
  packet.readiness = READINESS.NEEDS_USER;
  packet.blockingReasons = pickArray(packet.blockingReasons);
}

// ---- Choice ---------------------------------------------------------------

/**
 * Apply a user choice answer. The picked option is recorded as a
 * decision; the corresponding open question and any unresolved
 * findings tied to it are resolved against the new decision id.
 *
 * @param {{
 *   packet: object,
 *   userTurn: object,
 *   questionRef: string,
 *   pickedOptionId: string,
 *   pickedLabel?: string,
 *   tag?: string,
 *   section?: string,
 *   decisionId?: string,
 *   now?: string | (() => string)
 * }} input
 * @returns {{ packet: object, decisionId: string }}
 */
export function applyUserChoiceTurn({
  packet,
  userTurn,
  questionRef,
  pickedOptionId,
  pickedLabel,
  tag,
  section,
  decisionId,
  now,
}) {
  if (!isPlainObject(packet)) {
    throw new ValidationError("applyUserChoiceTurn requires a packet object.");
  }
  if (!isPlainObject(userTurn) || !isNonEmptyString(userTurn.id)) {
    throw new ValidationError("applyUserChoiceTurn requires a userTurn object with an id.");
  }
  if (!isNonEmptyString(questionRef)) {
    throw new ValidationError("applyUserChoiceTurn requires a questionRef.");
  }
  if (!isNonEmptyString(pickedOptionId)) {
    throw new ValidationError("applyUserChoiceTurn requires a pickedOptionId.");
  }

  const next = deepClone(packet);
  ensureArrays(next);
  const at = nowIso(now);
  const newId = decisionId ?? nextSemDecisionId(next);
  const question = findOpenQuestion(next, questionRef);
  const resolvedSection = section ?? question?.section ?? "scope";

  next.userDecisions.push({
    id: newId,
    turnId: userTurn.id,
    section: resolvedSection,
    questionRef,
    question: question?.question ?? "",
    kind: "choice",
    answer: {
      kind: "choice",
      optId: pickedOptionId,
      label: pickedLabel ?? "",
      tag,
    },
    at,
  });

  resolveFindingsForQuestion({
    packet: next,
    questionRef,
    decisionId: newId,
    at,
  });
  consumeOpenQuestion(next, questionRef);

  clearReadinessGate(next);
  return { packet: next, decisionId: newId };
}

// ---- Free text -----------------------------------------------------------

/**
 * Apply a user free-text answer. Records a decision with the raw text
 * and leaves the linked finding for re-evaluation (free text rarely
 * resolves a gap by itself).
 *
 * @param {{
 *   packet: object,
 *   userTurn: object,
 *   questionRef?: string,
 *   text: string,
 *   section?: string,
 *   decisionId?: string,
 *   now?: string | (() => string)
 * }} input
 * @returns {{ packet: object, decisionId: string }}
 */
export function applyUserFreeTurn({
  packet,
  userTurn,
  questionRef,
  text,
  section,
  decisionId,
  now,
}) {
  if (!isPlainObject(packet)) {
    throw new ValidationError("applyUserFreeTurn requires a packet object.");
  }
  if (!isPlainObject(userTurn) || !isNonEmptyString(userTurn.id)) {
    throw new ValidationError("applyUserFreeTurn requires a userTurn object with an id.");
  }
  if (!isNonEmptyString(text)) {
    throw new ValidationError("applyUserFreeTurn requires non-empty text.");
  }

  const next = deepClone(packet);
  ensureArrays(next);
  const at = nowIso(now);
  const newId = decisionId ?? nextSemDecisionId(next);
  const question = questionRef ? findOpenQuestion(next, questionRef) : null;
  const resolvedSection = section ?? question?.section ?? "intent";

  next.userDecisions.push({
    id: newId,
    turnId: userTurn.id,
    section: resolvedSection,
    questionRef: questionRef ?? "",
    question: question?.question ?? "",
    kind: "free",
    answer: {
      kind: "free",
      text,
    },
    at,
  });

  // Free text does not auto-resolve linked findings - the next
  // evaluator pass (or applyReadinessVerdict) needs to interpret the
  // text. Findings are left alone, but readiness drops to needs_user
  // because the spec changed.
  clearReadinessGate(next);
  return { packet: next, decisionId: newId };
}

// ---- Reconsider ----------------------------------------------------------

/**
 * Reconsider a prior decision. The previous decision is marked
 * superseded (never deleted) and the new decision becomes active.
 * Findings that were resolved against the prior decision are reopened
 * with an audit reason and reopen timestamp.
 *
 * @param {{
 *   packet: object,
 *   userTurn: object,
 *   priorDecisionId: string,
 *   newAnswer: object,
 *   reason: string,
 *   newDecisionId?: string,
 *   now?: string | (() => string)
 * }} input
 * @returns {{ packet: object, decisionId: string }}
 */
export function applyReconsiderTurn({
  packet,
  userTurn,
  priorDecisionId,
  newAnswer,
  reason,
  newDecisionId,
  now,
}) {
  if (!isPlainObject(packet)) {
    throw new ValidationError("applyReconsiderTurn requires a packet object.");
  }
  if (!isPlainObject(userTurn) || !isNonEmptyString(userTurn.id)) {
    throw new ValidationError("applyReconsiderTurn requires a userTurn object with an id.");
  }
  if (!isNonEmptyString(priorDecisionId)) {
    throw new ValidationError("applyReconsiderTurn requires a priorDecisionId.");
  }
  if (!isPlainObject(newAnswer) || !isNonEmptyString(newAnswer.kind)) {
    throw new ValidationError("applyReconsiderTurn requires a newAnswer object with a kind.");
  }
  if (!isNonEmptyString(reason)) {
    throw new ValidationError("applyReconsiderTurn requires a reason for the reconsider.");
  }

  const next = deepClone(packet);
  ensureArrays(next);
  const at = nowIso(now);
  const replacementId = newDecisionId ?? nextSemDecisionId(next);
  const prior = next.userDecisions.find(
    (d) => isPlainObject(d) && d.id === priorDecisionId,
  );
  if (!prior) {
    throw new ValidationError(
      `applyReconsiderTurn cannot find prior decision "${priorDecisionId}".`,
    );
  }
  prior.supersededBy = replacementId;
  prior.supersededAt = at;
  prior.supersededReason = reason;

  next.userDecisions.push({
    id: replacementId,
    turnId: userTurn.id,
    section: prior.section,
    questionRef: prior.questionRef,
    question: prior.question,
    kind: newAnswer.kind === "free" ? "free" : "choice",
    answer: newAnswer,
    at,
    reconsidersDecisionId: prior.id,
  });

  reopenFindingsForDecision({
    packet: next,
    decisionId: priorDecisionId,
    reason,
    at,
  });

  clearReadinessGate(next);
  return { packet: next, decisionId: replacementId };
}

// ---- Skip / flag as gap -------------------------------------------------

/**
 * Skip an open question. The question is removed from openQuestions,
 * a concern finding records the gap, and a "dismiss" decision carries
 * the audit reason. Skipping never silently dismisses an existing
 * blocker finding.
 *
 * @param {{
 *   packet: object,
 *   userTurn: object,
 *   questionRef: string,
 *   reason: string,
 *   decisionId?: string,
 *   findingId?: string,
 *   now?: string | (() => string)
 * }} input
 * @returns {{ packet: object, decisionId: string, findingId: string }}
 */
export function applySkipTurn({
  packet,
  userTurn,
  questionRef,
  reason,
  decisionId,
  findingId,
  now,
}) {
  if (!isPlainObject(packet)) {
    throw new ValidationError("applySkipTurn requires a packet object.");
  }
  if (!isPlainObject(userTurn) || !isNonEmptyString(userTurn.id)) {
    throw new ValidationError("applySkipTurn requires a userTurn object with an id.");
  }
  if (!isNonEmptyString(questionRef)) {
    throw new ValidationError("applySkipTurn requires a questionRef.");
  }
  if (!isNonEmptyString(reason)) {
    throw new ValidationError("applySkipTurn requires a reason for the skip.");
  }

  const next = deepClone(packet);
  ensureArrays(next);
  const at = nowIso(now);
  const newId = decisionId ?? nextSemDecisionId(next);
  const question = findOpenQuestion(next, questionRef);
  const section = question?.section ?? "scope";
  const skipFindingId = findingId ?? `F-SKIP-${questionRef}`;

  next.userDecisions.push({
    id: newId,
    turnId: userTurn.id,
    section,
    questionRef,
    question: question?.question ?? "",
    kind: "dismiss",
    answer: {
      kind: "dismiss",
      reason,
    },
    at,
  });

  // Skipping never removes an existing blocker finding; raise a new
  // concern finding so the gap stays auditable.
  const existing = findFindingByQuestionRef(next, questionRef);
  if (!existing || existing.sev !== "blocker") {
    next.findings.push({
      id: skipFindingId,
      kind: "gap",
      sev: "concern",
      section,
      ref: questionRef,
      text: `Question "${questionRef}" was skipped: ${reason}`,
      resolved: false,
      raisedBy: "user",
    });
  }

  consumeOpenQuestion(next, questionRef);
  clearReadinessGate(next);
  return { packet: next, decisionId: newId, findingId: skipFindingId };
}

// ---- Decide-all ----------------------------------------------------------

/**
 * Have Semantix decide every remaining open question. Each decision
 * is recorded as `decided-by-semantix` with a flagged entry so a human
 * reviewer can revisit the call. Decision ids stay in the
 * `sem_dec_*` namespace; Phalanx may map them to canonical audit ids.
 *
 * @param {{
 *   packet: object,
 *   userTurn: object,
 *   resolutions: Array<{ questionRef: string, optId: string, label?: string, rationale: string }>,
 *   reviewer?: string,
 *   now?: string | (() => string)
 * }} input
 * @returns {{ packet: object, decisionIds: string[] }}
 */
export function applyDecideAllTurn({
  packet,
  userTurn,
  resolutions,
  reviewer = "human",
  now,
}) {
  if (!isPlainObject(packet)) {
    throw new ValidationError("applyDecideAllTurn requires a packet object.");
  }
  if (!isPlainObject(userTurn) || !isNonEmptyString(userTurn.id)) {
    throw new ValidationError("applyDecideAllTurn requires a userTurn object with an id.");
  }
  if (!Array.isArray(resolutions) || resolutions.length === 0) {
    throw new ValidationError(
      "applyDecideAllTurn requires a non-empty resolutions array.",
    );
  }

  const next = deepClone(packet);
  ensureArrays(next);
  const at = nowIso(now);
  const decisionIds = [];

  for (const resolution of resolutions) {
    if (!isPlainObject(resolution)) continue;
    const { questionRef, optId, label = "", rationale } = resolution;
    if (!isNonEmptyString(questionRef) || !isNonEmptyString(optId)) {
      throw new ValidationError(
        "Each decide-all resolution requires questionRef and optId.",
      );
    }
    if (!isNonEmptyString(rationale)) {
      throw new ValidationError(
        "decided-by-semantix entries require a rationale for human visibility.",
      );
    }

    const question = findOpenQuestion(next, questionRef);
    const section = resolution.section ?? question?.section ?? "scope";
    const newId = resolution.decisionId ?? nextSemDecisionId(next);

    next.userDecisions.push({
      id: newId,
      turnId: userTurn.id,
      section,
      questionRef,
      question: question?.question ?? "",
      kind: "decided-by-semantix",
      answer: {
        kind: "decided-by-semantix",
        optId,
        rationale,
        label,
      },
      at,
      flagged: [
        {
          reviewer,
          reason:
            "Decided-by-Semantix; needs human review before lock to avoid silent assumption.",
        },
      ],
    });

    resolveFindingsForQuestion({
      packet: next,
      questionRef,
      decisionId: newId,
      at,
    });
    consumeOpenQuestion(next, questionRef);
    decisionIds.push(newId);
  }

  clearReadinessGate(next);
  return { packet: next, decisionIds };
}
