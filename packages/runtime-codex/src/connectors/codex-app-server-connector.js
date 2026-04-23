import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

function maybeQuoteTomlString(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }

  if (Array.isArray(value) || (value && typeof value === "object")) {
    return JSON.stringify(value);
  }

  return JSON.stringify(String(value));
}

function normalizeOverrideEntries(overrides) {
  return Object.entries(overrides)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, maybeQuoteTomlString(value)]);
}

function toError(error, fallbackMessage) {
  if (error instanceof Error) {
    return error;
  }

  return new Error(error?.message ?? fallbackMessage);
}

export class CodexAppServerConnector {
  constructor({
    spawnProcess = spawn,
    command = process.env.SEMANTIX_CODEX_COMMAND ?? "codex",
    baseArgs = [],
    cwd = process.cwd(),
    env = process.env,
    codexHome = process.env.SEMANTIX_CODEX_HOME,
    configProfile = process.env.SEMANTIX_CODEX_CONFIG_PROFILE,
    model = process.env.SEMANTIX_CODEX_MODEL,
    approvalPolicy = process.env.SEMANTIX_CODEX_APPROVAL_POLICY ?? "never",
    sandboxMode = process.env.SEMANTIX_CODEX_SANDBOX_MODE ?? "workspace-write",
    rawOverrides = {},
    clientName = "semantix-control-plane",
    clientVersion = "0.1.0",
    suppressedNotifications = [],
  } = {}) {
    this.spawnProcess = spawnProcess;
    this.command = command;
    this.baseArgs = baseArgs;
    this.cwd = cwd;
    this.env = env;
    this.codexHome = codexHome;
    this.configProfile = configProfile;
    this.model = model;
    this.approvalPolicy = approvalPolicy;
    this.sandboxMode = sandboxMode;
    this.rawOverrides = rawOverrides;
    this.clientName = clientName;
    this.clientVersion = clientVersion;
    this.suppressedNotifications = suppressedNotifications;

    this.requestCounter = 0;
    this.pendingRequests = new Map();
    this.processState = null;
    this.startPromise = null;
    this.notifications = new EventEmitter();
  }

  async ensureCodexHome(codexHome) {
    if (!codexHome) {
      return undefined;
    }

    await mkdir(codexHome, { recursive: true });
    await mkdir(join(codexHome, "sessions"), { recursive: true });
    await mkdir(join(codexHome, "memories"), { recursive: true });
    return codexHome;
  }

  buildExecutionEnvironment({ codexHome, env = {} } = {}) {
    const merged = {
      ...this.env,
      ...env,
    };

    if (codexHome) {
      merged.CODEX_HOME = codexHome;
    }

    return merged;
  }

  buildCommandArgs({
    cwd,
    configProfile,
    model,
    approvalPolicy,
    sandboxMode,
    rawOverrides = {},
  } = {}) {
    const args = [...this.baseArgs];
    const effectiveOverrides = {
      cwd: cwd ?? this.cwd,
      approval_policy: approvalPolicy ?? this.approvalPolicy,
      sandbox_mode: sandboxMode ?? this.sandboxMode,
      model: model ?? this.model,
      ...this.rawOverrides,
      ...rawOverrides,
    };

    if (configProfile ?? this.configProfile) {
      args.push("--profile", configProfile ?? this.configProfile);
    }

    for (const [key, value] of normalizeOverrideEntries(effectiveOverrides)) {
      args.push("-c", `${key}=${value}`);
    }

    args.push("app-server");
    return args;
  }

  consumeLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      this.notifications.emit("malformed", line);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      const pending = this.pendingRequests.get(String(message.id));
      if (!pending) {
        return;
      }

      this.pendingRequests.delete(String(message.id));
      if (message.error) {
        pending.reject(
          new Error(
            message.error.message ?? `Codex app-server request '${pending.method}' failed.`,
          ),
        );
        return;
      }

