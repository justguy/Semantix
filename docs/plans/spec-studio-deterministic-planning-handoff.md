# Spec Studio Deterministic Planning Handoff

Status: partially implemented prototype; full contract below remains the target.
Owner: Semantix alignment and deterministic handoff boundary
Source contract: generalized Semantix planning handoff contract
Related plans:
- docs/plans/spec-studio-readiness-and-update-safety.md
- docs/plans/spec-studio-user-turn-loop.md
- docs/plans/spec-studio-context-request-generator.md
- docs/plans/spec-studio-grounded-context-ingestion.md
- docs/plans/spec-studio-end-to-end-proof.md

## Implementation status

`packages/stx/src/spec-studio-planning-handoff.js` implements the pure builder,
canonicalization, fingerprinting, validation, and observation-based freshness
classification. `POST /spec-studio/planning-handoff` exposes compilation with
canonical output and repeat-build diagnostics. Greenfield and update fixtures
exercise the implemented behavior.

The browser currently passes ready-packet text into a Codex run; it does not
perform this lock-to-handoff flow. Immutable Spec Studio lock persistence and
downstream planner integration remain host work. Complete nested-schema,
grounding/reference-integrity, and governance role-binding enforcement are
also unfinished. Requirements and acceptance criteria below specify the target
contract, not a claim that every guarantee is implemented. See the
[current implementation spec](../semantix-control-plane-spec.md) for current scope.

## Navigation

- Goal and end-to-end process: alignment loop through downstream
  planning.
- New artifact: `LockedSpecPlanningHandoff` shape and structural rules.
- Versioning and replay: compiler profile, packet compatibility,
  amendment lineage, and input hashes.
- Authority model: host lock authority, governance, and v1
  single-approver scope cut.
- Data bounds and sensitive content: size limits, classification
  ownership, redaction, and policy gates.
- Determinism and canonicalization: pure builder rules, canonical JSON,
  sorting, and fingerprinting.
- Freshness gate semantics: per-evidence comparison rules and v1
  policy scope cut.
- Fail-closed rules: validation failures and cross-link integrity.
- Semantix-owned implementation: builder module, mappers, validation,
  fingerprinting, and tests.
- Host-owned integration: lock route, planner loader, planning checks,
  verification plan, and drift handling.
- Cross-system API boundary: typed build input and host-supplied audit
  state.
- Rollout phases and acceptance criteria.
- Core interface appendix: minimum shared types.

## Goal

Introduce a deterministic boundary between the Semantix alignment loop
and any downstream planning or execution system.

Semantix may use an LLM to help clarify a fuzzy requirement, ask
questions, normalize user intent, and produce a structured alignment
packet. Once the user locks the spec, the handoff into planning must be
a pure, deterministic compiler step:

```
LockedIntentArtifact + SemantixAlignmentPacket + audit state
  -> LockedSpecPlanningHandoff
```

The handoff builder must not ask questions, call an LLM, invent
architecture, infer product intent, or produce implementation tasks
directly. It must fail closed if the locked packet is not safe to hand
to a downstream planner.

## End-to-End Process

1. User submits a fuzzy directive.

   Example:

   ```
   create a website with buttons
   ```

2. The host system creates or resumes a mutable Spec Studio session.

   The host owns session persistence, append-only turn history,
   canonical decision IDs, lock ceremony, and the user-facing UI.

3. The host sends a `SemantixEvaluateRequest` to Semantix.

   Required inputs:

   - `sessionId`
   - `trigger`
   - initial `userTurn` or follow-up `userTurn`
   - `currentPacket` on non-initial turns
   - prior `decisions`
   - prior `findings`
   - any `contextResponses`

4. Semantix normalizes and validates the request.

   Semantix rejects malformed envelopes before evaluation. Initial
   requests may omit optional arrays; Semantix normalizes those to empty
   arrays.

5. Semantix evaluates ambiguity.

   For a narrow ambiguity, Semantix asks one `nextTurn.body.kind =
   "question"`.

   For independent ambiguities, Semantix asks one `nextTurn.body.kind =
   "batch"` with 2-5 focused questions. Highly generic creation prompts
   must not collapse to only new-vs-update. If no existing surface is
   referenced, Semantix records a low-confidence greenfield assumption
   and asks for purpose, audience, content, actions, style, and done
   criteria.

   The choice between one question and a batch is part of the probabilistic
   alignment loop, not the deterministic planning handoff. Two valid
   Semantix evaluator implementations may ask different clarifying
   questions before lock. Determinism begins only after a specific packet
   is accepted and locked. v1 treats pre-lock user experience variance as
   an explicit scope cut.

6. User answers through the host.

   The host records the answer as an append-only user turn and sends the
   full current state back to Semantix.

7. Semantix applies deterministic user-turn state.

   Choice, free text, skip, reconsider, decide-all, and batch answers
   are converted into stable packet mutations before any model-generated
   packet is accepted:

   - answered questions become `userDecisions`
   - linked findings are resolved or preserved according to turn kind
   - skipped blockers remain blockers
   - reconsidered decisions reopen linked findings
   - batch answers produce one decision per answered question

   A skipped blocker cannot silently disappear. To proceed, the host
   must record an explicit user override/demotion decision that converts
   the blocker into an assumption or accepted risk with audit rationale.
   The original finding remains in history, the demoted finding is no
   longer a blocker, and the handoff carries the resulting
   assumption/risk forward.

8. Semantix may request grounded context.

   Semantix emits typed `contextRequests`; the host brokers repo,
   upload, trace, evidence-system, or other tool access and returns
   `contextResponses` with evidence refs. Semantix never calls those
   tools directly in this integration boundary.

9. Semantix produces a candidate `SemantixAlignmentPacket`.

   The packet includes:

   - `originalUserRequest`
   - `alignedRequirement`
   - typed requirements with priorities and acceptance
   - flow, scope, negative requirements, assumptions, risks
   - open questions
   - findings
   - existing-system context and boundaries
   - grounded facts and context sources
   - coverage hints
   - next turn or `null`

10. Semantix classifies readiness.

    Semantix readiness is advisory. It can return:

    - `needs_user`
    - `blocked`
    - `ready`

    Semantix must not mark ready if blocker findings remain unresolved,
    must-level requirements lack acceptance, update targets are missing,
    or update boundaries are missing.

11. The host recomputes lock eligibility.

    The host remains the lock authority. It must recompute:

    - packet validity
    - blocker count
    - coverage eligibility
    - stale state
    - policy gates
    - user approval state

12. User explicitly locks the spec.

    Lock is an explicit user action. A ready packet alone is not a lock.

13. The host mints an immutable `LockedIntentArtifact`.

    The artifact freezes the latest accepted packet plus audit metadata.
    Later changes require a child spec session or equivalent amendment
    flow.

14. Deterministic handoff builder compiles the locked spec.

    The builder takes only locked, validated inputs and returns a
    canonical `LockedSpecPlanningHandoff`. The handoff includes the
    typed decision audit, provenance records, capability scopes,
    grounding labels, soft semantic obligations, evidence freshness
    checks, and deterministic fingerprint.

15. The downstream planner runs the handoff freshness gate.

    Before architecture or task planning starts, the host or planner
    rechecks every freshness-bound evidence ref in the handoff. The
    result must be one of `clean_resume`, `soft_stale`, or `hard_stale`.
    The state is computed from host observations using the v1 per-kind
    freshness comparison semantics, not host-specific judgment.
    `clean_resume` may continue, `soft_stale` must regenerate from the
    last safe checkpoint or require reapproval according to the handoff
    policy, and `hard_stale` must halt for relock or amendment.

16. The downstream planner plans from the handoff.

    The planner consumes the handoff as authoritative requirement
    context. The host or downstream planning system owns architecture,
    task decomposition, implementation planning, execution,
    verification, and drift reporting.

17. Execution checks against the locked handoff.

    Drift is not detected by asking the system to "read the code" and
    decide whether prose was satisfied. The downstream planner must map
    each `VerificationObligation` to a concrete verification step, test,
    assertion, static check, manual approval, or documented non-testable
    acceptance gate. Drift is detected when an obligation is unmapped,
    its mapped check fails, or execution introduces behavior outside the
    locked target surfaces and boundaries.

## New Artifact

Add a deterministic planning handoff contract:

```js
type LockedSpecPlanningHandoff = {
  contractVersion: "semantix.planning-handoff.v1",
  handoffId: string,
  lockedArtifactId: string,
  sourcePacket: {
    sessionId: string,
    iteration: number,
    contractVersion: "semantix.phalanx.spec-studio.v1",
    contentHash: string
  },
  compilerProfile: CompilerProfile,
  lineage: HandoffLineage,
  governance: HandoffGovernance,
  dataPolicy: HandoffDataPolicy,
  inputHashes: HandoffInputHashes,
  fingerprint: string,
  originalUserRequest: string,
  originalUserRequestSensitivity: SensitivityTag,
  alignedRequirement: string,
  alignedRequirementSensitivity: SensitivityTag,
  mode: "new" | "update",
  requirements: RequirementFact[],
  acceptanceCriteria: AcceptanceCriterion[],
  negativeRequirements: NegativeRequirement[],
  targetSurfaces: TargetSurface[],
  boundaries: PlanningBoundary[],
  assumptions: PlanningAssumption[],
  risks: PlanningRisk[],
  evidence: EvidenceRef[],
  provenanceRecords: ProvenanceRecord[],
  capabilityScopes: CapabilityScope[],
  semanticObligations: SemanticObligation[],
  verificationObligations: VerificationObligation[],
  decisionAudit: DecisionRecord[],
  overrideDecisions: OverrideDecision[],
  freshnessGate: ResumeFreshnessGate,
  plannerInputs: {
    featureChecklistSeeds: FeatureChecklistSeed[],
    doNotChangeBoundaryRefs: string[],
    reuseBoundaryRefs: string[],
    compatibilityBoundaryRefs: string[],
    openNonBlockingConcerns: PlanningConcern[]
  }
}
```

The final field names may evolve, but the artifact must stay:

- JSON-serializable
- deterministic
- stable-id based
- free of unstructured prose-only requirements
- free of unlocked chat state
- safe to hash byte-for-byte

`requirement.text` and related fields may still contain prose. The
constraint is structural, not linguistic: prose is allowed only inside
ID-tagged, typed, source-linked facts with explicit priority,
acceptance, and status. The handoff must not include free-floating model
summary paragraphs as requirements.

Every fact that crosses the boundary must also carry grounding and
provenance. The planner must be able to distinguish facts that were
`grounded`, `transformed`, `bridged`, or `unsupported`, and must be able
to trace each fact to user decisions, grounded facts, evidence refs,
assumptions, or override decisions. Capability scopes travel with the
handoff so downstream planning is constrained by explicit tool, data,
and permission bounds rather than ambient runtime trust.

