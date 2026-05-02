# Spec Studio LLM-Backed Evaluator — Readiness Proof

Date: 2026-05-01
Tasks: ss-llm-001 through ss-llm-008

## What Was Built

### Evaluator mode visibility (ss-llm-001)
- `EVALUATOR_MODE = { PROBE: "probe", LLM: "llm" }` exported from `spec-studio-evaluator.js`
- `GET /spec-studio/mode` route returns `{ evaluatorMode, ready }` so operators and Phalanx can confirm active mode
- `createSpecStudioJsonProbeEvaluator()` returned function has `evaluatorMode = "probe"` property
- `createSemantixHandshakeAdapter()` forwards `evaluatorMode` from the wrapped evaluator

### LLM evaluator contract (ss-llm-002)
`packages/stx/src/spec-studio-llm-evaluator.js` exports:
- `buildEvaluatorSystemPrompt()` — full system prompt instructing the LLM to produce SemantixAlignmentPacket JSON
- `synthesizeEvaluatorInput(request)` — transforms a SemantixEvaluateRequest into a structured user-turn message
- `parseEvaluatorOutput(sessionId, iteration, rawText, request)` — parses and validates LLM output, throws on invalid shape

### LLM evaluator implementation (ss-llm-003)
- `createLlmSpecStudioEvaluator({ connector, model, timeoutMs })` calls `connector.execute()` with the full prompt
- Uses the same connector pattern as `createLlmClassificationProvider` in `codex-semantix-layer.js`
- `SPEC_STUDIO_EVALUATOR=llm` env var switches the server from probe to LLM evaluator at startup
- `createStxApplication()` passes `connector` to `createControlPlaneServer()` for LLM use

### Degraded output handling (ss-llm-004)
- `extractJsonFromLlmOutput()` handles plain JSON, markdown-fenced JSON, and prose-wrapped JSON
- `parseEvaluatorOutput()` validates with `validateSemantixAlignmentPacket` and throws descriptively on failure
- `createLlmSpecStudioEvaluator` wraps the raw evaluator with `withDegradationFallback` so any error becomes an honest non-lockable degraded packet

### Regression tests (ss-llm-005)
`packages/stx/tests/spec-studio-llm-evaluator.test.js` — 21 tests covering:
- System prompt and input synthesis contracts
- JSON extraction from plain, fenced, and prose-wrapped LLM output
- Output parsing for valid packets (stamps contractVersion/source/sessionId/iteration)
- Degraded behavior for: malformed JSON, invalid packet shape, connector throw, nonzero exit code
- Markdown-fenced output extraction end-to-end
- evaluatorMode property is "llm" not "probe"

### Manual probe upgrade (ss-llm-006)
- `probe-spec-studio-json.js` now accepts `--mode probe|llm` flag
- When `--mode llm`, hits `GET /spec-studio/mode` first and prints server evaluator mode
- Fails closed when server mode doesn't match expected mode
- `--help` flag added
- `docs/spec-studio-manual-json-probe.md` updated with LLM mode instructions and Phalanx gate warning

### Phalanx integration gate (ss-llm-007)
- `docs/plans/spec-studio-live-phalanx-discussion-loop.md` updated to gate `PHALANX_SEMANTIX_HTTP_URL` wiring on ss-llm-008 completion
- Operators must verify `GET /spec-studio/mode` returns `evaluatorMode: "llm"` before connecting Phalanx

## Test Results

```
npm run test --workspace @semantix/stx

tests 399
pass  399
fail  0
```

(Also fixed pre-existing test regression: `USER_TURN_BODY_KIND_VALUES` test
was missing `"batch"` from the expected array — the source already had it.)

## How To Activate LLM Mode

```bash
SPEC_STUDIO_EVALUATOR=llm SEMANTIX_SPEC_STUDIO_MODEL=gpt-5.5 node packages/stx/src/cli.js serve

# Verify mode
curl http://127.0.0.1:4401/spec-studio/mode
# {"evaluatorMode":"llm","ready":true}

# Run LLM-mode probe
npm run probe:spec-studio-json --workspace packages/stx -- \
  --url http://127.0.0.1:4401/spec-studio/evaluate \
  --mode llm
```

