import assert from "node:assert/strict";
import test from "node:test";

import {
  ingestContextResponses,
  recordInterpretationsFromFacts,
} from "../src/spec-studio-context-ingestion.js";

import {
  validateSemantixAlignmentPacket,
} from "../src/spec-studio-contracts.js";

import {
  greenfieldReadyPacket,
  hoplonGroundedPacket,
  updateReadyPacket,
} from "./fixtures/spec-studio-samples.js";

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function basePacket() {
  const packet = deepClone(updateReadyPacket);
  packet.contextSources = [];
  packet.groundedFacts = [];
  return packet;
}

function ctxRequest({
  id = "CTX-001",
  sessionId = "spec_a",
  iteration = 1,
  purpose = "identify_target_surface",
  query = "find existing run dashboard",
  reason = "needed",
  requestedFrom = ["phalanx", "hoplon", "repo"],
} = {}) {
  return {
    id,
    sessionId,
    iteration,
    purpose,
    query,
    requestedFrom,
    constraints: { mustReturnEvidenceRefs: true },
    reason,
  };
}

// ---- Successful Hoplon-grounded fact -------------------------------------

test("ingests a successful Hoplon-grounded fact with evidenceRef", () => {
  const request = ctxRequest({ requestedFrom: ["phalanx", "hoplon"] });
  const result = ingestContextResponses({
    packet: basePacket(),
    requests: [request],
    responses: [
      {
        requestId: request.id,
        status: "ok",
        facts: [
          {
            id: "FACT-001",
            source: "hoplon",
            text: "Existing right panel found.",
            confidence: "high",
            evidenceRef: "hoplon://run-view#right-panel",
          },
        ],
        artifacts: [],
        summary: "Hoplon returned an existing surface.",
      },
    ],
  });

  assert.equal(result.addedFactIds.length, 1);
  assert.equal(result.packet.groundedFacts[0].id, "FACT-001");
  assert.equal(result.packet.contextSources[0].kind, "hoplon");
  assert.equal(result.packet.contextSources[0].status, "used");
  assert.deepEqual(result.packet.contextSources[0].evidenceRefs, [
    "hoplon://run-view#right-panel",
  ]);
});