`plannerInputs` may contain convenience seeds and ID refs, but not raw
free-floating requirement strings. Any text inside planner inputs must be
inside an ID-tagged `FeatureChecklistSeed` or `PlanningConcern` with
source refs and grounding.

`plannerInputs.doNotChangeBoundaryRefs` is a camelCase derived field name
for JavaScript ergonomics; the underlying boundary kind and verification
obligation kind are always the enum value `do_not_change`.

## Versioning and Replay

`contractVersion` identifies the wire schema. It is not enough to
reproduce a handoff. Replay identity is defined by the tuple:

```
contractVersion + compilerProfile + lockedArtifact + packet + auditState
```

`compilerProfile` pins the mapper, validator, and canonicalization rules.
For v1, the initial profile is:

```js
{
  id: "semantix.planning-handoff.v1.profile.1",
  contractVersion: "semantix.planning-handoff.v1",
  mapperVersion: "semantix.planning-handoff.mapper.v1",
  validatorVersion: "semantix.planning-handoff.validator.v1",
  canonicalizationVersion: "semantix.canonical-json.v1"
}
```

`handoffId` is builder-derived and deterministic. The host must not
mint it, and the builder must not derive it from the final
`fingerprint`. v1 computes it after the packet hash is known:

```js
handoffId = deterministicHandoffId({
  lockedArtifactId: lockedArtifact.id,
  sourcePacketContentHash: inputHashes.packet.value,
  compilerProfileId: compilerProfile.id,
  lineageRelationship: auditState.lineage.relationship
})
```

`deterministicHandoffId` canonicalizes that object with
`semantix.canonical-json.v1`, hashes the resulting UTF-8 bytes with
SHA-256, and returns `handoff:<64 lowercase hex characters>`. The
`handoffId` field is included in the canonical JSON that is fingerprinted;
only the top-level `fingerprint` field is omitted from the fingerprint
input. This avoids a circular dependency while keeping the ID itself
auditable.

Packet compatibility is explicit. `semantix.planning-handoff.v1`
accepts only packet contract versions listed in
`SUPPORTED_PACKET_CONTRACT_VERSIONS_V1`; the initial allowed value is
`semantix.phalanx.spec-studio.v1`. A packet with an unrecognized
`packet.contractVersion` fails before mapping. The builder must not
silently coerce an older or newer packet into the v1 handoff shape.

Compiler profile immutability must be mechanical, not tribal. The frozen
profile constants and supported packet-version table live in the
handoff contract module or an adjacent checked-in constants module under
`packages/stx/src/`. CI must run snapshot tests that compare the exact
profile object, supported packet-version list, canonical serializer
fixtures, and known fixture fingerprints for the current profile ID. A
change to any of those snapshots under the same profile ID is a test
failure; the fix is a new profile ID or a deliberate fixture update tied
to an amendment/migration test.

The Semantix builder bundle must also have an import guard. Tests must
assert that `spec-studio-planning-handoff.js` and its transitive local
handoff helpers do not import LLM connectors, server modules,
filesystem modules, repo readers, network clients, or clock/random
helpers.

The handoff carries input hashes for audit-chain integrity. Input hashing
uses this exact v1 algorithm:

1. Validate the raw `HandoffBuildInput` as a strict envelope. Unknown
   fields fail before normalization.
2. Resolve `compilerProfileId`. Omitting it is normalized to the frozen
   default profile ID, so omitted-default and explicit-default calls have
   identical `buildInput` hashes.
3. Normalize `packet`, `lockedArtifact`, and `auditState` with
   `semantix.canonical-json.v1`. The packet hash is over the accepted
   `SemantixAlignmentPacket` body. Host wrapper fields are not part of
   the packet; if a packet schema contains a self-hash field, the profile
   must list that path as excluded before hashing, then validate the
   declared value after hashing. v1 has no implicit self-hash exclusions.
4. Compute SHA-256 hashes over the canonical JSON bytes of the normalized
   packet, locked artifact, audit state, and normalized full build-input
   envelope. The build-input hash includes the resolved
   `compilerProfileId`.

These hashes do not replace the handoff `fingerprint`; they prove which
immutable inputs produced the handoff and let auditors detect a host that
later mutates a supposedly locked input. `sourcePacket.contentHash` must
equal `inputHashes.packet.value`.

Replay rules:

- Locked handoffs are immutable. A v1 handoff is never rewritten into v2
  in place.
- A v2 planner may read a v1 handoff only through a v1 reader or an
  explicitly versioned compatibility adapter that preserves v1 semantics.
- Rebuilding a v1 handoff for audit must use the exact `compilerProfile`
  recorded on the artifact. If that profile is unavailable, the system
  may validate the stored canonical JSON and fingerprint, but must not
  claim byte-for-byte recompilation.
- A mapper, validator, or canonicalization change that can alter emitted
  bytes or validation outcomes is a new compiler profile. If it changes
  schema meaning, it is also a new `contractVersion`.
- Bug fixes that would change existing v1 output do not patch
  `semantix.planning-handoff.v1.profile.1`; they create a new profile
  and a new handoff through amendment, migration, or relock.
- Stored canonical handoff bytes plus fingerprint are the audit source of
  truth. Rebuild is an audit convenience, not permission to mutate the
  locked artifact.

Amendments and migrations must be represented in the artifact lineage.
A child handoff records `parentHandoffId`, the parent locked artifact,
the amendment decision, and the reason the child exists. The parent
remains valid as historical evidence even if later handoffs supersede it.
In v1, `supersedesHandoffRefs` means the child handoff replaces each
listed parent handoff wholesale for future planning entrypoints. Partial
supersession by reused requirement ID is out of scope for v1 and must be
modeled as a new child handoff with complete current planning context.

## Authority Model

Authority is layered deliberately:

- Semantix readiness is advisory and helps the host decide whether the
  packet is a candidate for lock.
- The host is the lock authority: it owns session state, user identity,
  role binding, lock ceremony, and persistence.
- The handoff builder is a deterministic circuit breaker. It has no
  product authority, but it can refuse to compile unsafe or unsupported
  inputs. The host may refuse any packet Semantix marks ready, but it
  cannot force a locked handoff from inputs the builder rejects. The host
  must amend the packet or audit state and try again.

Override and demotion authority is policy-bound:

- Every lock, approval, blocker demotion, policy gate, and freshness gate
  decision must have a `DecisionRecord` with actor, role, timestamp,
  target refs, and rationale where required.
- Every `OverrideDecision` must cite an authorized `DecisionRecord`.
- The host must supply `HandoffGovernance` with actor-role bindings and
  the role refs authorized to lock, approve, demote blockers, and pass
  policy gates.
- Demoting a blocker is treated as a policy-relevant circuit-breaker
  action. It requires an actor with a demotion-authorized role and a
  rationale. If the finding is policy/security/safety classified or was
  emitted by a policy gate, the override must also cite a policy-gate
  decision by an actor with a policy-gate-authorized role.
- v1 uses `single_approver_v1`: no quorum and no mandatory separation
  between spec author, approver, and demoter. That is an explicit v1
  scope cut, not an implicit safety claim. Hosts that need separation of
  duties must enforce it outside the v1 handoff contract or use a
  stricter contract profile.
- In `single_approver_v1`, the same actor may also satisfy bridged-must
  confirmation, unknown-sensitivity policy gate, blocker demotion, and
  freshness-gate decisions when that actor has every required role. This
  collapsed authority is an explicit v1 risk surface and a v2 design
  target for quorum and separation-of-duty policy.

Evidence authority is host-owned at lock time:

- The packet may reference evidence IDs and may carry Semantix-proposed
  evidence hints, but canonical `EvidenceRef` records in the handoff come
  from `auditState.evidence`.
- The builder fails if any packet grounding, context source, provenance
  record, sensitivity assignment, or freshness gate references evidence
  that is absent from `auditState.evidence`.
- The builder fails if `auditState.evidence` contains unused evidence.
  v1 does not allow extra persisted evidence records; a later profile may
  add an explicit allow-unused field if hosts need it.
- Freshness, sensitivity, source identity, and captured-at metadata on
  evidence are therefore part of the host lock audit, not Semantix
  inference.

## Data Bounds and Sensitive Content

The handoff is immutable audit material, so v1 must fail closed rather
than silently persist unbounded or unclassified sensitive content.

Size limits:

- canonical handoff JSON must not exceed 1 MiB
- `requirements`: max 200
- `acceptanceCriteria`: max 600
- `negativeRequirements`: max 200
- `targetSurfaces`: max 100
- `boundaries`: max 300
- `assumptions`: max 200
- `risks`: max 200
- `evidence`: max 500
- `provenanceRecords`: max 1500
- `verificationObligations`: max 1200
- `semanticObligations`: max 300
- `decisionAudit`: max 1500
- `overrideDecisions`: max 500
- `capabilityScopes`: max 50
- `dataPolicy.redactions`: max 500
- `plannerInputs.featureChecklistSeeds`: max 300
- `plannerInputs.openNonBlockingConcerns`: max 300
- nested ref arrays on a single object: max 100
- prose fields: max 4000 normalized characters each
- ID/ref/path/hash/timestamp fields: max 512 normalized characters each

Sensitive content rules:

- The host owns final sensitivity classification before lock. Semantix
  may propose classifications, a user may classify content, and policy
  services may provide evidence, but the builder treats classifications
  as locked input and does not classify text.
- If the host uses an LLM or external classifier, that output is
  pre-lock advisory evidence. The host must still persist the final
  `SensitivityTag`, source decision refs, and any policy-gate decisions
  in `auditState` before calling the builder.
- Hosts should not treat `unknown` as a routine default. `unknown`
  sensitivity is a fail-closed state that can cross the handoff boundary
  only with an explicit policy-gate `DecisionRecord` and matching
  `dataPolicy.policyDecisionRefs`.
- Every text-bearing handoff field must carry `sensitivity` directly or
  through an adjacent `*Sensitivity` field.
- `secret` content is forbidden in canonical handoff text. The host must
  redact it before lock and store only a redacted placeholder plus a
  vault/evidence ref.
- `pii`, `confidential`, and `regulated` content may appear only when
  `dataPolicy.allowSensitivePersistence` is true and the field ref appears
  in `dataPolicy.sensitiveFieldRefs`.
- `unknown` text may appear only when policy-gated, when
  `dataPolicy.allowSensitivePersistence` is true, and when the field ref
  appears in `dataPolicy.sensitiveFieldRefs`.
- Redaction is explicit. The builder must not truncate, mask, or rewrite
  sensitive fields silently.
- If Semantix or the host cannot classify a text-bearing field, the field
  is `unknown` and the builder fails unless the host records a policy-gate
  decision authorizing immutable persistence.
- `HandoffDataPolicy.classification` is host-supplied and must equal the
  maximum classification across persisted handoff text fields after
  redaction under this v1 ordering: `public < internal < confidential <
  pii < regulated < secret < unknown`. The builder verifies consistency
  with supplied field tags; it does not classify text.