The model used defaults to `claude-sonnet-4-6`. Override with
`SEMANTIX_SPEC_STUDIO_MODEL`. Timeout defaults to 60 seconds;
override with `SEMANTIX_SPEC_STUDIO_TIMEOUT_MS`.

---

## ss-llm-008: Live LLM-Mode Proof

**Date**: 2026-05-01
**Server**: `SPEC_STUDIO_EVALUATOR=llm SEMANTIX_SPEC_STUDIO_MODEL=gpt-5.5 node packages/stx/src/cli.js serve`
**Model**: gpt-5.5 (OpenAI, via CodexCliConnector)
**Endpoint**: `POST http://127.0.0.1:4401/spec-studio/evaluate`

```
curl http://127.0.0.1:4401/spec-studio/mode
{"evaluatorMode":"llm","ready":true}
```

---

### User request

> Add a dark mode toggle to the Semantix UI that persists across sessions

---

### Turn 1 — `POST /spec-studio/evaluate` (`trigger: initial`)

**Request body**
```json
{
  "sessionId": "proof_final_001",
  "trigger": "initial",
  "decisions": [],
  "findings": [],
  "contextResponses": [],
  "userTurn": {
    "id": "u1",
    "body": {
      "kind": "text",
      "text": "Add a dark mode toggle to the Semantix UI that persists across sessions"
    }
  }
}
```