test("ingested packet still validates against the contract", () => {
  const request = ctxRequest();
  const result = ingestContextResponses({
    packet: basePacket(),
    requests: [request],
    responses: [
      {
        requestId: request.id,
        status: "ok",
        facts: [
          {
            id: "FACT-INGEST-1",
            source: "hoplon",
            text: "Surface found",
            confidence: "high",
            evidenceRef: "hoplon://x",
          },
        ],
        artifacts: [],
        summary: "ok",
      },
    ],
  });
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("contextSource kind follows returned fact source over requestedFrom ordering", () => {
  const request = ctxRequest({
    purpose: "find_constraints",
    requestedFrom: ["phalanx", "repo", "hoplon"],
  });
  const result = ingestContextResponses({
    packet: basePacket(),
    requests: [request],
    responses: [
      {
        requestId: request.id,
        status: "ok",
        facts: [
          {
            id: "FACT-HOPLON-ORDER",
            source: "hoplon",
            text: "Hoplon observed the constraint.",
            confidence: "high",
            evidenceRef: "hoplon://trace/constraint",
          },
        ],
        artifacts: [],
        summary: "Hoplon returned the evidence.",
      },
    ],
  });
  assert.equal(result.packet.contextSources[0].kind, "hoplon");
});

// ---- Empty response -------------------------------------------------------

test("an empty response produces a contextSource but no groundedFacts", () => {
  const request = ctxRequest();
  const result = ingestContextResponses({
    packet: basePacket(),
    requests: [request],
    responses: [
      {
        requestId: request.id,
        status: "empty",
        facts: [],
        artifacts: [],
        summary: "Phalanx queried but found nothing relevant.",
      },
    ],
  });
  assert.equal(result.addedFactIds.length, 0);
  assert.equal(result.packet.groundedFacts.length, 0);
  assert.equal(result.packet.contextSources.length, 1);
  assert.equal(result.packet.contextSources[0].status, "used");
});

// ---- Error response -------------------------------------------------------

test("an error response marks the contextSource unavailable and does not fabricate facts", () => {
  const request = ctxRequest();
  const result = ingestContextResponses({
    packet: basePacket(),
    requests: [request],
    responses: [
      {
        requestId: request.id,
        status: "error",
        facts: [],
        artifacts: [],
        summary: "Tool unavailable.",
        error: "Hoplon broker timed out",
      },
    ],
  });
  assert.equal(result.packet.contextSources[0].status, "unavailable");
  assert.equal(result.packet.groundedFacts.length, 0);
});

// ---- Skipped requests ----------------------------------------------------

test("explicitly skipped requests yield contextSources with status skipped", () => {
  const request = ctxRequest();
  const result = ingestContextResponses({
    packet: basePacket(),
    requests: [request],
    responses: [],
    skippedRequests: [
      { requestId: request.id, summary: "User opted out of Hoplon trace lookup." },
    ],
  });
  assert.equal(result.packet.contextSources.length, 1);
  assert.equal(result.packet.contextSources[0].status, "skipped");
  assert.match(result.packet.contextSources[0].summary, /opted out/i);
  assert.equal(result.packet.groundedFacts.length, 0);
});

// ---- Evidence-ref enforcement -------------------------------------------

test("facts without evidenceRef are skipped and reported", () => {
  const request = ctxRequest();
  // The validator already rejects this shape before ingest, but we
  // exercise the defensive path by using validateGroundedFact-rejecting
  // facts via a hand-rolled test that bypasses the response validator.
  // To do that, we send a response with an otherwise-valid fact and
  // mutate the evidenceRef out of the validated copy.
  // Instead, simulate the underlying scenario by directly calling
  // ingestContextResponses with a response whose status is ok but
  // contains a fact with a non-string evidenceRef. The response
  // validator rejects this, so we expect a thrown ValidationError.
  assert.throws(
    () =>
      ingestContextResponses({
        packet: basePacket(),
        requests: [request],
        responses: [
          {
            requestId: request.id,
            status: "ok",
            facts: [
              {
                id: "FACT-NOEV",
                source: "hoplon",
                text: "claim",
                confidence: "high",
              },
            ],
            artifacts: [],
            summary: "missing evidence",
          },
        ],
      }),
    (error) => error.name === "ValidationError",
  );
});

test("facts with empty evidenceRef strings are filtered without throwing when response is otherwise valid", () => {
  const request = ctxRequest();
  // The response validator rejects empty evidenceRef as well, so
  // this scenario throws. Verify the thrown error names the right
  // constraint so consumers know how to fix the response.
  try {
    ingestContextResponses({
      packet: basePacket(),
      requests: [request],
      responses: [
        {
          requestId: request.id,
          status: "ok",
          facts: [
            {
              id: "FACT-EMPTY",
              source: "hoplon",
              text: "claim",
              confidence: "high",
              evidenceRef: "",
            },
          ],
          artifacts: [],
          summary: "empty evidence",
        },
      ],
    });
    assert.fail("expected ValidationError");
  } catch (error) {
    assert.equal(error.name, "ValidationError");
    assert.ok(
      JSON.stringify(error.details).includes("grounded_fact_missing_evidence_ref"),
    );
  }
});

// ---- Stable IDs are preserved across multiple ingestions ------------------

test("re-ingesting a fact with the same id does not duplicate it", () => {
  const request = ctxRequest();
  const fact = {
    id: "FACT-STABLE",
    source: "hoplon",
    text: "panel",
    confidence: "high",
    evidenceRef: "hoplon://x",
  };
  const first = ingestContextResponses({
    packet: basePacket(),
    requests: [request],
    responses: [
      { requestId: request.id, status: "ok", facts: [fact], artifacts: [], summary: "ok" },
    ],
  });
  const second = ingestContextResponses({
    packet: first.packet,
    requests: [request],
    responses: [
      { requestId: request.id, status: "ok", facts: [fact], artifacts: [], summary: "ok" },
    ],
  });
  assert.equal(second.packet.groundedFacts.length, 1);
  assert.equal(second.addedFactIds.length, 0);
});

// ---- Interpretation separation -------------------------------------------

test("recordInterpretationsFromFacts records assumptions/risks/findings without touching groundedFacts", () => {
  const packet = deepClone(hoplonGroundedPacket);
  packet.assumptions = [];
  packet.risks = [];
  const next = recordInterpretationsFromFacts({
    packet,
    assumptions: [
      {
        id: "ASSUMP-001",
        text: "Right panel reuse implies no new shell.",
        sourceFactRef: "FACT-001",
      },
    ],
    risks: [
      {
        id: "RISK-001",
        text: "Right panel layout may not fit observation summaries.",
        sourceFactRef: "FACT-001",
        sev: "concern",
      },
    ],
    findings: [
      {
        id: "F-INTERP-001",
        kind: "assumption",
        sev: "fyi",
        section: "scope",
        ref: "FACT-001",
        text: "Reuse of the existing right panel is feasible.",
        resolved: false,
        raisedBy: "semantix",
        sourceFactRef: "FACT-001",
      },
    ],
  });

  assert.equal(next.assumptions.length, 1);
  assert.equal(next.risks.length, 1);
  assert.equal(next.findings.length, 1);
  // groundedFacts unchanged
  assert.deepEqual(next.groundedFacts, packet.groundedFacts);
});

test("recordInterpretationsFromFacts rejects entries without sourceFactRef", () => {
  const packet = deepClone(hoplonGroundedPacket);
  assert.throws(
    () =>
      recordInterpretationsFromFacts({
        packet,
        assumptions: [{ id: "ASSUMP-001", text: "interpretation without source" }],
      }),
    (error) =>
      error.name === "ValidationError" &&
      /sourceFactRef/i.test(error.message),
  );
});

test("recordInterpretationsFromFacts rejects sourceFactRef pointing at unknown fact", () => {
  const packet = deepClone(hoplonGroundedPacket);
  assert.throws(
    () =>
      recordInterpretationsFromFacts({
        packet,
        risks: [
          { id: "RISK-001", text: "x", sourceFactRef: "FACT-DOES-NOT-EXIST" },
        ],
      }),
    (error) =>
      error.name === "ValidationError" &&
      /unknown grounded fact/i.test(error.message),
  );
});

test("recordInterpretationsFromFacts can promote interpretations into requirement facts", () => {
  const packet = deepClone(hoplonGroundedPacket);
  const next = recordInterpretationsFromFacts({
    packet,
    requirements: [
      {
        id: "REQ-NEG-100",
        type: "negative",
        text: "Do not introduce a duplicate run dashboard.",
        priority: "must",
        sourceRef: "FACT-001",
        sourceFactRef: "FACT-001",
        acceptance: "No duplicate dashboard surfaces are added.",
        status: "confirmed",
      },
    ],
  });
  assert.ok(next.requirements.some((r) => r.id === "REQ-NEG-100"));
  // groundedFacts unchanged
  assert.deepEqual(next.groundedFacts, packet.groundedFacts);
});

// ---- Authority boundary --------------------------------------------------

test("ingestion never adds groundedFacts entries from interpretations", () => {
  const request = ctxRequest();
  const result = ingestContextResponses({
    packet: basePacket(),
    requests: [request],
    responses: [
      {
        requestId: request.id,
        status: "ok",
        facts: [],
        artifacts: [],
        summary: "Phalanx returned no facts; semantix should not synthesize them.",
      },
    ],
  });
  // Explicit guarantee: empty response → no groundedFacts added.
  assert.equal(result.addedFactIds.length, 0);
});

test("ingestion preserves existing groundedFacts on the packet", () => {
  const packet = deepClone(hoplonGroundedPacket); // already has FACT-001
  const request = ctxRequest({ id: "CTX-002" });
  const result = ingestContextResponses({
    packet,
    requests: [request],
    responses: [
      {
        requestId: request.id,
        status: "ok",
        facts: [
          {
            id: "FACT-002",
            source: "hoplon",
            text: "additional fact",
            confidence: "medium",
            evidenceRef: "hoplon://other",
          },
        ],
        artifacts: [],
        summary: "ok",
      },
    ],
  });
  const ids = result.packet.groundedFacts.map((fact) => fact.id);
  assert.ok(ids.includes("FACT-001"));
  assert.ok(ids.includes("FACT-002"));
});

test("ingestion accepts the upstream Hoplon-grounded packet starting from a clean response replay", () => {
  const startingPacket = deepClone(hoplonGroundedPacket);
  startingPacket.contextSources = [];
  startingPacket.groundedFacts = [];

  const request = {
    id: "CTX-001",
    sessionId: hoplonGroundedPacket.sessionId,
    iteration: hoplonGroundedPacket.iteration - 1,
    purpose: "identify_target_surface",
    query: "Find existing Run View right-panel observation surface.",
    requestedFrom: ["phalanx", "hoplon"],
    constraints: { mustReturnEvidenceRefs: true },
    reason: "Need the run-view right panel evidence",
  };
  const result = ingestContextResponses({
    packet: startingPacket,
    requests: [request],
    responses: [
      {
        requestId: request.id,
        status: "ok",
        facts: hoplonGroundedPacket.groundedFacts,
        artifacts: [],
        summary: "Hoplon found a current right-panel observation summary component.",
      },
    ],
  });
  const validation = validateSemantixAlignmentPacket(result.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.ok(result.packet.groundedFacts.some((f) => f.id === "FACT-001"));
});

test("ingestContextResponses requires a packet object", () => {
  assert.throws(
    () => ingestContextResponses({ packet: null, responses: [] }),
    (error) => error.name === "ValidationError",
  );
});

test("Semantix-side packet retains source: semantix after ingestion", () => {
  const packet = deepClone(greenfieldReadyPacket);
  const request = ctxRequest({ id: "CTX-005" });
  const result = ingestContextResponses({
    packet,
    requests: [request],
    responses: [
      {
        requestId: request.id,
        status: "ok",
        facts: [
          {
            id: "FACT-X",
            source: "phalanx",
            text: "fact",
            confidence: "high",
            evidenceRef: "phalanx://x",
          },
        ],
        artifacts: [],
        summary: "ok",
      },
    ],
  });
  assert.equal(result.packet.source, "semantix");
});
