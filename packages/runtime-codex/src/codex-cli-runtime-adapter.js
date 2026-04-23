import { makeEvent } from "../../core/src/contracts.js";
import { CodexAppServerConnector } from "./connectors/codex-app-server-connector.js";
import { CodexCliConnector } from "./connectors/codex-cli-connector.js";
import {
  buildStrictCompilerContext as buildSemanticAdmissionContext,
  normalizeStrictCompilerEnvelope,
  writeStrictCompilerInstructionsFile,
} from "./strict-compiler.js";

function createPushQueue() {
  const pendingValues = [];
  const pendingResolvers = [];
  let closed = false;

  return {
    push(value) {
      if (closed) {
        return;
      }

      const resolver = pendingResolvers.shift();
      if (resolver) {
        resolver({ value, done: false });
        return;
      }

      pendingValues.push(value);
    },
    close() {
      closed = true;
      while (pendingResolvers.length) {
        pendingResolvers.shift()({ value: undefined, done: true });
      }
    },
    iterator() {
      const queue = this;
      return {
        [Symbol.asyncIterator]() {
          return this;
        },
        async next() {
          if (pendingValues.length) {
            return {
              value: pendingValues.shift(),
              done: false,
            };
          }

          if (closed) {
            return {
              value: undefined,
              done: true,
            };
          }

          return new Promise((resolve) => {
            pendingResolvers.push(resolve);
          });
        },
        async return() {
          queue.close();
          return {
            value: undefined,
            done: true,
          };
        },
      };
    },
  };
}

function normalizeSessionInput(input) {
  if (Array.isArray(input)) {
    return input.map((item) => ({
      text_elements: [],
      ...item,
      ...(item.type === "text"
        ? {
            text_elements: item.text_elements ?? [],
          }
        : {}),
    }));
  }

  if (typeof input === "string") {
    return [
      {
        type: "text",
        text: input,
        text_elements: [],
      },
    ];
  }

  if (input && typeof input === "object") {
    return [
      {
        text_elements: [],
        ...input,
      },
    ];
  }

  return [];
}

function normalizeThreadStatus(status) {
  const type = typeof status === "string" ? status : status?.type;

  if (type === "idle") {
    return "waiting_for_input";
  }

  if (type === "active") {
    return "running";
  }

  return "running";
}

function normalizeSessionNotificationType(method, params) {
  if (method === "thread/started") {
    return "session.updated";
  }

  if (method === "thread/status/changed") {
    return "session.updated";
  }

  if (method === "turn/started") {
    return "turn.started";
  }

  if (method === "turn/completed") {
    return params?.turn?.status === "interrupted" ? "turn.interrupted" : "turn.completed";
  }

  if (method === "item/agentMessage/delta") {
    return "turn.output.delta";
  }

  if (method === "item/completed" || method === "item/started") {
    return "turn.output.delta";
  }

  if (method === "error") {
    return params?.willRetry ? "session.updated" : "turn.failed";
  }

  return "node.updated";
}

export class CodexCliRuntimeAdapter {
  constructor({
    connector,
    execConnector,
    sessionConnector,
    runner,
    command = process.env.SEMANTIX_CODEX_COMMAND ?? "codex",
    cwd = process.cwd(),
    env = process.env,
    codexHome,
    configProfile,
    model,
    approvalPolicy,
    sandboxMode,
    rawOverrides,
  } = {}) {
    this.id = "codex_cli";
    this.family = "cli_runtime";
    this.displayName = "Codex CLI Runtime Adapter";
    this.connector =
      execConnector ??
      connector ??
      new CodexCliConnector({
        runner,
        command,
        cwd,
        env,
        codexHome,
        configProfile,
        model,
        approvalPolicy,
        sandboxMode,
        rawOverrides,
      });
    this.sessionConnector =
      sessionConnector ??
      new CodexAppServerConnector({
        command,
        cwd,
        env,
        codexHome,
        configProfile,
        model,
        approvalPolicy,
        sandboxMode,
        rawOverrides,
      });
    this.runQueues = new Map();
    this.sessionIndex = new Map();
    this.threadIndex = new Map();
    this.turnIndex = new Map();
    this.sessionConnector.onNotification((message) => {
      this.handleSessionNotification(message);
    });
  }