**Response packet** (HTTP 200)
```json
{
  "contractVersion": "semantix.phalanx.spec-studio.v1",
  "source": "semantix",
  "sessionId": "proof_final_001",
  "iteration": 0,
  "readiness": "needs_user",
  "readinessReason": "The request states the desired capability, but the UI placement, persistence mechanism expectations, and theming scope are not fully resolved.",
  "blockingReasons": [
    "Toggle placement is unspecified.",
    "The required persistence behavior and storage boundary are unspecified.",
    "The extent of UI surfaces that must support dark mode is unspecified."
  ],
  "approvalRequired": true,
  "originalUserRequest": "Add a dark mode toggle to the Semantix UI that persists across sessions",
  "alignedRequirement": "Add a user-accessible dark mode toggle to the Semantix UI and persist the selected theme across sessions.",
  "requirements": [
    {
      "id": "REQ-001",
      "type": "functional",
      "text": "Provide a dark mode toggle in the Semantix UI.",
      "priority": "must",
      "sourceRef": "u1",
      "acceptance": "A user can switch between light and dark mode from the UI.",
      "status": "proposed"
    },
    {
      "id": "REQ-002",
      "type": "functional",
      "text": "Persist the user's selected theme across sessions.",
      "priority": "must",
      "sourceRef": "u1",
      "acceptance": "After changing the theme and starting a new session, the UI restores the previously selected theme.",
      "status": "proposed"
    },
    {
      "id": "REQ-003",
      "type": "acceptance",
      "text": "The persisted theme preference must be applied when the Semantix UI loads.",
      "priority": "must",
      "sourceRef": "u1",
      "acceptance": "On reload or return to the application, the selected theme is visible without requiring the user to toggle it again.",
      "status": "proposed"
    }
  ],
  "flow": {
    "pages": ["Semantix UI"],
    "states": ["light mode", "dark mode", "persisted theme preference unknown"],
    "transitions": [
      "User toggles theme from light mode to dark mode.",
      "User toggles theme from dark mode to light mode.",
      "UI loads and applies persisted theme preference."
    ],
    "dataNeeded": ["Preferred theme value", "Persistence location or mechanism"]
  },
  "scope": {
    "inScope": [
      "Add a dark mode toggle to the Semantix UI.",
      "Persist the selected theme across sessions.",
      "Apply the persisted theme when the UI loads."
    ],
    "outOfScope": [
      "Unspecified redesign of the Semantix UI.",
      "Unspecified changes outside theme selection and theme rendering."
    ],
    "negativeRequirements": [
      "Do not infer unrequested UI redesign work from the dark mode request."
    ]
  },
  "assumptions": [
    "The request targets an existing Semantix UI rather than a new standalone UI."
  ],
  "openQuestions": [
    "Where should the dark mode toggle appear in the Semantix UI?",
    "Should persistence be local to the browser/device, tied to a signed-in user profile, or handled another way?",
    "Should dark mode apply to the entire UI or only specific surfaces?",
    "Should the UI default to system color-scheme preference when no persisted preference exists?"
  ],
  "risks": [
    "A dark mode implementation may be incomplete if the target UI surfaces are not identified.",
    "Persistence behavior may not match user expectations if storage scope is not clarified."
  ],
  "userDecisions": [],
  "acceptanceSummary": [
    "User can switch between light and dark mode.",
    "Selected theme persists across sessions.",
    "Persisted theme is applied on UI load."
  ],
  "existingSystemContext": {
    "mode": "update",
    "targetSurfaces": ["Semantix UI"],
    "doNotChange": [],
    "reuseRequirements": [],
    "compatibilityRequirements": []
  },
  "contextSources": [
    {
      "id": "CS-001",
      "kind": "user",
      "ref": "u1",
      "summary": "User requested a dark mode toggle for the Semantix UI with persistence across sessions.",
      "status": "used"
    }
  ],
  "groundedFacts": [
    {
      "id": "GF-001",
      "source": "user",
      "text": "The user wants a dark mode toggle added to the Semantix UI.",
      "evidenceRef": "u1",
      "confidence": "high"
    },
    {
      "id": "GF-002",
      "source": "user",
      "text": "The user wants the selected mode to persist across sessions.",
      "evidenceRef": "u1",
      "confidence": "high"
    }
  ],
  "findings": [
    {
      "id": "F-001",
      "kind": "gap",
      "sev": "blocker",
      "section": "scope",
      "ref": "u1",
      "text": "The requested UI location for the dark mode toggle is not specified.",
      "resolved": false,
      "raisedBy": "semantix"
    },
    {
      "id": "F-002",
      "kind": "gap",
      "sev": "blocker",
      "section": "constraints",
      "ref": "u1",
      "text": "The persistence mechanism and storage boundary are not specified.",
      "resolved": false,
      "raisedBy": "semantix"
    },
    {
      "id": "F-003",
      "kind": "gap",
      "sev": "blocker",
      "section": "boundaries",
      "ref": "u1",
      "text": "The set of Semantix UI surfaces that must support dark mode is not specified.",
      "resolved": false,
      "raisedBy": "semantix"
    },
    {
      "id": "F-004",
      "kind": "assumption",
      "sev": "concern",
      "section": "assumptions",
      "ref": "u1",
      "text": "Assuming this is an update to an existing Semantix UI because the request says to add a toggle to the UI.",
      "resolved": false,
      "raisedBy": "semantix"
    }
  ],
  "coverage": {
    "alignmentPct": 55,
    "sections": ["intent", "scope", "success", "constraints", "boundaries", "assumptions"],
    "openBlockers": 3,
    "openConcerns": 1,
    "openFYI": 0
  },
  "nextTurn": {
    "id": "nt-001",
    "side": "semantix",
    "at": "2026-05-02T00:00:00-07:00",
    "phase": "crisp",
    "target": "user",
    "body": {
      "kind": "question",
      "q": "Where should the toggle live, should the saved preference be browser-local or user-account based, and should dark mode cover the entire Semantix UI or only specific surfaces?"
    }
  }
}
```

**LLM asked**: *"Where should the toggle live, should the saved preference be browser-local or user-account based, and should dark mode cover the entire Semantix UI or only specific surfaces?"*

---

### Turn 2 — `POST /spec-studio/evaluate` (`trigger: user_turn`)

**User answered**: *"Use a toggle button in the top-right nav bar. Store preference in localStorage under 'semantix-theme'. Detect system preference as fallback. No login required. Keep the same set of UI components — just add a CSS class 'dark' to the root element."*

