import assert from "node:assert/strict";
import test from "node:test";

import {
  HANDSHAKE_TRIGGERS,
  createSemantixHandshakeAdapter,
  describeSemantixCapabilities,
  isHandshakePacketLockable,
} from "../src/spec-studio-handshake.js";

import {
  CONTRACT_VERSION,
  READINESS,
  validateSemantixAlignmentPacket,
} from "../src/spec-studio-contracts.js";

import {
  ambiguousNeedsUserPacket,
  greenfieldReadyPacket,
  hoplonGroundedPacket,
  evaluateResponseFixtures,
} from "./fixtures/spec-studio-samples.js";

function buildInitialRequest(sessionId = "spec_session_1") {
  return {
    sessionId,
    trigger: HANDSHAKE_TRIGGERS.INITIAL,
    userTurn: {
      id: "u_1",
      body: { kind: "text", text: "Build a notes app." },
    },
    decisions: [],
    findings: [],
    contextResponses: [],
  };
}

function buildFollowUpRequest(currentPacket, trigger = HANDSHAKE_TRIGGERS.USER_TURN) {
  return {
    sessionId: currentPacket.sessionId,
    trigger,
    userTurn: {
      id: "u_2",
      body: { kind: "free", text: "We also want offline." },
    },
    currentPacket,
    decisions: [],
    findings: [],
    contextResponses: [],
  };
}

// ---- describe ------------------------------------------------------------

test("describeSemantixCapabilities reports the contract version and supported behaviors", () => {
  const summary = describeSemantixCapabilities();
  assert.equal(summary.contractVersion, CONTRACT_VERSION);
  assert.ok(summary.triggers.includes("initial"));
  assert.ok(summary.triggers.includes("reconsider"));
  assert.ok(summary.contextRequestPurposes.includes("identify_target_surface"));
  assert.ok(summary.readinessValues.includes("ready"));
  assert.equal(summary.capabilities.lockAuthority, "phalanx");
  assert.equal(summary.capabilities.decisionIdAuthority, "phalanx");
  assert.equal(summary.capabilities.hoplonAccess, "via phalanx broker only");
});

// ---- Fixture-mode adapter ------------------------------------------------

test("fixture-mode adapter returns the trigger-keyed fixture and validates the packet", async () => {
  const adapter = createSemantixHandshakeAdapter({
    fixtureResponses: {
      initial: evaluateResponseFixtures.initialReady,
    },
  });
  assert.equal(adapter.isAvailable(), true);
  const response = await adapter.evaluate(buildInitialRequest());
  assert.equal(response.packet.readiness, READINESS.READY);
  const validation = validateSemantixAlignmentPacket(response.packet);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
});

test("fixture function form is supported", async () => {
  const adapter = createSemantixHandshakeAdapter({
    fixtureResponses: (request) =>
      request.trigger === "initial"
        ? evaluateResponseFixtures.initialReady
        : evaluateResponseFixtures.ambiguousFollowUp,
  });
  const response = await adapter.evaluate(buildInitialRequest());
  assert.equal(response.packet.readiness, READINESS.READY);
});

// ---- Evaluator-mode adapter ----------------------------------------------

test("evaluator-mode adapter wraps a custom evaluator and validates", async () => {
  const adapter = createSemantixHandshakeAdapter({
    evaluator: () => evaluateResponseFixtures.initialReady,
  });
  const response = await adapter.evaluate(buildInitialRequest());
  assert.equal(response.packet.contractVersion, CONTRACT_VERSION);
});

// ---- Malformed evaluator response ----------------------------------------

test("malformed evaluator response is degraded honestly", async () => {
  const adapter = createSemantixHandshakeAdapter({
    evaluator: () => ({ packet: null, events: [], contextRequests: [] }),
  });
  const response = await adapter.evaluate(buildInitialRequest());
  assert.equal(response.packet.readiness, READINESS.NEEDS_USER);
  assert.equal(isHandshakePacketLockable(response.packet), false);
});

test("invalid non-null evaluator packet is degraded honestly", async () => {
  const invalidPacket = { ...greenfieldReadyPacket, readiness: "almost_ready" };
  const adapter = createSemantixHandshakeAdapter({
    evaluator: () => ({ packet: invalidPacket, events: [], contextRequests: [] }),
  });
  const response = await adapter.evaluate(buildInitialRequest());
  assert.equal(response.packet.readiness, READINESS.NEEDS_USER);
  assert.equal(isHandshakePacketLockable(response.packet), false);
});

test("evaluator that throws does not surface as opaque failure", async () => {
  const adapter = createSemantixHandshakeAdapter({
    evaluator: () => {
      throw new Error("model unavailable");
    },
  });
  const response = await adapter.evaluate(buildInitialRequest());
  assert.equal(response.packet.readiness, READINESS.NEEDS_USER);
  assert.ok(response.events.some((event) => event.kind.startsWith("evaluator.degraded") || event.kind === "semantix.degraded"));
});