  async getCapabilities() {
    return {
      supportsMultiTurn: true,
      supportsFileMutation: true,
      supportsToolUse: true,
      supportsStructuredOutput: true,
      supportsStreaming: true,
      supportsPauseResume: true,
      supportsLocalExecution: true,
      supportsModelSelection: false,
      supportsEffectSimulation: false,
    };
  }

  async healthCheck() {
    const [execHealth, sessionHealth] = await Promise.all([
      this.connector.healthCheck(),
      this.sessionConnector.healthCheck(),
    ]);

    return {
      runtimeId: this.id,
      exec: execHealth,
      appServer: sessionHealth,
      healthy: execHealth.healthy && sessionHealth.healthy,
    };
  }

  getQueue(runId) {
    let queue = this.runQueues.get(runId);
    if (!queue) {
      queue = createPushQueue();
      this.runQueues.set(runId, queue);
    }
    return queue;
  }

  pushEvent(runId, event) {
    this.getQueue(runId).push(event);
  }

  trackSession({ runId, sessionId, runtimeSessionId, nodeId }) {
    const descriptor = {
      runId,
      sessionId,
      runtimeSessionId,
      nodeId,
      activeRuntimeTurnId: this.sessionIndex.get(sessionId)?.activeRuntimeTurnId ?? null,
    };
    this.sessionIndex.set(sessionId, descriptor);
    this.threadIndex.set(runtimeSessionId, descriptor);
    return descriptor;
  }

  trackTurn({ runId, sessionId, runtimeSessionId, turnId, runtimeTurnId, nodeId }) {
    const session = this.trackSession({
      runId,
      sessionId,
      runtimeSessionId,
      nodeId,
    });
    session.activeRuntimeTurnId = runtimeTurnId;
    this.turnIndex.set(runtimeTurnId, {
      runId,
      sessionId,
      turnId,
      nodeId,
      runtimeSessionId,
    });
    return session;
  }

  registerSession(session) {
    return this.trackSession({
      runId: session.runId,
      sessionId: session.sessionId,
      runtimeSessionId: session.runtimeSessionId,
      nodeId: session.nodeId,
    });
  }

  resolveTrackedSession(session) {
    if (session?.sessionId && this.sessionIndex.has(session.sessionId)) {
      return this.sessionIndex.get(session.sessionId);
    }

    return this.registerSession(session);
  }

  buildStrictCompilerContext({ runId, node, intent, artifact }) {
    return buildSemanticAdmissionContext({
      runId,
      node,
      intent,
      artifact,
    });
  }

  normalizeRunnerPayload({ runId, node, result, compilerContext }) {
    const executionStatus = result.exitCode === 0 ? "succeeded" : "failed";
    const stdoutSummary = result.stdout.trim();

    if (result.exitCode !== 0) {
      return {
        executionStatus,
        outputSummary: stdoutSummary || "Codex CLI execution failed.",
        stateEffects: [],
        riskSignals: [],
        checkpoint: null,
        inspectorPatch: null,
        raw: result,
        events: [
          makeEvent({
            runId,
            type: "node.updated",
            timestamp: Date.now(),
            nodeId: node.id,
            payload: {
              executionStatus,
              outputSummary: stdoutSummary || "Codex CLI execution failed.",
            },
          }),
        ],
      };
    }

    const normalized = normalizeStrictCompilerEnvelope({
      runId,
      node,
      stdout: result.stdout,
      hardValidationSchema: compilerContext.hardValidationSchema,
      semanticFrameContext: compilerContext.semanticFrameContext,
    });

    return {
      executionStatus: normalized.executionStatus,
      outputSummary: normalized.outputSummary,
      admittedOutput: normalized.admittedOutput,
      stateEffects: normalized.stateEffects,
      riskSignals: normalized.riskSignals,
      checkpoint: normalized.checkpoint,
      inspectorPatch: normalized.inspectorPatch,
      raw: result,
      events: [
        makeEvent({
          runId,
          type: "node.updated",
          timestamp: Date.now(),
          nodeId: node.id,
          payload: {
            executionStatus: normalized.executionStatus,
            outputSummary: normalized.outputSummary,
          },
        }),
      ],
    };
  }