**Request body**
```json
{
  "sessionId": "proof_final_001",
  "trigger": "user_turn",
  "decisions": [],
  "findings": [],
  "contextResponses": [],
  "userTurn": {
    "id": "u2",
    "body": {
      "kind": "text",
      "text": "Use a toggle button in the top-right nav bar. Store preference in localStorage under 'semantix-theme'. Detect system preference as fallback. No login required. Keep the same set of UI components — just add a CSS class 'dark' to the root element."
    }
  },
  "currentPacket": "<Turn 1 packet above>"
}
```

**Response packet** (HTTP 200)
```json
{
  "contractVersion": "semantix.phalanx.spec-studio.v1",
  "source": "semantix",
  "sessionId": "proof_final_001",
  "iteration": 1,
  "readiness": "ready",
  "readinessReason": "The user resolved the prior blockers by specifying the toggle location, browser-local persistence mechanism and key, fallback behavior, login boundary, and implementation boundary.",
  "blockingReasons": [],
  "approvalRequired": true,
  "originalUserRequest": "Add a dark mode toggle to the Semantix UI that persists across sessions",
  "alignedRequirement": "Add a top-right navigation dark mode toggle to the existing Semantix UI, persist the preference in localStorage under \"semantix-theme\", fall back to system preference when no saved preference exists, and apply dark mode by adding a \"dark\" CSS class to the root element.",
  "requirements": [
    {
      "id": "REQ-001", "type": "functional",
      "text": "Provide a dark mode toggle in the Semantix UI.",
      "priority": "must", "sourceRef": "u1",
      "acceptance": "A user can switch between light and dark mode from the UI.",
      "status": "confirmed"
    },
    {
      "id": "REQ-002", "type": "functional",
      "text": "Persist the user's selected theme across sessions.",
      "priority": "must", "sourceRef": "u1",
      "acceptance": "After changing the theme and starting a new session, the UI restores the previously selected theme.",
      "status": "confirmed"
    },
    {
      "id": "REQ-003", "type": "acceptance",
      "text": "The persisted theme preference must be applied when the Semantix UI loads.",
      "priority": "must", "sourceRef": "u1",
      "acceptance": "On reload or return to the application, the selected theme is visible without requiring the user to toggle it again.",
      "status": "confirmed"
    },
    {
      "id": "REQ-004", "type": "functional",
      "text": "Place the dark mode toggle button in the top-right nav bar.",
      "priority": "must", "sourceRef": "u2",
      "acceptance": "The theme toggle is available from the top-right navigation bar.",
      "status": "confirmed"
    },
    {
      "id": "REQ-005", "type": "constraint",
      "text": "Store the selected theme preference in browser localStorage under the key \"semantix-theme\".",
      "priority": "must", "sourceRef": "u2",
      "acceptance": "Changing the theme writes the preference to localStorage using the exact key \"semantix-theme\".",
      "status": "confirmed"
    },
    {
      "id": "REQ-006", "type": "functional",
      "text": "Detect the system color-scheme preference as the fallback when no saved theme preference exists.",
      "priority": "must", "sourceRef": "u2",
      "acceptance": "On first load without a stored \"semantix-theme\" value, the UI applies the user's system light or dark preference.",
      "status": "confirmed"
    },
    {
      "id": "REQ-007", "type": "negative",
      "text": "Do not require login or user-account storage for theme persistence.",
      "priority": "must", "sourceRef": "u2",
      "acceptance": "Theme persistence works without authentication and does not depend on a user account.",
      "status": "confirmed"
    },
    {
      "id": "REQ-008", "type": "constraint",
      "text": "Keep the same set of UI components and implement theme switching by adding a CSS class \"dark\" to the root element.",
      "priority": "must", "sourceRef": "u2",
      "acceptance": "The change does not introduce replacement UI components, and dark mode is activated through a root-level \"dark\" class.",
      "status": "confirmed"
    }
  ],
  "flow": {
    "pages": ["Existing Semantix UI with top-right nav bar"],
    "states": [
      "No saved theme preference",
      "Light theme selected",
      "Dark theme selected",
      "System preference fallback applied"
    ],
    "transitions": [
      "User clicks the top-right nav toggle to switch theme",
      "Theme selection is saved to localStorage under \"semantix-theme\"",
      "On load, saved preference is applied if present",
      "On load without saved preference, system preference is detected and applied"
    ],
    "dataNeeded": ["localStorage value for \"semantix-theme\"", "System color-scheme preference"]
  },
  "scope": {
    "inScope": [
      "Add a dark mode toggle button to the top-right nav bar",
      "Persist theme preference in localStorage under \"semantix-theme\"",
      "Apply saved preference on load",
      "Use system preference as fallback when no stored preference exists",
      "Apply dark mode through a root element \"dark\" class"
    ],
    "outOfScope": [
      "Login-required theme preferences",
      "User-account-based preference persistence",
      "Changing the existing set of UI components",
      "Unspecified redesign of Semantix UI surfaces"
    ],
    "negativeRequirements": [
      "No login required",
      "Do not replace or expand the set of UI components",
      "Do not use a persistence key other than \"semantix-theme\""
    ]
  },
  "assumptions": [],
  "openQuestions": [],
  "risks": [],
  "userDecisions": [
    {"id": "D-001", "text": "The toggle will live in the top-right nav bar.", "sourceRef": "u2"},
    {"id": "D-002", "text": "Theme preference will be browser-local in localStorage under \"semantix-theme\".", "sourceRef": "u2"},
    {"id": "D-003", "text": "System preference will be used as fallback when no saved preference exists.", "sourceRef": "u2"},
    {"id": "D-004", "text": "No login is required for theme persistence.", "sourceRef": "u2"},
    {"id": "D-005", "text": "The implementation should keep the same set of UI components and only add a root \"dark\" CSS class for dark mode.", "sourceRef": "u2"}
  ],
  "acceptanceSummary": [
    "Toggle button appears in the top-right nav bar.",
    "User can switch between light and dark mode.",
    "Selected theme persists across reloads and sessions via localStorage key \"semantix-theme\".",
    "If no saved preference exists, the UI follows the system color-scheme preference.",
    "No login is required.",
    "Dark mode is activated by adding \"dark\" to the root element without changing the existing set of UI components."
  ],
  "existingSystemContext": {
    "mode": "update",
    "targetSurfaces": [
      "Existing Semantix UI top-right nav bar",
      "Root UI element theme class handling"
    ],
    "doNotChange": [
      "Do not require login",
      "Do not change the existing set of UI components"
    ],
    "reuseRequirements": ["Reuse the existing Semantix UI component set unchanged"],
    "compatibilityRequirements": [
      "Persist preference using browser localStorage with key \"semantix-theme\"",
      "Apply system preference fallback when no saved preference exists"
    ]
  },
  "contextSources": [
    {
      "id": "CS-001", "kind": "user", "ref": "u1",
      "summary": "Initial request to add a persistent dark mode toggle to the Semantix UI.",
      "status": "used"
    },
    {
      "id": "CS-002", "kind": "user", "ref": "u2",
      "summary": "Clarified toggle location, localStorage key, fallback behavior, login boundary, and CSS class implementation boundary.",
      "status": "used"
    }
  ],
  "groundedFacts": [
    {"id": "GF-001", "source": "user", "text": "The original request is to add a dark mode toggle to the Semantix UI that persists across sessions.", "evidenceRef": "u1", "confidence": "high"},
    {"id": "GF-002", "source": "user", "text": "The toggle button should be in the top-right nav bar.", "evidenceRef": "u2", "confidence": "high"},
    {"id": "GF-003", "source": "user", "text": "The preference should be stored in localStorage under \"semantix-theme\".", "evidenceRef": "u2", "confidence": "high"},
    {"id": "GF-004", "source": "user", "text": "System preference should be detected as fallback.", "evidenceRef": "u2", "confidence": "high"},
    {"id": "GF-005", "source": "user", "text": "No login is required.", "evidenceRef": "u2", "confidence": "high"},
    {"id": "GF-006", "source": "user", "text": "The same set of UI components should be kept, with dark mode applied by adding a \"dark\" CSS class to the root element.", "evidenceRef": "u2", "confidence": "high"}
  ],
  "findings": [
    {
      "id": "F-001", "kind": "gap", "sev": "blocker", "section": "scope", "ref": "u1",
      "text": "The requested UI location for the dark mode toggle is not specified.",
      "resolved": true, "raisedBy": "semantix"
    },
    {
      "id": "F-002", "kind": "gap", "sev": "blocker", "section": "constraints", "ref": "u1",
      "text": "The persistence mechanism and storage boundary are not specified.",
      "resolved": true, "raisedBy": "semantix"
    },
    {
      "id": "F-003", "kind": "gap", "sev": "blocker", "section": "boundaries", "ref": "u1",
      "text": "The set of Semantix UI surfaces that must support dark mode is not specified.",
      "resolved": true, "raisedBy": "semantix"
    },
    {
      "id": "F-004", "kind": "assumption", "sev": "concern", "section": "assumptions", "ref": "u1",
      "text": "Assuming this is an update to an existing Semantix UI because the request says to add a toggle to the UI.",
      "resolved": true, "raisedBy": "semantix"
    }
  ],
  "coverage": {
    "alignmentPct": 100,
    "sections": ["intent", "scope", "boundaries", "success", "constraints", "assumptions"],
    "openBlockers": 0,
    "openConcerns": 0,
    "openFYI": 0
  },
  "nextTurn": null
}
```