Text-bearing field audit:

| Field | Sensitivity source |
| --- | --- |
| `originalUserRequest` | `originalUserRequestSensitivity` |
| `alignedRequirement` | `alignedRequirementSensitivity` |
| `RequirementFact.text` | `RequirementFact.sensitivity` |
| `AcceptanceCriterion.text` | `AcceptanceCriterion.sensitivity` |
| `NegativeRequirement.text` | `NegativeRequirement.sensitivity` |
| `TargetSurface.name` | `TargetSurface.sensitivity` |
| `PlanningBoundary.text` | `PlanningBoundary.sensitivity` |
| `PlanningAssumption.text` | `PlanningAssumption.sensitivity` |
| `PlanningRisk.text` | `PlanningRisk.sensitivity` |
| `EvidenceRef.summary` | `EvidenceRef.sensitivity` |
| `ProvenanceRecord.summary` | `ProvenanceRecord.sensitivity` |
| `SemanticObligation.text` | `SemanticObligation.sensitivity` |
| `VerificationObligation.text` | `VerificationObligation.sensitivity` |
| `FeatureChecklistSeed.text` | `FeatureChecklistSeed.sensitivity` |
| `PlanningConcern.text` | `PlanningConcern.sensitivity` |
| `DecisionRecord.valueSummary` | `DecisionRecord.sensitivity` |
| `DecisionRecord.rationale` | `DecisionRecord.rationaleSensitivity` |
| `OverrideDecision.rationale` | `OverrideDecision.rationaleSensitivity` |
| `HandoffLineage.reason` | `HandoffLineage.reasonSensitivity` |
| `RedactionRef.replacement` | `RedactionRef.replacementSensitivity` |

`CapabilityGrant.ref`, `CapabilityScope.dataScopes`, `EvidenceRef.ref`,
ID fields, hash fields, timestamp fields, and field pointers are opaque
refs, not prose. They must not contain secrets, natural-language
rationale, or user-authored content. If a host needs explanatory text for
one of those values, it must use a sensitivity-tagged decision,
provenance, evidence summary, or obligation field.

## Determinism Rules

The builder must:

- use a pure function API
- sort arrays by stable IDs, then stable text fallback
- normalize whitespace
- preserve original IDs from the locked packet
- generate derived IDs only from stable source IDs
- compute `fingerprint` from canonical JSON
- avoid current timestamps except lock metadata already supplied by the
  host
- avoid random IDs
- avoid environment-dependent values
- avoid LLM calls
- avoid repo reads
- avoid network calls
- avoid hidden defaults that change behavior by deployment

The same locked inputs must produce byte-identical handoff JSON. In this
document, "same locked inputs" means the same `contractVersion`,
`compilerProfile`, `lockedArtifact`, `packet`, and `auditState`.

## Canonicalization Rules

The byte-equality contract is part of the public API. `canonicalizePlanningHandoff`
must produce UTF-8 JSON without a byte-order mark, and the same canonical
object must serialize identically across supported Node versions,
operating systems, locales, and ICU builds.

Hosts must persist canonical handoff bytes, not only an in-memory
JavaScript object. A host may store the parsed object for query, but the
audit artifact is the exact UTF-8 output of
`canonicalizePlanningHandoff(handoff)` plus its fingerprint.

Hashing:

- `fingerprint` is `sha256:<64 lowercase hex characters>`.
- The digest is SHA-256 over the UTF-8 bytes of canonical JSON with the
  top-level `fingerprint` field omitted.
- No salt, timestamp, host ID, process ID, random value, locale, or
  environment value may enter the digest.

String normalization:

- All string values are normalized to Unicode NFC before comparison and
  serialization.
- All newline sequences become `\n`; `\r\n` and bare `\r` are forbidden
  in canonical output.
- Prose fields (`text`, `summary`, `rationale`, `alignedRequirement`,
  `originalUserRequest`) are trimmed, trailing line whitespace is
  stripped, horizontal whitespace runs inside a line collapse to one
  ASCII space, and three or more consecutive newlines collapse to two.
- Identifier, enum, timestamp, hash, ref, and path-like fields are not
  rewritten beyond NFC. Leading or trailing whitespace in those fields is
  a validation error.
- Timestamps in handoff output must use UTC RFC 3339 millisecond
  precision: `YYYY-MM-DDTHH:mm:ss.SSSZ`. Offset forms, local time,
  missing milliseconds, and leap seconds fail validation.

Sorting:

- Object keys are sorted recursively by byte-wise UTF-8 order after NFC
  normalization.
- Arrays of objects are sorted by stable `id`; ties sort by `sourceRef`,
  then normalized `text` or `name`, then canonical JSON. Ties after that
  are duplicate facts and fail validation. Explicitly sequenced arrays,
  currently `decisionAudit`, sort by globally unique `sequence`.
- Arrays of strings are deduped by exact normalized value and sorted by
  byte-wise UTF-8 order.
- No locale-sensitive compare, natural sort, ICU collation, or
  `Intl.Collator` is allowed.

Mapper-level dedupe is allowed only where this profile explicitly names
it:

- `plannerInputs.featureChecklistSeeds` may collapse byte-identical
  candidate seeds with the same stable source identity before IDs are
  emitted.
- `semanticObligations` may collapse byte-identical candidate semantic
  facts with the same stable source identity before IDs are emitted.
- `provenanceRecords` may collapse byte-identical records with the same
  `id`.

All emitted handoff collections fail validation on duplicate IDs,
duplicate refs, or non-identical facts with the same dedupe key.
Requirements, acceptance criteria, decisions, evidence, boundaries,
assumptions, risks, capability scopes, verification obligations, and
override decisions are not silently deduped in v1.

JSON value rules:

- Unknown fields fail validation before canonicalization.
- Optional collection fields are emitted as empty arrays, not omitted.
- Optional scalar fields are omitted when absent; `null` is disallowed in
  v1 unless a field explicitly says otherwise.
- `undefined`, `NaN`, `Infinity`, `-Infinity`, and `-0` are disallowed.
- Numeric fields in v1 are finite non-negative integers only and
  serialize as base-10 decimals with no exponent or fractional suffix.
- Boolean fields serialize as JSON `true` or `false`.

## Reference and Field Path Rules

Every persisted handoff object ID is a namespaced stable ref. Object
IDs and all `*Ref`/`*Refs` fields use the same value, so links are
unambiguous across collections. v1 namespaces are:

| Namespace | Example |
| --- | --- |
| `handoff` | `handoff:<64 lowercase hex>` |
| `locked_artifact` | `locked_artifact:lia_123` |
| `requirement` | `requirement:req_123` |
| `acceptance` | `acceptance:acc_123` |
| `negative_requirement` | `negative_requirement:neg_123` |
| `target_surface` | `target_surface:surface_123` |
| `boundary` | `boundary:bnd_123` |
| `assumption` | `assumption:asm_123` |
| `risk` | `risk:rsk_123` |
| `evidence` | `evidence:ev_123` |
| `provenance` | `provenance:prov_123` |
| `capability_scope` | `capability_scope:cap_123` |
| `capability_grant` | `capability_grant:grant_123` |
| `semantic_obligation` | `semantic_obligation:sem_123` |
| `verification_obligation` | `verification_obligation:ver_123` |
| `decision` | `decision:dec_123` |
| `override` | `override:ovr_123` |
| `redaction` | `redaction:red_123` |
| `freshness_gate` | `freshness_gate:frg_123` |
| `coverage` | `coverage:cov_123` |

When the locked packet supplies bare local IDs, the mapper preserves the
local ID as the namespace suffix rather than minting a new opaque suffix.
External refs must use an explicit external namespace such as
`external:<system>:<stable-id>` or a field-specific opaque ref documented
by that field. Bare ambiguous refs fail validation.

`fieldRef`, `subjectPath`, and redaction field paths use Stable Field
Pointer v1, not numeric JSON Pointer array indexes. A field pointer is a
slash-separated path where collection members are addressed by their
namespaced IDs:

```text
/requirements/requirement:req_123/text
/dataPolicy/redactions/redaction:red_123/replacement
```

Path tokens use RFC 6901 escaping for `~` and `/`, but array indexes are
forbidden because canonical sorting can move array positions.

## Freshness Gate Semantics

Freshness evaluation must be deterministic for the same handoff evidence
and the same observed recheck inputs. The host or planner may own the
tooling that observes current freshness, but it must apply these v1
comparison rules:

Semantix should provide a pure `classifyFreshnessGateResult` helper that
takes a handoff and a `FreshnessObservationSet`, performs no external
reads, and applies only the comparison rules below. Hosts may implement
their own checker only if they produce byte-equivalent
`FreshnessGateResult` objects for the same inputs.

- All unavailable, unauthorized, unparsable, or type-mismatched recheck
  observations are `hard_stale`.
- `clean_resume` means the observed freshness kind and value exactly
  match the handoff evidence after canonical string normalization,
  `sourceIdentity` is `verified`, and `lockedEvidence` is `resolvable`.
- `soft_stale` means the source identity is still verified and the
  locked evidence remains resolvable, but a newer or different observed
  value indicates planning context may need regeneration or reapproval.
- `hard_stale` means the locked evidence can no longer be verified as
  the same source identity, the locked snapshot/hash/ref is missing, or
  the evidence system cannot prove whether the locked evidence is still
  valid.

Per-kind rules:

- `git_commit`: exact same commit value is `clean_resume`. A different
  observed commit is `soft_stale` only when the locked commit still
  resolves in the same repository identity. If the repository identity
  cannot be verified or the locked commit cannot be resolved, the result
  is `hard_stale`. Branch drift is not separately interpreted in v1; a
  host that needs branch semantics must capture branch state as
  additional evidence or use a stricter profile.
- `file_sha256`: exact same hash is `clean_resume`. A different hash for
  the same resolvable file identity is `soft_stale`. A missing file,
  unreadable file, changed file identity, or unverifiable path is
  `hard_stale`.
- `trace_snapshot`: exact same snapshot value that still resolves is
  `clean_resume`. A newer snapshot for the same trace identity while the
  locked snapshot remains resolvable is `soft_stale`. An evicted,
  missing, moved, or identity-mismatched snapshot is `hard_stale`.
- `upload_sha256`: exact same hash for the same upload identity is
  `clean_resume`. A missing upload, changed upload identity, or changed
  hash is `hard_stale`; v1 does not define soft-stale uploads.
- `evidence_snapshot`: exact same snapshot value that still resolves is
  `clean_resume`. A newer snapshot for the same evidence identity while
  the locked snapshot remains resolvable is `soft_stale`. A missing,
  evicted, or identity-mismatched snapshot is `hard_stale`.