      pending.resolve(message.result ?? {});
      return;
    }

    if (message.method) {
      this.notifications.emit("notification", message);
    }
  }

  rejectPendingRequests(error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  attachProcess(child) {
    let stdoutBuffer = "";
    let stderrBuffer = "";

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk.toString("utf8");
      const parts = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = parts.pop() ?? "";

      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed) {
          this.consumeLine(trimmed);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString("utf8");
      const parts = stderrBuffer.split(/\r?\n/);
      stderrBuffer = parts.pop() ?? "";

      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed) {
          this.notifications.emit("stderr", trimmed);
        }
      }
    });

    child.on("error", (error) => {
      const normalized = toError(error, "Codex app-server process failed.");
      this.rejectPendingRequests(normalized);
      this.notifications.emit("process_error", normalized);
      this.processState = null;
      this.startPromise = null;
    });

    child.on("close", (code, signal) => {
      if (stdoutBuffer.trim()) {
        this.consumeLine(stdoutBuffer.trim());
      }
      if (stderrBuffer.trim()) {
        this.notifications.emit("stderr", stderrBuffer.trim());
      }

      const closedError = new Error(
        `Codex app-server exited before the request completed (code=${code ?? "null"}, signal=${signal ?? "null"}).`,
      );
      this.rejectPendingRequests(closedError);
      this.notifications.emit("closed", {
        code,
        signal,
      });
      this.processState = null;
      this.startPromise = null;
    });

    this.processState = {
      child,
    };
  }

  async start() {
    if (this.processState?.child && !this.processState.child.killed) {
      return this.processState;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = (async () => {
      const codexHome = await this.ensureCodexHome(this.codexHome);
      const child = this.spawnProcess(this.command, this.buildCommandArgs(), {
        cwd: this.cwd,
        env: this.buildExecutionEnvironment({
          codexHome,
        }),
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.attachProcess(child);
      const initializeResult = await this.sendRequest("initialize", {
        clientInfo: {
          name: this.clientName,
          version: this.clientVersion,
        },
        capabilities: {
          experimental: true,
          suppressNotifications: this.suppressedNotifications,
        },
      });

      this.processState = {
        ...this.processState,
        initializeResult,
        codexHome,
      };

      return this.processState;
    })();

    try {
      return await this.startPromise;
    } finally {
      if (!this.processState) {
        this.startPromise = null;
      }
    }
  }

  async sendRequest(method, params = {}) {
    const id = `rpc-${++this.requestCounter}`;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };

    const child = this.processState?.child;
    if (!child?.stdin || child.stdin.destroyed) {
      throw new Error("Codex app-server stdin is unavailable.");
    }

    const response = await new Promise((resolve, reject) => {
      this.pendingRequests.set(id, {
        method,
        resolve,
        reject,
      });

      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) {
          return;
        }

        this.pendingRequests.delete(id);
        reject(toError(error, `Failed to write ${method} request to Codex app-server.`));
      });
    });

    return response;
  }

  async request(method, params = {}) {
    if (!this.processState?.child || this.processState.child.killed) {
      await this.start();
    }

    return this.sendRequest(method, params);
  }

  onNotification(listener) {
    this.notifications.on("notification", listener);
    return () => {
      this.notifications.off("notification", listener);
    };
  }

  onStderr(listener) {
    this.notifications.on("stderr", listener);
    return () => {
      this.notifications.off("stderr", listener);
    };
  }

  async startThread(params = {}) {
    const result = await this.request("thread/start", {
      cwd: params.cwd ?? this.cwd,
      model: params.model ?? this.model,
      approvalPolicy: params.approvalPolicy ?? this.approvalPolicy,
      serviceName: params.serviceName ?? "semantix-control-plane",
      experimentalRawEvents: params.experimentalRawEvents ?? false,
      persistExtendedHistory: params.persistExtendedHistory ?? false,
      ...params,
    });
    return {
      ...result,
      runtimeSessionId: result.thread?.id,
    };
  }

  async readThread({ threadId, includeTurns = true }) {
    const result = await this.request("thread/read", {
      threadId,
      includeTurns,
    });
    return result.thread;
  }

  async listTurns({ threadId }) {
    const result = await this.request("thread/turns/list", {
      threadId,
    });
    return result.data ?? [];
  }

  async startTurn({
    threadId,
    input,
    cwd,
    approvalPolicy,
    approvalsReviewer,
    sandboxPolicy,
    model,
    effort,
    summary,
    personality,
    outputSchema,
    collaborationMode,
  }) {
    const result = await this.request("turn/start", {
      threadId,
      input,
      cwd,
      approvalPolicy,
      approvalsReviewer,
      sandboxPolicy,
      model,
      effort,
      summary,
      personality,
      outputSchema,
      collaborationMode,
    });
    return {
      ...result,
      runtimeTurnId: result.turn?.id,
    };
  }

  async interruptTurn({ threadId, turnId }) {
    return this.request("turn/interrupt", {
      threadId,
      turnId,
    });
  }

  async healthCheck() {
    const state = await this.start();
    return {
      healthy: true,
      command: this.command,
      codexHome: state.codexHome ?? null,
      transport: "app-server-jsonrpc",
      initialize: state.initializeResult,
    };
  }

  async close() {
    if (!this.processState?.child || this.processState.child.killed) {
      this.processState = null;
      this.startPromise = null;
      return;
    }

    const child = this.processState.child;
    child.kill("SIGTERM");
    this.processState = null;
    this.startPromise = null;
  }
}