  async executeNode({ runId, node, intent, artifact }) {
    this.pushEvent(
      runId,
      makeEvent({
        runId,
        type: "node.updated",
        timestamp: Date.now(),
        nodeId: node.id,
        payload: {
          executionStatus: "running",
        },
      }),
    );

    try {
      const compilerContext = this.buildStrictCompilerContext({
        runId,
        node,
        intent,
        artifact,
      });
      const instructionsPath = await writeStrictCompilerInstructionsFile({
        codexHome: this.connector.codexHome,
        runId,
        nodeId: node.id,
      });
      const result = await this.connector.execute({
        input: compilerContext.input,
        context: {
          runId,
          node,
          intent,
          artifact,
        },
        cwd: this.connector.cwd,
        rawOverrides: {
          model_instructions_file: instructionsPath,
        },
        onStdoutLine: (line) => {
          this.pushEvent(
            runId,
            makeEvent({
              runId,
              type: "node.updated",
              timestamp: Date.now(),
              nodeId: node.id,
              payload: {
                stream: "stdout",
                line,
              },
            }),
          );
        },
        onStderrLine: (line) => {
          this.pushEvent(
            runId,
            makeEvent({
              runId,
              type: "node.updated",
              timestamp: Date.now(),
              nodeId: node.id,
              payload: {
                stream: "stderr",
                line,
              },
            }),
          );
        },
        onJsonMessage: (message) => {
          if (typeof message?.type === "string") {
            this.pushEvent(
              runId,
              makeEvent({
                runId,
                type: message.type,
                timestamp: Date.now(),
                nodeId: message.nodeId ?? node.id,
                payload: message.payload ?? message,
              }),
            );
            return;
          }

          this.pushEvent(
            runId,
            makeEvent({
              runId,
              type: "node.updated",
              timestamp: Date.now(),
              nodeId: node.id,
              payload: {
                connectorMessage: message,
              },
            }),
          );
        },
      });

      const normalized = this.normalizeRunnerPayload({
        runId,
        node,
        result,
        compilerContext,
      });

      for (const event of normalized.events) {
        this.pushEvent(runId, event);
      }

      return normalized;
    } catch (error) {
      this.pushEvent(
        runId,
        makeEvent({
          runId,
          type: "run.failed",
          timestamp: Date.now(),
          nodeId: node.id,
          payload: {
            message: error.message,
          },
        }),
      );
      throw error;
    }
  }

  async startSession({ runId, sessionId, node, cwd, model, approvalPolicy, sandboxMode }) {
    const result = await this.sessionConnector.startThread({
      cwd,
      model,
      approvalPolicy,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });

    this.trackSession({
      runId,
      sessionId,
      runtimeSessionId: result.runtimeSessionId,
      nodeId: node.id,
    });

    return {
      runtimeSessionId: result.runtimeSessionId,
      thread: result.thread,
      settings: {
        model: result.model,
        modelProvider: result.modelProvider,
        cwd: result.cwd,
        approvalPolicy: result.approvalPolicy,
        sandbox: result.sandbox,
        reasoningEffort: result.reasoningEffort,
      },
    };
  }

  async submitSessionTurn({ runId, session, turn, input, cwd, model, approvalPolicy, sandboxPolicy }) {
    const trackedSession = this.resolveTrackedSession(session);
    const normalizedInput = normalizeSessionInput(input ?? turn.input);
    const result = await this.sessionConnector.startTurn({
      threadId: trackedSession.runtimeSessionId,
      input: normalizedInput,
      cwd,
      model,
      approvalPolicy,
      sandboxPolicy,
    });

    this.trackTurn({
      runId,
      sessionId: session.sessionId,
      runtimeSessionId: trackedSession.runtimeSessionId,
      turnId: turn.turnId,
      runtimeTurnId: result.runtimeTurnId,
      nodeId: session.nodeId,
    });

    return {
      runtimeTurnId: result.runtimeTurnId,
      turn: result.turn,
      input: normalizedInput,
    };
  }

  async readSession({ session }) {
    this.resolveTrackedSession(session);
    return this.sessionConnector.readThread({
      threadId: session.runtimeSessionId,
      includeTurns: true,
    });
  }