- `external_timestamp`: exact same UTC millisecond timestamp is
  `clean_resume`. A later observed timestamp for the same source
  identity is `soft_stale`. An earlier timestamp, missing timestamp,
  non-canonical timestamp, or unverifiable source identity is
  `hard_stale`. v1 skew tolerance is zero milliseconds; hosts that need
  clock-skew windows must capture a stronger evidence kind or use a new
  compiler profile.

The aggregate `FreshnessGateResult.state` is the maximum severity across
all evidence results, where `hard_stale` outranks `soft_stale`, and
`soft_stale` outranks `clean_resume`.

Each per-evidence result also carries a stable `reason` code from the
Freshness Reason Codes Appendix. Reason codes are diagnostic; they must
not alter the state ordering above.

`ResumeFreshnessGate.onSoftStale` and `onHardStale` are per-handoff
policy in v1, not per-evidence policy. A cheap `git_commit` recheck and
a flaky `external_timestamp` therefore receive the same aggregate
treatment once their state is computed. That is an explicit v1 scope cut;
per-evidence policy is reserved for a later profile.

## Fail-Closed Rules

The builder must throw a structured validation error when:

- packet source is not `semantix`
- packet readiness is not `ready`
- packet is degraded. In v1, degraded means a visible host fallback
  envelope such as `source: "phalanx-degraded"` or a Semantix fallback
  packet that carries evaluator-degradation metadata and is not
  lockable by `isPacketLockable`
- packet `contractVersion`, handoff `contractVersion`, or
  `compilerProfile` is unsupported
- a rebuild request uses a different compiler profile from the stored
  handoff
- normalized input hashes cannot be computed, do not match a rebuild
  request, or disagree with stored `sourcePacket.contentHash`
- amendment lineage is missing or references an unknown parent when the
  locked artifact is a child/amendment
- packet fails `validateSemantixAlignmentPacket`
- packet is not lockable by Semantix-side lockability predicate
- host lock metadata is missing
- host decision audit is missing globally unique sequence numbers, contains
  duplicate IDs, or contains non-canonical timestamps
- governance metadata is missing authorized actor-role bindings for lock,
  approval, blocker demotion, or policy-gate decisions
- the lock decision was not made by an actor with a lock-authorized role
- approval decisions are missing or unauthorized, unless the
  `single_approver_v1` lock decision also satisfies an approval-authorized
  role
- data policy is missing, size limits are exceeded, text-bearing fields
  lack sensitivity classification, forbidden secret content is present, or
  sensitive persistence lacks an authorized policy-gate decision
- capability scopes are missing or fail to declare allowed and forbidden
  tool/data/permission bounds
- unresolved blocker findings exist
- any must-level requirement lacks acceptance
- a requirement lacks stable `id`, `text`, `type`, `priority`, or
  `status`
- a requirement, acceptance criterion, semantic obligation, feature seed,
  planning concern, assumption, or risk lacks grounding status and
  provenance refs
- a must-level requirement is `bridged` or `unsupported` without an
  explicit user confirmation or override decision in the audit
- update mode lacks `targetSurfaces`
- update mode has no boundary fact with kind `do_not_change`, `reuse`,
  or `compatibility`
- negative requirements or `do_not_change` boundaries cannot be promoted
  into verification obligations
- soft semantic obligations cannot be promoted into manual-review,
  policy-gate, or verifier obligations
- grounded facts claim used evidence but have empty evidence refs
- packet, provenance, grounding, sensitivity, or freshness inputs
  reference evidence absent from `auditState.evidence`, or
  `auditState.evidence` contains unused evidence
- used evidence lacks freshness provenance such as source revision,
  captured timestamp, snapshot ID, content hash, or equivalent immutable
  reference
- freshness gate policy is missing for any non-user evidence ref that can
  become stale after lock
- a blocker was skipped without an explicit host override/demotion
  decision
- an override/demotion decision lacks rationale, actor, authorized role,
  timestamp, and the finding ID it demoted
- a blocker demotion is not backed by an authorized demotion decision
- a policy/security/safety blocker is demoted without an authorized
  policy-gate decision
- any ID/ref cross-link in the handoff fails to resolve to the intended
  local object
- any `OverrideDecision.decisionRef` does not resolve to an existing
  `DecisionRecord` with `kind: "override_demotion"`
- any `DecisionRecord` with `kind: "override_demotion"` lacks a matching
  `OverrideDecision`
- any `SemanticObligation.verificationObligationRef` does not resolve to
  a `VerificationObligation` with `kind: "semantic"` and a reciprocal
  `semanticObligationRef`
- any requirement, acceptance criterion, negative requirement, boundary,
  or semantic obligation has missing or non-reciprocal verification
  obligation linkage

## Semantix-Owned Implementation

### 1. Contract Module

Add:

```
packages/stx/src/spec-studio-planning-handoff.js
```

Exports:

- `PLANNING_HANDOFF_CONTRACT_VERSION`
- `PLANNING_HANDOFF_COMPILER_PROFILES`
- `SUPPORTED_PACKET_CONTRACT_VERSIONS_V1`
- `buildPlanningHandoff(input)`
- `validatePlanningHandoff(handoff)`
- `assertPlanningHandoff(handoff)`
- `canonicalizePlanningHandoff(handoff)`
- `fingerprintPlanningHandoff(handoff)`
- `classifyFreshnessGateResult(handoff, observationSet)`

Definition of done:

- pure functions only
- no LLM connector import
- no server dependency
- no filesystem dependency
- no repo reader, network client, clock, or random dependency
- no locale-sensitive comparison or environment-dependent serialization
- frozen profile constants for every supported compiler profile
- snapshot tests pin profile constants, supported packet versions,
  canonical serializer fixtures, and fixture fingerprints
- import-guard tests reject accidental LLM, server, filesystem, repo,
  network, clock, or random imports from the builder dependency graph
- all exported functions covered by unit tests

### 2. Lockability Preflight

The builder should reuse existing Semantix-side guards:

- `validateSemantixAlignmentPacket`
- `isPacketLockable`
- readiness classifier checks where useful
- negative requirement promotion

Definition of done:

- non-ready packets fail
- degraded packets fail
- packets with unresolved blockers fail
- update packets without target surfaces fail
- update packets without boundaries fail
- unsupported contract versions or compiler profiles fail
- unauthorized lock or demotion audit fails
- root handoffs with parent refs fail; amendment, migration, or relock
  handoffs without parent refs fail

### 3. Canonical Extraction

Build deterministic mappers:

- `canonicalRequirements(packet)`
- `canonicalAcceptance(packet)`
- `canonicalNegativeRequirements(packet)`
- `canonicalTargetSurfaces(packet)`
- `canonicalBoundaries(packet)`
- `canonicalAssumptions(packet)`
- `canonicalRisks(packet)`
- `canonicalEvidence(packet, auditState)`
- `canonicalProvenance(packet, auditState)`
- `canonicalCapabilityScopes(lockedArtifact, auditState)`
- `canonicalDataPolicy(lockedArtifact, auditState)`
- `canonicalSemanticObligations(packet)`
- `canonicalVerificationObligations(packet)`
- `canonicalDecisionAudit(auditState)`
- `canonicalGovernance(lockedArtifact, auditState)`
- `canonicalLineage(lockedArtifact, auditState)`
- `canonicalCompilerProfile(input)`
- `canonicalFreshnessGate(evidence, lockedArtifact, auditState)`
- `canonicalInputHashes(packet, lockedArtifact, auditState, input)`
- `canonicalHandoffId(lockedArtifact, inputHashes, compilerProfile, lineage)`

Definition of done:

- every mapper sorts deterministically
- mapper-level dedupe follows the v1 duplicate policy in the
  Canonicalization Rules section
- source refs are preserved
- grounding labels and provenance refs are preserved or fail validation
- host-owned capability and decision IDs are preserved, not minted by
  Semantix
- parent/child lineage refs are preserved
- compiler profile fields are copied from frozen constants, not inferred
  from package metadata
- no data is silently dropped if it affects downstream planning

### 4. Verification Obligations

Convert requirement and boundary facts into explicit obligations:

- each must-level requirement creates exactly one `requirement`
  obligation
- each acceptance criterion creates one obligation
- each negative requirement creates one obligation
- each `do_not_change` boundary creates one obligation
- each compatibility requirement creates one obligation
- each soft semantic obligation creates a manual-review, policy-gate, or
  verifier obligation

Cardinality and linkage rules:

- A must-level `RequirementFact` with three `AcceptanceCriterion` entries
  creates four obligations: one `requirement` obligation and three
  `acceptance` obligations.
- The requirement obligation uses `sourceRef = requirement.id`,
  `sourceRefs = [requirement.id]`, and `requirementRef = requirement.id`.
- Each acceptance obligation uses `sourceRef = criterion.id`,
  `sourceRefs = [criterion.id, criterion.requirementRef]`,
  `acceptanceCriterionRef = criterion.id`, and `requirementRef =
  criterion.requirementRef`.
- The requirement obligation and its acceptance obligations are linked by
  `relatedObligationRefs`; they are not deduped into one obligation.
- Obligations are deduped only by `(kind, sourceRef)`. Semantic similarity
  is not a dedupe rule.

Definition of done:

- the planner can see what must be verified before execution closes
- negative requirements are first-class
- update safety boundaries are first-class
- soft constraints such as tone, safety caveats, and semantic fidelity are
  first-class review obligations rather than lossy prose

### 5. Stable Fingerprint

Add canonical JSON serialization and hash generation.

Rules:

- object keys sorted recursively
- arrays pre-sorted by mapper rules
- `handoffId` is included
- `fingerprint` excludes itself
- hash algorithm is fixed as SHA-256 over UTF-8 canonical JSON
- fingerprint encoding is `sha256:<64 lowercase hex characters>`
- string, timestamp, null, integer, and sort rules follow the
  Canonicalization Rules section above

Definition of done:

- repeated builds from identical inputs produce same fingerprint
- repeated builds from identical normalized inputs produce same
  `inputHashes`
- reordered packet arrays produce same handoff and same fingerprint
- changed requirement text changes fingerprint
- changed packet, locked artifact, or audit state changes the
  corresponding input hash
- changing compiler profile changes replay identity and, if emitted into
  the artifact, the fingerprint

Preferred accelerator:

- use `fast-json-stable-stringify` or `json-stable-stringify` for
  key ordering only if the dependency is approved for `@semantix/stx`
- otherwise implement a small local canonical serializer with explicit
  tests for nested key ordering, arrays, numbers, nulls, and strings
- regardless of dependency choice, implement Semantix-owned normalization
  for Unicode, whitespace, timestamps, number rejection, null rejection,
  and byte-wise sorting; do not inherit unspecified library behavior as
  contract behavior

### 6. Strict Schema Validation

Define the handoff shape as an executable strict schema before writing
the builder.

Preferred accelerator:

- use Zod or an equivalent strict schema validator if adding the
  dependency is approved