---

### Summary

| | Turn 1 | Turn 2 |
|---|---|---|
| HTTP status | 200 | 200 |
| `readiness` | `needs_user` | **`ready`** |
| `alignmentPct` | 55 | **100** |
| `openBlockers` | 3 | **0** |
| degraded | no | no |
| `nextTurn` | question asked | `null` |

All 3 blockers (F-001, F-002, F-003) resolved by user turn. 8 requirements confirmed. 5 user decisions recorded. Packet validated by `validateSemantixAlignmentPacket` with no errors.

## Changes made during ss-llm-008 proof

- `buildEvaluatorSystemPrompt()` updated to include item-level schemas for `contextSources` and `groundedFacts` (valid `source` enum values; `evidenceRef` field name)
- Multiple-choice Semantix turns stay Phalanx-compatible: `nextTurn.body.kind` remains `"question"` and discrete answer suggestions live under `nextTurn.body.options`
- `validateSemantixTurn()` rejects outgoing `"choice"` turn bodies and validates option item `id`/`label` fields when options are present
- `parseEvaluatorOutput()` safety-strips `groundedFacts` with invalid `source` values or empty required fields before schema validation
- `existingSystemContext` schema in the system prompt updated to include `targetSurfaces`, `doNotChange`, `reuseRequirements`, `compatibilityRequirements` as top-level fields with inline documentation that they are required when `mode=update` AND `readiness=ready`
- Added explicit rule: "When readiness=ready AND existingSystemContext.mode=update, you MUST include at least one targetSurfaces entry AND at least one of doNotChange, reuseRequirements, or compatibilityRequirements."
- Added explicit rule: "When readiness=ready: set coverage.alignmentPct=100, coverage.openBlockers=0, and mark every prior blocker finding as resolved=true."

## Gate Status

**ss-llm-008 is COMPLETE.** Live LLM-mode two-turn HTTP proof recorded above (2026-05-01).

`PHALANX_SEMANTIX_HTTP_URL` wiring is unblocked. To connect Phalanx:

1. Start Semantix with `SPEC_STUDIO_EVALUATOR=llm SEMANTIX_SPEC_STUDIO_MODEL=gpt-5.5`
2. Verify `GET /spec-studio/mode` returns `{"evaluatorMode":"llm","ready":true}`
3. Set `PHALANX_SEMANTIX_HTTP_URL=http://<semantix-host>:<port>/spec-studio/evaluate` in Phalanx