test("strict continuity rejects reissued context request ids from prior responses", async () => {
  const adapter = createSemantixHandshakeAdapter({
    strictContinuity: true,
    evaluator: () => ({
      packet: hoplonGroundedPacket,
      events: [],
      contextRequests: [
        {
          id: "CTX-001",
          sessionId: hoplonGroundedPacket.sessionId,
          iteration: hoplonGroundedPacket.iteration,
          purpose: "identify_target_surface",
          query: "again",
          requestedFrom: ["phalanx"],
          constraints: {},
          reason: "test",
        },
      ],
    }),
  });
  await assert.rejects(
    () =>
      adapter.evaluate({
        ...buildFollowUpRequest(hoplonGroundedPacket, HANDSHAKE_TRIGGERS.CONTEXT_RESPONSE),
        contextResponses: [
          {
            requestId: "CTX-001",
            status: "empty",
            facts: [],
            artifacts: [],
            summary: "No result.",
          },
        ],
      }),
    (error) =>
      error.name === "ValidationError" &&
      /context-request ID continuity/i.test(error.message),
  );
});

// ---- Unavailable adapter -------------------------------------------------

test("unavailable adapter returns a degraded packet without throwing", async () => {
  const adapter = createSemantixHandshakeAdapter({
    unavailable: true,
    unavailableReason: "Semantix model under maintenance.",
  });
  assert.equal(adapter.isAvailable(), false);
  const response = await adapter.evaluate(buildInitialRequest());
  assert.equal(response.packet.readiness, READINESS.NEEDS_USER);
  assert.equal(response.packet.coverage.alignmentPct, 0);
  assert.equal(isHandshakePacketLockable(response.packet), false);
  // Phalanx pipeline should not see this as a thrown failure
  assert.ok(response.events.some((event) => event.kind === "semantix.unavailable"));
});

test("unavailable mode does not require an evaluator", () => {
  // Should construct without throwing
  const adapter = createSemantixHandshakeAdapter({ unavailable: true });
  assert.equal(adapter.isAvailable(), false);
});

test("requires evaluator, fixtureResponses, or unavailable=true", () => {
  assert.throws(
    () => createSemantixHandshakeAdapter({}),
    (error) => error.name === "ValidationError",
  );
});

// ---- Prior-state ID preservation -----------------------------------------

test("adapter exposes continuity violations through onContinuityViolation", async () => {
  const violations = [];
  const adapter = createSemantixHandshakeAdapter({
    evaluator: () => {
      // Mutate a requirement under the same id to force a continuity violation.
      const packet = JSON.parse(JSON.stringify(greenfieldReadyPacket));
      packet.requirements[0].text = "Mutated under same id";
      return {
        packet,
        events: [{ id: "evt", kind: "packet.evaluated" }],
        contextRequests: [],
      };
    },
    onContinuityViolation: (entries) => {
      violations.push(...entries);
    },
  });
  await adapter.evaluate(buildFollowUpRequest(greenfieldReadyPacket));
  assert.ok(violations.length > 0, "expected at least one continuity violation");
  assert.ok(violations.some((entry) => entry.kind === "requirement_mutated"));
});

test("strictContinuity throws on continuity violations", async () => {
  const adapter = createSemantixHandshakeAdapter({
    strictContinuity: true,
    evaluator: () => {
      const packet = JSON.parse(JSON.stringify(greenfieldReadyPacket));
      packet.requirements[0].text = "Mutated under same id";
      return {
        packet,
        events: [{ id: "evt", kind: "packet.evaluated" }],
        contextRequests: [],
      };
    },
  });
  await assert.rejects(
    () => adapter.evaluate(buildFollowUpRequest(greenfieldReadyPacket)),
    (error) => error.name === "ValidationError",
  );
});

test("preserved IDs across turns produce no continuity violations", async () => {
  let observed = false;
  const adapter = createSemantixHandshakeAdapter({
    evaluator: () => ({
      packet: greenfieldReadyPacket,
      events: [{ id: "evt", kind: "packet.evaluated" }],
      contextRequests: [],
    }),
    onContinuityViolation: () => {
      observed = true;
    },
  });
  const response = await adapter.evaluate(buildFollowUpRequest(greenfieldReadyPacket));
  assert.equal(response.packet.sessionId, greenfieldReadyPacket.sessionId);
  assert.equal(observed, false);
});

// ---- Multi-turn smoke test ------------------------------------------------

test("adapter can drive an in-process multi-turn handshake", async () => {
  const seenTriggers = [];
  const adapter = createSemantixHandshakeAdapter({
    fixtureResponses: (request) => {
      seenTriggers.push(request.trigger);
      if (request.trigger === HANDSHAKE_TRIGGERS.INITIAL) {
        return { ...evaluateResponseFixtures.ambiguousFollowUp };
      }
      return { ...evaluateResponseFixtures.hoplonGroundedFollowUp };
    },
  });

  const initial = await adapter.evaluate(buildInitialRequest("spec_handshake"));
  assert.equal(initial.packet.readiness, READINESS.NEEDS_USER);

  const followUp = await adapter.evaluate({
    sessionId: "spec_handshake",
    trigger: HANDSHAKE_TRIGGERS.USER_TURN,
    userTurn: {
      id: "u_2",
      body: { kind: "choice", picked: "opt_existing", label: "Update existing Run View" },
    },
    currentPacket: initial.packet,
    decisions: [],
    findings: [],
    contextResponses: [],
  });
  assert.equal(followUp.packet.readiness, READINESS.READY);
  assert.deepEqual(seenTriggers, ["initial", "user_turn"]);
});

// ---- isHandshakePacketLockable ------------------------------------------

test("isHandshakePacketLockable returns true for ready packets and false for ambiguous", () => {
  assert.equal(isHandshakePacketLockable(greenfieldReadyPacket), true);
  assert.equal(isHandshakePacketLockable(hoplonGroundedPacket), true);
  assert.equal(isHandshakePacketLockable(ambiguousNeedsUserPacket), false);
});