- otherwise follow the existing Semantix validator style, but keep the
  handoff validator schema-like and exhaustive

Definition of done:

- `HandoffBuildInput` and `HandoffAuditState` are validated as strict
  envelopes before mapping
- unknown top-level fields fail validation
- required nested fields fail validation when missing
- enum fields are checked centrally
- top-level and nested capability, provenance, decision audit, semantic
  obligation, override decision, governance, lineage, compiler profile,
  data policy, sensitivity classification, and freshness gate fields are
  exhaustive
- validation errors include stable codes and JSON paths

### 7. Package Exports

Export the module from:

```
packages/stx/src/index.js
```

Definition of done:

- external host integration tests can import the builder from the
  package root

### 8. Semantix Tests

Add:

```
packages/stx/tests/spec-studio-planning-handoff.test.js
```

Required tests:

- greenfield ready packet builds a valid handoff
- update ready packet builds target surfaces and boundaries
- reordered requirements produce identical canonical output
- reordered findings produce identical canonical output
- missing acceptance fails
- unresolved blocker fails
- degraded packet fails
- update packet without target surfaces fails
- update packet without boundaries fails
- negative requirements become verification obligations
- `do_not_change` boundaries become verification obligations
- used evidence without freshness provenance fails
- missing freshness gate for stale-capable evidence fails
- per-kind freshness comparison returns deterministic clean, soft, and
  hard stale states
- planner resume states `clean_resume`, `soft_stale`, and `hard_stale`
  are schema-validated
- `FreshnessGateResult` shape is schema-validated for host integration
  fixtures
- demoted blocker without override audit fails
- unauthorized demoted blocker fails
- policy/security/safety blocker demotion without policy gate fails
- override audit carries demoted blocker into assumptions or risks
- missing typed decision audit fails
- missing governance or role binding fails
- missing data policy, oversized payloads, unclassified text, unredacted
  secrets, and unauthorized sensitive persistence fail
- missing amendment lineage for child handoff fails
- unsupported compiler profile fails
- unsupported packet contract version fails
- profile constants and supported packet-version table are snapshot
  tested under the current profile ID
- builder import guard rejects LLM, server, filesystem, repo, network,
  clock, and random dependencies
- handoff ID is deterministic, included in the fingerprint input, and not
  derived from the fingerprint
- input hashes are stable, included in the handoff, and change when
  packet, locked artifact, or audit state changes
- omitted compiler profile and explicit default compiler profile produce
  identical `buildInput` hashes
- packet hash fixtures cover any profile-declared self-hash exclusions
- unresolved override, decision, semantic-obligation, requirement,
  acceptance, boundary, and verification-obligation links fail
- packet evidence refs absent from `auditState.evidence` fail, and unused
  `auditState.evidence` fails
- namespaced ref validation and Stable Field Pointer validation reject
  ambiguous refs and numeric array indexes
- v1 replay with the v1 profile is byte-identical
- v1 handoff remains readable through the v1 reader after a v2 fixture is
  introduced
- reordered decision audit produces identical canonical output
- missing capability scope fails
- bridged must requirement without explicit confirmation fails
- semantic obligations become verification obligations
- verification obligation cardinality and source linkage are deterministic
- Unicode/CRLF/prose whitespace normalization is deterministic
- byte-wise UTF-8 sort order is independent of locale
- duplicate decision sequence fails validation
- fingerprint changes when a requirement changes

Definition of done:

- focused test file passes
- full `@semantix/stx` test suite passes

## Host-Owned Integration

### 1. Lock Route

The host lock route should run this sequence:

1. load latest Spec Studio session state
2. validate latest Semantix packet
3. recompute lock eligibility
4. require explicit user lock action
5. canonicalize host decision audit and override/demotion audit
6. classify every persisted text-bearing field or record an explicit
   policy gate for `unknown`
7. bind explicit capability scopes for planning, execution, and
   verification
8. attach provenance and evidence freshness metadata
9. mint immutable `LockedIntentArtifact`
10. call `buildPlanningHandoff`
11. persist immutable handoff next to the locked artifact

Definition of done:

- lock refuses non-ready packets
- lock refuses unresolved blockers
- lock refuses stale packet state
- lock refuses missing decision audit, capability scope, provenance, or
  freshness metadata required by the handoff schema
- lock refuses missing final sensitivity classifications or missing
  policy-gate decisions for `unknown` classifications
- lock persists both `LockedIntentArtifact` and handoff atomically

### 2. Planner Handoff Loader

Downstream planning must consume the persisted handoff, not the live
chat transcript.

Definition of done:

- planner entrypoint accepts handoff ID or locked artifact ID
- planner cannot start from mutable session state
- planner runs the handoff freshness gate before creating or resuming a
  plan
- planner classifies host-collected freshness observations with the v1
  per-kind comparison semantics
- planner persists an auditable `FreshnessGateResult` for every start and
  resume attempt
- `hard_stale` blocks planning until relock or amendment
- `soft_stale` blocks execution approval until regeneration or explicit
  reapproval follows the handoff policy
- planner enforces `CapabilityScope` instead of inheriting ambient tool
  authority
- planner context includes requirements, acceptance, boundaries,
  semantic obligations, verification obligations, capability scopes,
  provenance records, decision audit, and evidence refs

### 3. Planning Output Checks

The host should check downstream planning output against the handoff.

Minimum checks:

- every must requirement is mapped to at least one planning item
- every verification obligation is mapped to a verification step
- every semantic obligation is mapped to a manual review, semantic
  verifier, or policy gate
- every `do_not_change` boundary is represented in execution constraints
- every capability scope is represented in tool/data permission
  constraints
- update target surfaces are not replaced without approval
- no planner-invented target surface appears without a spec amendment
- bridged or low-confidence facts are visible in the plan review surface

Definition of done:

- missing mappings block plan approval or require explicit override
- overrides are audit events

### 4. Verification Plan

The downstream planner must produce a deterministic verification plan
from the handoff before execution can be considered approved.

Minimum artifact shape:

```js
type VerificationPlan = {
  handoffId: string,
  obligationMappings: Array<{
    obligationId: string,
    method: "automated_test" | "static_check" | "manual_review" | "semantic_review" | "policy_gate" | "not_testable",
    target: string,
    command?: string,
    assertion?: string,
    reviewerRole?: string,
    rationale?: string
  }>
}
```

Rules:

- every `VerificationObligation` must have at least one mapping
- every `SemanticObligation` must be represented by a verification
  obligation and mapped before approval
- `not_testable` requires rationale and explicit human approval
- failed mapped checks create drift findings
- unmapped obligations block plan approval
- verification mappings reference handoff obligation IDs, not chat text

Definition of done:

- plan approval fails when an obligation has no mapping
- test execution can report pass/fail by obligation ID
- manual gates are auditable and actor-bound

### 5. Execution Drift

Execution must compare implementation outcomes against the locked
handoff.

Definition of done:

- blocker drift stops dispatch or requires explicit override
- non-blocking drift is recorded as audit evidence
- capability-scope violations are drift findings even if functional
  requirements pass
- stale evidence discovered after planning creates drift and may require
  amendment
- spec changes require child spec session or equivalent amendment flow
- locked artifacts remain immutable

## Cross-System API Boundary

Semantix exposes:

```js
buildPlanningHandoff({
  packet,
  lockedArtifact,
  auditState,
  compilerProfileId?: "semantix.planning-handoff.v1.profile.1"
})
```

The public input shape is `HandoffBuildInput`; `auditState` is a
strictly typed `HandoffAuditState`, not an open host-specific bag. The
host may store richer internal audit state, but only fields represented
in the typed build input cross the Semantix boundary. Unknown build-input
fields fail validation before handoff bytes or hashes are emitted.

The host supplies:

- locked intent/spec artifact
- latest accepted `SemantixAlignmentPacket`
- optional compiler profile ID; omitted means the current contract's
  default frozen profile, not live package-version-derived behavior
- unsupported `compilerProfileId` values fail before any handoff bytes
  are emitted; the builder must not silently fall forward to a newer
  profile
- data policy, sensitivity classifications, and redaction refs for every
  text-bearing fact that may persist sensitive content
- canonical `DecisionRecord[]` audit state with stable IDs, sequence, and
  timestamps
- explicit `OverrideDecision[]` demotion audit state
- governance metadata with actor-role bindings and authorized roles for
  lock, approval, demotion, and policy gates
- amendment lineage when the locked artifact supersedes or amends a prior
  handoff
- capability scopes for downstream planning, execution, and verification
- provenance records for requirements, assumptions, risks, soft
  obligations, grounded facts, and decisions
- canonical evidence records in `auditState.evidence`; packet evidence
  refs are validated against these records
- lock metadata
- optional coverage recomputation result
- evidence freshness metadata for context sources that came from repo,
  trace, upload, evidence systems, or external systems
- freshness gate policy for planner start/resume

Semantix returns:

- `LockedSpecPlanningHandoff`

For persistence, the host must store the bytes returned by
`canonicalizePlanningHandoff(handoff)` and the `fingerprint`, rather than
serializing the object with host-local JSON settings.

Semantix does not return:

- architecture document
- task graph
- planner-specific work package
- verify command selection
- implementation plan
- run dispatch approval

## Rollout Phases

### Phase 0 - Contract Pinning

Tasks:

- finalize handoff schema fields
- define the nested handoff interfaces in this plan before implementation
- define `HandoffBuildInput`, `HandoffAuditState`, and input-hash fields
- define the minimum `LockedIntentArtifact` shape visible to the builder
- document ID and sorting rules
- document deterministic `handoffId` generation
- document namespaced refs and Stable Field Pointer v1 field paths
- pin SHA-256 fingerprint encoding and canonical JSON byte rules
- pin Unicode, whitespace, timestamp, null, and integer normalization
  behavior
- define `CapabilityScope`, `ProvenanceRecord`, `DecisionRecord`,
  `SemanticObligation`, `ResumeFreshnessGate`, `CompilerProfile`,
  `HandoffLineage`, `HandoffGovernance`, `HandoffDataPolicy`, and
  sensitivity classification
- define verification-obligation cardinality, source-linkage, and dedupe
  rules
- define v1 replay policy, v1 reader compatibility expectations, and
  compiler-profile immutability rules
- define v1 packet-version compatibility and fail-closed behavior for
  unsupported packet versions
- define v1 freshness comparison semantics for every evidence kind and
  document the per-handoff freshness-policy scope cut
- define host-owned evidence authority between packet refs and
  `auditState.evidence`
- define text-bearing field sensitivity coverage
- define cross-link integrity checks for overrides, semantic
  obligations, verification obligations, acceptance criteria, and
  boundaries
- define v1 governance scope cut for single approver, no quorum, and no
  mandatory role separation
- document fail-closed errors
- add contract examples for greenfield and update packets
- record the Phase 0 dependency decision before implementation starts

Dependency decision gate:

- Owner: Semantix package owner and host integration owner.
- Deadline: Phase 0 exit; Phase 1 cannot start while this is unresolved.
- Default: no new runtime dependencies; implement local schema-like
  validators and canonical serializer.
- Allow Zod only if `@semantix/stx` already permits the dependency,
  bundle size and ESM/CJS behavior are acceptable, and validation errors
  can preserve stable codes and JSON paths.
- Allow stable stringify only for recursive key ordering, not for
  Unicode, whitespace, timestamp, number, null, or sort semantics.
- The decision must be written into this plan or an ADR before Phase 1.

Exit criteria:

- schema reviewed against downstream planning needs
- no field requires LLM synthesis at build time
- overview abstractions for capability scope, provenance, grounded vs
  bridged labeling, and freshness gates are represented in the handoff
- versioning, replay, amendment lineage, and governance authority rules
  are represented in the handoff
- dependency decision recorded with owner, rationale, and chosen package
  or local implementation
- compiler-profile immutability mechanism recorded, including constants
  location and CI snapshot checks

### Phase 1 - Semantix Builder

Tasks:

- implement `spec-studio-planning-handoff.js`
- implement validators
- implement canonical mappers
- implement fingerprinting
- implement input hashing
- implement pure freshness-gate classification
- export package APIs
- add focused tests
- add JSON fixture packets for greenfield ready, update ready, degraded,
  unresolved blocker, and missing acceptance

Phase 1 should land as a narrow vertical slice before filling in every
policy variant:

- greenfield ready packet -> valid handoff
- update ready packet -> target surfaces and boundaries
- missing acceptance, unresolved blocker, degraded packet -> fail closed
- canonicalization, deterministic `handoffId`, fingerprint, and input
  hashes
- freshness gate classification for `git_commit`, `file_sha256`, and
  `external_timestamp`
- minimum viable governance and sensitivity validation
- verification obligations and core cross-link checks

Remaining evidence kinds, policy-gate variants, amendment lineage cases,
and planner-facing enforcement checks can be added after this vertical
slice is green, without weakening the v1 contract.

Exit criteria:

- all Semantix handoff tests pass
- full `@semantix/stx` suite passes

### Phase 2 - Semantix End-to-End Proof

Tasks:

- extend existing Spec Studio end-to-end proof with lockable packet ->
  handoff scenarios
- add degraded and blocker failure scenarios
- add update boundary proof
- add capability-scope, provenance, soft semantic obligation, and
  freshness-gate proof scenarios

Exit criteria:

- proof covers greenfield, update, negative requirement, and degraded
  flows
- proof exposes grounded, transformed, bridged, and unsupported lineage
  where those labels appear in a packet

### Phase 3 - Host Lock Integration

Tasks:

- call builder after lock preflight
- supply canonical decision audit, override audit, provenance, capability
  scopes, governance, lineage, data policy, sensitivity classifications,
  and freshness gate policy
- persist handoff atomically with locked artifact
- expose handoff lookup by locked artifact ID
- add lock-route tests in the host system

Exit criteria:

- the host cannot lock without a valid persisted handoff
- the host cannot lock when required audit, capability, provenance, or
  freshness inputs are missing
- the host cannot lock when required data policy or sensitivity
  classification inputs are missing
- the host cannot lock or demote blockers with actors that fail the
  handoff governance policy

### Phase 4 - Planner Integration

Tasks:

- load handoff into the downstream planner
- run handoff freshness gate before planning and before execution resume
- classify freshness observations with the v1 per-kind comparison rules
- map requirements to planning items
- map verification obligations to verification steps
- map semantic obligations to review or verifier steps
- enforce capability scopes as planner tool/data permissions
- require a verification plan before execution approval
- enforce `do_not_change` and compatibility boundaries

Exit criteria:

- planning output references handoff requirement IDs
- missing requirement coverage blocks plan approval
- unmapped verification obligations block plan approval
- unmapped semantic obligations block plan approval
- stale freshness result blocks or reapproval-gates planning according to
  the handoff policy
- identical handoff evidence and freshness observations produce identical
  `FreshnessGateResult` state values across host implementations

### Phase 5 - Drift and Amendments

Tasks:

- compare execution output against handoff
- emit drift findings
- require child spec or equivalent amendment flow for material changes
- preserve immutable parent artifacts

Exit criteria:

- drift is auditable
- locked artifacts are never mutated

## Acceptance Criteria

- A vague website prompt can move through:
  initial request -> Semantix batch questions -> batch answers ->
  ready packet -> host lock -> deterministic handoff -> downstream
  planning input.
- The builder is pure and deterministic.
- The builder fails closed on unsafe packets.
- Same locked inputs produce identical handoff JSON and fingerprint.
- Same locked inputs produce the same deterministic `handoffId`, and
  `handoffId` is included in the fingerprint input without being derived
  from the fingerprint.
- Fingerprints are SHA-256 lowercase hex over UTF-8 canonical JSON with
  pinned Unicode, whitespace, timestamp, null, integer, and sort rules.
- Handoffs carry input hashes for packet, locked artifact, audit state,
  and full build input.
- Omitting the default compiler profile and explicitly passing it produce
  identical normalized build inputs and `buildInput` hashes.
- Replay identity is scoped to `contractVersion` plus
  `compilerProfile`; profile-changing mapper or canonicalization changes
  do not rewrite existing handoffs.
- Compiler profile constants and supported packet versions are snapshot
  tested and cannot change under the same profile ID.
- Unsupported packet versions fail closed.
- v1 handoffs remain immutable and readable after later contract versions
  ship.
- Amendment handoffs carry parent/child lineage.
- Pre-lock question strategy may vary; deterministic guarantees start at
  locked packet plus compiler profile.
- Reordered packet arrays do not change the handoff.
- Verification obligations have deterministic cardinality, source refs,
  and related-obligation linkage.
- Typed decision audit state is canonicalized and included in the
  handoff.
- Governance metadata names authorized roles for lock, approval, blocker
  demotion, and policy gates.
- Unauthorized blocker demotion fails closed.
- Cross-link integrity is validated for override, decision, requirement,
  acceptance, boundary, semantic obligation, and verification obligation
  refs.
- Payload size limits, sensitivity classification, and redaction policy
  prevent silent immutable persistence of secrets or unclassified
  sensitive data.
- The host owns final sensitivity classification before lock; Semantix
  does not classify text inside the deterministic builder.
- Requirements, assumptions, risks, and obligations carry grounding
  status and provenance records.
- Capability scopes constrain downstream planning and execution tools.
- Soft semantic constraints survive as semantic obligations and mapped
  review or verifier obligations.
- Negative requirements and update boundaries survive into verification
  obligations.
- Evidence refs include freshness provenance.
- Canonical evidence records come from `auditState.evidence`; packet
  evidence refs are cross-links, not authority for source identity or
  freshness.
- Downstream planning must recheck freshness before plan start or resume,
  then classify observations with the v1 per-kind freshness semantics.
- Skipped blockers cannot lock unless the host records explicit
  override/demotion audit.
- Every verification obligation is mapped before plan approval.
- Downstream planning consumes locked handoff context, not mutable chat
  state.
- Full Semantix tests pass.
- Host lock and planner integration tests pass in the integrating
  system.

## Packet-to-Handoff Mapping Appendix

| Input | Handoff field(s) |
| --- | --- |
| `packet.sessionId`, `packet.iteration`, `packet.contractVersion`, canonical packet hash | `sourcePacket` |
| `packet.originalUserRequest` | `originalUserRequest` |
| host sensitivity assignment for original request | `originalUserRequestSensitivity` |
| `packet.alignedRequirement` | `alignedRequirement` |
| host sensitivity assignment for aligned requirement | `alignedRequirementSensitivity` |
| `packet.mode` | `mode` |
| `packet.requirements` | `requirements`, related `verificationObligations` |
| `packet.acceptanceCriteria` | `acceptanceCriteria`, related `verificationObligations` |
| `packet.negativeRequirements` | `negativeRequirements`, related `verificationObligations` |
| `packet.targetSurfaces` | `targetSurfaces` |
| `packet.boundaries` | `boundaries`, related `verificationObligations` |
| `packet.assumptions` | `assumptions`, related `semanticObligations` |
| `packet.risks` | `risks`, related `semanticObligations` |
| packet evidence refs in grounding/context sources | cross-link checks against `auditState.evidence` |
| `auditState.decisions`, `auditState.overrideDecisions` | `decisionAudit` |
| `auditState.governance` | `governance` |
| `auditState.lineage` | `lineage` |
| `auditState.dataPolicy` | `dataPolicy` |
| `auditState.capabilityScopes` | `capabilityScopes` |
| `auditState.evidence` | `evidence` |
| `auditState.provenanceRecords` | `provenanceRecords` |
| `auditState.freshnessGate` | `freshnessGate` |
| `lockedArtifact.id` | `lockedArtifactId`, `lineage` |
| `lockedArtifact.lockedAt`, lock actor, lock authority | `governance`, `decisionAudit` |
| canonical hashes of packet, locked artifact, audit state, build input | `inputHashes` |
| canonical handoff JSON excluding `fingerprint` | `fingerprint` |

## Error Code Taxonomy Appendix

Validation errors must use stable code families. Codes are contract
values and must not embed free-form prose.

| Family | Example codes |
| --- | --- |
| Schema | `E_SCHEMA_UNKNOWN_FIELD`, `E_SCHEMA_MISSING_REQUIRED`, `E_SCHEMA_INVALID_ENUM` |
| Version/profile | `E_VERSION_UNSUPPORTED_PACKET`, `E_PROFILE_UNSUPPORTED`, `E_PROFILE_MISMATCH` |
| Hash | `E_HASH_PACKET_MISMATCH`, `E_HASH_BUILD_INPUT_MISMATCH`, `E_HASH_FINGERPRINT_MISMATCH` |
| Governance | `E_GOVERNANCE_UNAUTHORIZED_LOCK`, `E_GOVERNANCE_UNAUTHORIZED_DEMOTION`, `E_GOVERNANCE_MISSING_APPROVAL` |
| Data policy | `E_DATA_UNCLASSIFIED_TEXT`, `E_DATA_SECRET_UNREDACTED`, `E_DATA_SENSITIVE_PERSISTENCE_UNAUTHORIZED` |
| Freshness | `E_FRESHNESS_MISSING_PROVENANCE`, `E_FRESHNESS_OBSERVATION_INVALID`, `E_FRESHNESS_POLICY_MISSING` |
| Links | `E_LINK_UNRESOLVED_REF`, `E_LINK_DUPLICATE_ID`, `E_LINK_NON_RECIPROCAL` |
| Canonicalization | `E_CANONICAL_INVALID_TIMESTAMP`, `E_CANONICAL_FORBIDDEN_NULL`, `E_CANONICAL_INVALID_NUMBER` |