  async listSessionTurns({ session }) {
    this.resolveTrackedSession(session);
    return this.sessionConnector.listTurns({
      threadId: session.runtimeSessionId,
    });
  }

  async interruptSession({ session, turn }) {
    const trackedSession = this.resolveTrackedSession(session);
    const runtimeTurnId = turn?.runtimeTurnId ?? trackedSession.activeRuntimeTurnId;
    if (!runtimeTurnId) {
      return {};
    }

    return this.sessionConnector.interruptTurn({
      threadId: trackedSession.runtimeSessionId,
      turnId: runtimeTurnId,
    });
  }

  async pauseRun({ runId, reason }) {
    this.pushEvent(
      runId,
      makeEvent({
        runId,
        type: "run.paused",
        timestamp: Date.now(),
        payload: {
          reason,
        },
      }),
    );
  }

  async resumeRun({ runId, checkpointId }) {
    this.pushEvent(
      runId,
      makeEvent({
        runId,
        type: "run.resumed",
        timestamp: Date.now(),
        payload: {
          checkpointId,
        },
      }),
    );
  }

  async cancelRun({ runId, reason }) {
    this.pushEvent(
      runId,
      makeEvent({
        runId,
        type: "run.failed",
        timestamp: Date.now(),
        payload: {
          reason,
          cancelled: true,
        },
      }),
    );
  }

  handleSessionNotification(message) {
    const params = message.params ?? {};
    const runtimeSessionId = params.threadId ?? params.thread?.id;
    const trackedSession = runtimeSessionId ? this.threadIndex.get(runtimeSessionId) : undefined;
    if (!trackedSession) {
      return;
    }

    const runtimeTurnId = params.turn?.id ?? params.turnId;
    const trackedTurn = runtimeTurnId ? this.turnIndex.get(runtimeTurnId) : undefined;
    if (runtimeTurnId && !trackedTurn && params.turn?.id) {
      this.trackTurn({
        runId: trackedSession.runId,
        sessionId: trackedSession.sessionId,
        runtimeSessionId: trackedSession.runtimeSessionId,
        turnId: params.turn.id,
        runtimeTurnId: params.turn.id,
        nodeId: trackedSession.nodeId,
      });
    }

    const eventType = normalizeSessionNotificationType(message.method, params);
    const payload = (() => {
      if (message.method === "thread/status/changed") {
        return {
          status: normalizeThreadStatus(params.status),
          runtimeStatus: params.status,
        };
      }

      if (message.method === "thread/started") {
        return {
          status: "waiting_for_input",
          thread: params.thread,
        };
      }

      if (message.method === "turn/started") {
        return {
          status: "running",
          turn: params.turn,
        };
      }

      if (message.method === "turn/completed") {
        return {
          status: params.turn?.status,
          turn: params.turn,
        };
      }

      if (message.method === "error") {
        return {
          error: params.error,
          willRetry: params.willRetry,
        };
      }

      if (message.method === "item/started" || message.method === "item/completed") {
        return {
          phase: message.method.endsWith("started") ? "started" : "completed",
          item: params.item,
        };
      }

      if (message.method === "item/agentMessage/delta") {
        return {
          delta: params,
        };
      }

      return {
        runtimeNotification: message,
      };
    })();

    if (eventType === "turn.completed" || eventType === "turn.interrupted") {
      trackedSession.activeRuntimeTurnId = null;
    }

    this.pushEvent(
      trackedSession.runId,
      makeEvent({
        runId: trackedSession.runId,
        type: eventType,
        timestamp: Date.now(),
        nodeId: trackedSession.nodeId,
        sessionId: trackedSession.sessionId,
        turnId: trackedTurn?.turnId ?? runtimeTurnId,
        runtimeSessionId: trackedSession.runtimeSessionId,
        payload,
      }),
    );
  }

  async *streamEvents({ runId }) {
    const iterator = this.getQueue(runId).iterator();
    for await (const event of iterator) {
      yield event;
    }
  }

  async close() {
    for (const queue of this.runQueues.values()) {
      queue.close();
    }
    this.runQueues.clear();
    await this.sessionConnector.close?.();
  }
}