## Canonical JSON Examples Appendix

Examples are illustrative only. Fixtures own exact bytes and hashes.

Unicode, CRLF, and prose whitespace:

```json
{"text":"Cafe\u0301\r\nships   fast"}
```

canonicalizes to:

```json
{"text":"Caf\u00e9\nships fast"}
```

Object key ordering:

```json
{"z":1,"a":2}
```

canonicalizes to:

```json
{"a":2,"z":1}
```

String-array sorting:

```json
{"evidenceRefs":["evidence:ev_2","evidence:ev_1","evidence:ev_1"]}
```

canonicalizes to:

```json
{"evidenceRefs":["evidence:ev_1","evidence:ev_2"]}
```

Decision audit sorting:

```json
{"decisionAudit":[{"sequence":2,"id":"decision:d2"},{"sequence":1,"id":"decision:d1"}]}
```

canonicalizes to:

```json
{"decisionAudit":[{"id":"decision:d1","sequence":1},{"id":"decision:d2","sequence":2}]}
```

Fingerprint exclusion:

```json
{"fingerprint":"old","handoffId":"handoff:1111111111111111111111111111111111111111111111111111111111111111"}
```

hash input:

```json
{"handoffId":"handoff:1111111111111111111111111111111111111111111111111111111111111111"}
```

## Minimal Fixture Guidance Appendix

Fixtures should be small canonical JSON files, not large inline blobs in
tests or docs.

| Fixture | Required shape |
| --- | --- |
| `greenfield-minimal.packet.json` | new-mode packet with one requirement, one acceptance criterion, one assumption, one evidence ref |
| `greenfield-minimal.locked-artifact.json` | matching locked artifact with lock actor, lock timestamp, artifact ID, packet hash |
| `greenfield-minimal.audit-state.json` | one decision, governance, data policy, capability scope, freshness gate |
| `greenfield-minimal.handoff.json` | canonical expected handoff with stable fingerprint |
| `update-minimal.packet.json` | update-mode packet with target surface, boundary, requirement, acceptance criterion, evidence ref |
| `update-minimal.locked-artifact.json` | matching update locked artifact with lock metadata and packet hash |
| `update-minimal.audit-state.json` | update decision audit, governance, data policy, capability scope, freshness gate |
| `update-minimal.handoff.json` | canonical expected update handoff with stable fingerprint |
| `invalid-*.json` | one validation failure per file; expected error code asserted by test |

## Freshness Reason Codes Appendix

`FreshnessGateResult.evidenceResults[].reason` must use this stable enum
in v1.
Host UI may add display text outside the contract.

| Reason | Meaning |
| --- | --- |
| `exact_match` | observed freshness value exactly matches locked evidence |
| `different_resolvable_value` | observed value is comparable and different from locked evidence |
| `source_identity_unverified` | source identity cannot be proven to match locked evidence |
| `locked_evidence_missing` | locked evidence ref cannot be found or inspected |
| `kind_mismatch` | observed evidence kind differs from locked evidence kind |
| `observation_missing` | no observation was supplied for a freshness-bound evidence ref |
| `unparsable_timestamp` | locked or observed timestamp cannot be parsed as canonical timestamp |

## Core Interface Appendix

These interfaces are intentionally small. They define the minimum shape
developers must not invent independently during implementation.

```ts
type CompilerProfile = {
  id: "semantix.planning-handoff.v1.profile.1";
  contractVersion: "semantix.planning-handoff.v1";
  mapperVersion: "semantix.planning-handoff.mapper.v1";
  validatorVersion: "semantix.planning-handoff.validator.v1";
  canonicalizationVersion: "semantix.canonical-json.v1";
};

type HandoffInputHash = {
  algorithm: "sha256";
  canonicalizationVersion: "semantix.canonical-json.v1";
  value: string;
};

type HandoffInputHashes = {
  packet: HandoffInputHash;
  lockedArtifact: HandoffInputHash;
  auditState: HandoffInputHash;
  buildInput: HandoffInputHash;
};

type LockedIntentArtifact = {
  id: string;
  sessionId: string;
  lockedAt: string;
  lockedByActorRef: string;
  lockDecisionRef: string;
  packetRef: string;
  packetContentHash: string;
  artifactContentHash?: string;
  lineageRef?: string;
};

type HandoffBuildInput = {
  packet: SemantixAlignmentPacket;
  lockedArtifact: LockedIntentArtifact;
  auditState: HandoffAuditState;
  compilerProfileId?: "semantix.planning-handoff.v1.profile.1";
};

type HandoffAuditState = {
  decisions: DecisionRecord[];
  overrideDecisions: OverrideDecision[];
  governance: HandoffGovernance;
  lineage: HandoffLineage;
  dataPolicy: HandoffDataPolicy;
  capabilityScopes: CapabilityScope[];
  provenanceRecords: ProvenanceRecord[];
  evidence: EvidenceRef[];
  freshnessGate: ResumeFreshnessGate;
  sensitivityClassifications: SensitivityAssignment[];
  lockMetadata: HandoffLockMetadata;
  coverage?: HandoffCoverageSnapshot;
};

type HandoffLockMetadata = {
  lockedArtifactId: string;
  lockedAt: string;
  lockedByActorRef: string;
  lockDecisionRef: string;
  sourcePacket: {
    sessionId: string;
    iteration: number;
    contractVersion: "semantix.phalanx.spec-studio.v1";
  };
};

type SensitivityAssignment = {
  fieldRef: string;
  sensitivity: SensitivityTag;
  source: "host" | "user" | "semantix" | "policy_gate" | "classifier";
  decisionRefs: string[];
  evidenceRefs: string[];
};

type HandoffCoverageSnapshot = {
  id: string;
  checkedAt: string;
  lockable: boolean;
  mustRequirementRefs: string[];
  acceptedRequirementRefs: string[];
  blockerFindingRefs: string[];
  openNonBlockingFindingRefs: string[];
  decisionRefs: string[];
};

type HandoffLineage = {
  parentHandoffId?: string;
  parentLockedArtifactId?: string;
  amendmentDecisionRef?: string;
  relationship: "root" | "amendment" | "migration" | "relock";
  supersedesHandoffRefs: string[];
  reason?: string;
  reasonSensitivity?: SensitivityTag;
};

type ActorRoleBinding = {
  actorRef: string;
  roleRefs: string[];
};

type AuthorityPolicy = {
  lockRoleRefs: string[];
  approvalRoleRefs: string[];
  blockerDemotionRoleRefs: string[];
  policyGateRoleRefs: string[];
  requireSeparateApprover: false;
  quorum: "single_actor";
};

type HandoffGovernance = {
  model: "single_approver_v1";
  actorRoles: ActorRoleBinding[];
  authority: AuthorityPolicy;
  lockDecisionRef: string;
  approvalDecisionRefs: string[];
};

type SensitivityClass = "public" | "internal" | "confidential" | "pii" | "regulated" | "secret" | "unknown";

type RedactionRef = {
  id: string;
  fieldRef: string;
  reason: "secret" | "pii" | "regulated" | "confidential" | "user_request" | "policy";
  replacement: string;
  replacementSensitivity: SensitivityTag;
  evidenceRef?: string;
};

type SensitivityTag = {
  classification: SensitivityClass;
  redactionRefs: string[];
  policyDecisionRefs: string[];
};

type HandoffDataPolicy = {
  classification: SensitivityClass;
  allowSensitivePersistence: boolean;
  sensitiveFieldRefs: string[];
  redactions: RedactionRef[];
  policyDecisionRefs: string[];
  maxCanonicalBytes: 1048576;
};

type GroundingStatus = "grounded" | "transformed" | "bridged" | "unsupported";
type ConfidenceBand = "high" | "medium" | "low";

type GroundingLineage = {
  status: GroundingStatus;
  confidence: ConfidenceBand;
  sourceFactRefs: string[];
  evidenceRefs: string[];
  decisionRefs: string[];
  assumptionRefs: string[];
  provenanceRefs: string[];
};

type RequirementFact = {
  id: string;
  text: string;
  sensitivity: SensitivityTag;
  type: "functional" | "nonfunctional" | "negative" | "constraint" | "acceptance" | "integration";
  priority: "must" | "should" | "could";
  status: "confirmed" | "contested";
  sourceRef: string;
  acceptanceCriteriaRefs: string[];
  evidenceRefs: string[];
  grounding: GroundingLineage;
};

type AcceptanceCriterion = {
  id: string;
  requirementRef: string;
  text: string;
  sensitivity: SensitivityTag;
  sourceRef: string;
  evidenceRefs: string[];
  grounding: GroundingLineage;
};

type NegativeRequirement = {
  id: string;
  text: string;
  sensitivity: SensitivityTag;
  sourceRef: string;
  grounding: GroundingLineage;
  verificationObligationRef: string;
};

type TargetSurface = {
  id: string;
  kind: string;
  name: string;
  sensitivity: SensitivityTag;
  sourceRef: string;
  evidenceRefs: string[];
  grounding: GroundingLineage;
};

type PlanningBoundary = {
  id: string;
  kind: "do_not_change" | "reuse" | "compatibility" | "scope_out" | "migration";
  text: string;
  sensitivity: SensitivityTag;
  sourceRef: string;
  grounding: GroundingLineage;
  verificationObligationRef?: string;
};

type PlanningAssumption = {
  id: string;
  text: string;
  sensitivity: SensitivityTag;
  sourceRef: string;
  grounding: GroundingLineage;
  demotedFromFindingRef?: string;
  overrideDecisionRef?: string;
};

type PlanningRisk = {
  id: string;
  text: string;
  sensitivity: SensitivityTag;
  sourceRef: string;
  severity: "blocker_demoted" | "concern" | "fyi";
  grounding: GroundingLineage;
  overrideDecisionRef?: string;
};

type EvidenceRef = {
  id: string;
  source: "user" | "html" | "spec" | "host" | "evidence_system" | "repo" | "trace" | "upload";
  ref: string;
  summary: string;
  sensitivity: SensitivityTag;
  capturedAt: string;
  freshness: {
    kind: "git_commit" | "file_sha256" | "trace_snapshot" | "upload_sha256" | "evidence_snapshot" | "external_timestamp";
    value: string;
  };
};

type ProvenanceRecord = {
  id: string;
  subjectRef: string;
  subjectPath: string;
  relation: "copied_from" | "derived_from" | "transformed_from" | "bridged_from" | "user_confirmed" | "host_locked" | "override_demoted";
  strength: "deterministic" | "direct" | "inferred" | "bridged" | "unsupported";
  sourceRefs: string[];
  sourceFactRefs: string[];
  evidenceRefs: string[];
  decisionRefs: string[];
  summary: string;
  sensitivity: SensitivityTag;
};

type CapabilityGrant = {
  id: string;
  kind: "repo" | "filesystem" | "network" | "browser" | "test_runner" | "evidence_system" | "host_api" | "manual_review" | "other";
  ref: string;
  mode: "read" | "write" | "execute" | "approve";
};

type CapabilityScope = {
  id: string;
  appliesTo: "planning" | "execution" | "verification" | "all";
  allowed: CapabilityGrant[];
  forbidden: CapabilityGrant[];
  dataScopes: string[];
  sourceRef: string;
  decisionRefs: string[];
};

type SemanticObligation = {
  id: string;
  kind: "tone" | "safety_caveat" | "semantic_fidelity" | "accessibility" | "policy" | "domain_semantics" | "other";
  text: string;
  sensitivity: SensitivityTag;
  priority: "must" | "should" | "could";
  sourceRef: string;
  grounding: GroundingLineage;
  requiredReview: true;
  verificationObligationRef: string;
};

type VerificationObligation = {
  id: string;
  kind: "requirement" | "acceptance" | "negative" | "do_not_change" | "compatibility" | "reuse" | "semantic";
  sourceRef: string;
  sourceRefs: string[];
  requirementRef?: string;
  acceptanceCriterionRef?: string;
  negativeRequirementRef?: string;
  boundaryRef?: string;
  semanticObligationRef?: string;
  relatedObligationRefs: string[];
  text: string;
  sensitivity: SensitivityTag;
  priority: "must" | "should" | "could";
  requiredMapping: true;
};

type FeatureChecklistSeed = {
  id: string;
  text: string;
  sensitivity: SensitivityTag;
  sourceRef: string;
  requirementRefs: string[];
  verificationObligationRefs: string[];
  grounding: GroundingLineage;
};

type PlanningConcern = {
  id: string;
  sourceFindingRef: string;
  text: string;
  sensitivity: SensitivityTag;
  sourceRef: string;
  grounding: GroundingLineage;
};

type DecisionRecord = {
  id: string;
  sequence: number;
  kind: "user_answer" | "user_skip" | "user_reconsider" | "decide_all" | "batch_answer" | "host_lock" | "override_demotion" | "policy_gate" | "freshness_gate";
  actorRef: string;
  actorRoleRefs: string[];
  at: string;
  targetRefs: string[];
  sourceTurnRef?: string;
  valueSummary: string;
  sensitivity: SensitivityTag;
  rationale?: string;
  rationaleSensitivity?: SensitivityTag;
  supersedesDecisionRefs: string[];
};

type OverrideDecision = {
  id: string;
  decisionRef: string;
  findingRef: string;
  action: "demote_to_assumption" | "demote_to_risk";
  authorizedRoleRef: string;
  policyGateDecisionRef?: string;
  rationale: string;
  rationaleSensitivity: SensitivityTag;
  actorRef: string;
  at: string;
};

type ResumeFreshnessGate = {
  id: string;
  requiredBeforePlanning: true;
  requiredBeforeExecutionResume: true;
  evidenceRefs: string[];
  onCleanResume: "continue";
  onSoftStale: "regenerate_from_safe_checkpoint" | "require_reapproval";
  onHardStale: "require_relock_or_amendment";
};

type FreshnessGateState = "clean_resume" | "soft_stale" | "hard_stale";
type FreshnessReasonCode =
  | "exact_match"
  | "different_resolvable_value"
  | "source_identity_unverified"
  | "locked_evidence_missing"
  | "kind_mismatch"
  | "observation_missing"
  | "unparsable_timestamp";

type FreshnessGateResult = {
  handoffId: string;
  checkedAt: string;
  state: FreshnessGateState;
  evidenceResults: Array<{
    evidenceRef: string;
    state: FreshnessGateState;
    reason: FreshnessReasonCode;
    observedFreshness?: {
      kind: EvidenceRef["freshness"]["kind"];
      value: string;
    };
  }>;
};

type FreshnessObservationSet = {
  handoffId: string;
  checkedAt: string;
  observations: FreshnessObservation[];
};

type FreshnessObservation = {
  evidenceRef: string;
  observedFreshness?: {
    kind: EvidenceRef["freshness"]["kind"];
    value: string;
  };
  sourceIdentity:
    | "verified"
    | "unverified"
    | "changed";
  lockedEvidence:
    | "resolvable"
    | "missing"
    | "evicted"
    | "unreadable"
    | "unknown";
};
```

Interface rules:

- `RequirementFact.text` is allowed to be prose, but only as a typed,
  ID-tagged fact.
- All handoff `id` fields and local `*Ref`/`*Refs` values use the
  namespace rules in the Reference and Field Path Rules section.
- `CompilerProfile` is part of replay identity. Its constants are frozen
  for a profile and must not be populated from live package version,
  deploy version, git branch, or build timestamp.
- `HandoffBuildInput` is the only public builder input envelope. Hosts
  may keep richer private state, but the builder accepts only this typed
  shape and rejects unknown fields.
- `HandoffInputHash.value` uses `sha256:<64 lowercase hex characters>`
  over canonical JSON bytes. `sourcePacket.contentHash` must equal
  `inputHashes.packet.value`.
- `LockedIntentArtifact` is the minimum builder-visible locked artifact
  shape. Hosts may store richer artifacts, but unknown fields do not cross
  the public build input. `lockedArtifact.packetContentHash` must equal
  `inputHashes.packet.value`.
- `HandoffAuditState` is canonicalized and hashed as one input. Reordered
  arrays inside it may not change the hash after mapper-defined sorting,
  but changed decisions, governance, lineage, data policy, capability
  scopes, provenance, evidence, freshness gate, sensitivity assignments,
  lock metadata, or coverage must change the hash.
- `HandoffLineage.relationship: "root"` must not set parent refs.
  `amendment`, `migration`, and `relock` must set `parentHandoffId`,
  `parentLockedArtifactId`, `amendmentDecisionRef`, and `reason`.
- A child handoff may supersede a parent for future planning, but it does
  not mutate or invalidate the parent as historical audit evidence.
- `HandoffLineage.supersedesHandoffRefs` is whole-handoff supersession in
  v1. Partial requirement-level supersession requires a new profile.
- `HandoffGovernance.model: "single_approver_v1"` means no quorum and no
  mandatory separation of duties in v1. Required role refs are still
  enforced.
- In `single_approver_v1`, the lock decision may also be the approval
  decision. `approvalDecisionRefs` may be empty only when the
  `lockDecisionRef` actor has an approval-authorized role.
- `HandoffDataPolicy.maxCanonicalBytes` is fixed at 1 MiB for v1. A
  larger limit requires a new compiler profile.
- Text-bearing fields with `sensitivity.classification: "secret"` must be
  redacted before handoff build. The persisted field value must contain
  the redacted replacement, not the secret.
- `unknown` sensitivity requires a policy-gate `DecisionRecord` cited by
  both the field `SensitivityTag.policyDecisionRefs` and
  `HandoffDataPolicy.policyDecisionRefs`, and the field must be allowed
  by `HandoffDataPolicy.allowSensitivePersistence` and
  `sensitiveFieldRefs`.
- `RedactionRef.fieldRef` points to the Stable Field Pointer v1 path of
  the redacted field.
- `DecisionRecord.actorRoleRefs` must include the role used for the
  decision. The actor must also appear in `HandoffGovernance.actorRoles`.
- `OverrideDecision.authorizedRoleRef` must be present in the actor's role
  bindings and in `blockerDemotionRoleRefs`.
- `policyGateDecisionRef` is required when the demoted finding is
  policy/security/safety classified or originated from a policy gate.
- Locked handoffs must not contain `status: "proposed"` requirements.
- Every text-bearing field must carry `SensitivityTag` directly or through
  an adjacent `*Sensitivity` field.
- Optional text fields such as `DecisionRecord.rationale` and
  `HandoffLineage.reason` require their adjacent `*Sensitivity` field
  whenever the text field is present.
- Every requirement, acceptance criterion, target surface, boundary,
  assumption, risk, semantic obligation, feature checklist seed, and
  planning concern must carry `GroundingLineage`.
- `grounding.status` must not be collapsed into `status`. `status`
  records user/spec confirmation state; `grounding.status` records
  epistemic lineage.
- `bridged` or `unsupported` must-level requirements require an explicit
  confirming `DecisionRecord` or `OverrideDecision`.
- `CapabilityScope` is mandatory even when the intended scope is
  restrictive; use an explicit empty `allowed` list plus `forbidden`
  entries rather than omitting it.
- `DecisionRecord.sequence` is a host-owned non-negative integer. Decision
  audit arrays sort by globally unique `sequence`; duplicate `sequence`
  or duplicate `id` fails validation.
- Decision, override, evidence, and lock timestamps must use canonical
  UTC RFC 3339 millisecond precision.
- `EvidenceRef.freshness` is required for every `EvidenceRef` in v1.
  `ResumeFreshnessGate.evidenceRefs` must include every evidence ref that
  can become stale after lock.
- `ResumeFreshnessGate` is emitted on every handoff; `evidenceRefs` may
  be empty only when no evidence source can become stale after lock.
- Planner start and execution resume must produce an auditable
  `FreshnessGateResult` before any plan or dispatch approval.
- `FreshnessObservationSet` is the typed input to freshness
  classification. Observation collection may use host tools, but
  classification from observations to `FreshnessGateResult` must be pure
  and follow the v1 per-kind semantics.
- A demoted blocker must appear in `PlanningAssumption` or
  `PlanningRisk` with `overrideDecisionRef`.
- Every `VerificationObligation` must be mapped by the host planner
  before plan approval.
- `VerificationObligation.sourceRef` is the primary source identity;
  `sourceRefs` carries all linked source identities. A singular
  `sourceRef` must never be interpreted as the only source when
  `sourceRefs` contains additional links.
- Every `SemanticObligation` must have a corresponding
  `VerificationObligation` with `kind: "semantic"`.
- Every cross-link field ending in `Ref` or `Refs` must resolve within
  the handoff or to an explicit external source namespace documented by
  the field. Required reciprocal links must be validated, including
  override decision to decision audit, semantic obligation to semantic
  verification obligation, requirement to acceptance criteria, and
  source fact to verification obligation linkages.

## Verification Commands

Semantix:

```
node --test packages/stx/tests/spec-studio-planning-handoff.test.js
npm run test --workspace @semantix/stx
```

Host system:

```
# Exact commands live in the integrating host repository.
# Required coverage:
# - spec lock route
# - handoff persistence
# - downstream planner handoff loading
# - freshness gate clean/soft/hard stale handling
# - capability-scope enforcement
# - semantic obligation mapping
# - drift detection against locked handoff
```

## Non-Goals

- Replacing downstream planning.
- Generating implementation tasks inside Semantix.
- Using an LLM inside the handoff builder.
- Letting Semantix mint host-owned canonical decision IDs.
- Treating evidence-system facts as desired behavior authority.
- Allowing lock from degraded packets.
- Allowing downstream planning to start from mutable Spec Studio chat
  state.
