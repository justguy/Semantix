import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

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

async function defaultRunner({
  command,
  args,
  input,
  cwd,
  env,
  signal,
  onStdoutLine,
  onStderrLine,
  onJsonMessage,
}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBuffer = "";
    let stderrBuffer = "";

    const flushLines = (buffer, emitter) => {
      const parts = buffer.split(/\r?\n/);
      const pending = parts.pop() ?? "";

      for (const line of parts) {
        emitter(line);
      }

      return pending;
    };

    const handleStdoutLine = (line) => {
      onStdoutLine?.(line);
      const parsed = tryParseJson(line);
      if (parsed !== null) {
        onJsonMessage?.(parsed);
      }
    };

    const handleStderrLine = (line) => {
      onStderrLine?.(line);
    };

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      stdoutBuffer += text;
      stdoutBuffer = flushLines(stdoutBuffer, handleStdoutLine);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      stderrBuffer += text;
      stderrBuffer = flushLines(stderrBuffer, handleStderrLine);
    });

    const abortHandler = () => {
      child.kill("SIGTERM");
    };

    if (signal) {
      if (signal.aborted) {
        abortHandler();
      } else {
        signal.addEventListener("abort", abortHandler, { once: true });
      }
    }

    child.on("error", reject);
    child.on("close", (exitCode) => {
      if (signal) {
        signal.removeEventListener?.("abort", abortHandler);
      }

      if (stdoutBuffer) {
        handleStdoutLine(stdoutBuffer);
      }
      if (stderrBuffer) {
        handleStderrLine(stderrBuffer);
      }

      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });

    if (input) {
      child.stdin.write(input);
    }

    child.stdin.end();
  });
}

export class CodexCliConnector {
  constructor({
    runner = defaultRunner,
    command = process.env.SEMANTIX_CODEX_COMMAND ?? "codex",
    baseArgs = [],
    cwd = process.cwd(),
    env = process.env,
    codexHome = process.env.SEMANTIX_CODEX_HOME,
    configProfile = process.env.SEMANTIX_CODEX_CONFIG_PROFILE,
    model = process.env.SEMANTIX_CODEX_MODEL,
    approvalPolicy = process.env.SEMANTIX_CODEX_APPROVAL_POLICY ?? "never",
    sandboxMode = process.env.SEMANTIX_CODEX_SANDBOX_MODE ?? "workspace-write",
    skipGitRepoCheck = process.env.SEMANTIX_CODEX_SKIP_GIT_REPO_CHECK !== "false",
    rawOverrides = {},
  } = {}) {
    this.runner = runner;
    this.command = command;
    this.baseArgs = baseArgs;
    this.cwd = cwd;
    this.env = env;
    this.codexHome = codexHome;
    this.configProfile = configProfile;
    this.model = model;
    this.approvalPolicy = approvalPolicy;
    this.sandboxMode = sandboxMode;
    this.skipGitRepoCheck = skipGitRepoCheck;
    this.rawOverrides = rawOverrides;
  }

  async ensureCodexHome(codexHome) {
    if (!codexHome) {
      return undefined;
    }

    await mkdir(codexHome, { recursive: true });
    await mkdir(join(codexHome, "sessions"), { recursive: true });
    return codexHome;
  }

  buildInvocation({
    cwd,
    input,
    model,
    configProfile,
    approvalPolicy,
    sandboxMode,
    rawOverrides = {},
  }) {
    const args = ["exec", ...this.baseArgs];
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

    if (this.skipGitRepoCheck) {
      args.push("--skip-git-repo-check");
    }

    for (const [key, value] of normalizeOverrideEntries(effectiveOverrides)) {
      args.push("-c", `${key}=${value}`);
    }

    return {
      command: this.command,
      args,
      cwd: cwd ?? this.cwd,
      input,
    };
  }

  buildExecutionEnvironment({
    codexHome,
    env = {},
  } = {}) {
    const merged = {
      ...this.env,
      ...env,
    };

    if (codexHome) {
      merged.CODEX_HOME = codexHome;
    }

    return merged;
  }

  normalizeResult(invocation, result, jsonMessages) {
    const trimmedStdout = result.stdout.trim();
    const finalJsonObject = tryParseJson(trimmedStdout) ?? jsonMessages.at(-1) ?? null;

    return {
      command: invocation.command,
      args: invocation.args,
      cwd: invocation.cwd,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      jsonMessages,
      finalJsonObject,
    };
  }

  async execute({
    input,
    cwd,
    env,
    signal,
    context,
    model,
    configProfile,
    approvalPolicy,
    sandboxMode,
    rawOverrides,
    onStdoutLine,
    onStderrLine,
    onJsonMessage,
  }) {
    const codexHome = await this.ensureCodexHome(env?.CODEX_HOME ?? this.codexHome);
    const invocation = this.buildInvocation({
      cwd,
      input,
      model,
      configProfile,
      approvalPolicy,
      sandboxMode,
      rawOverrides,
    });
    const jsonMessages = [];

    const result = await this.runner({
      ...invocation,
      env: this.buildExecutionEnvironment({
        codexHome,
        env,
      }),
      ...(context ?? {}),
      signal,
      onStdoutLine,
      onStderrLine,
      onJsonMessage: (message) => {
        jsonMessages.push(message);
        onJsonMessage?.(message);
      },
    });

    return this.normalizeResult(invocation, result, jsonMessages);
  }

  async healthCheck() {
    const codexHome = await this.ensureCodexHome(this.codexHome);
    const result = await this.runner({
      command: this.command,
      args: ["exec", "--version"],
      cwd: this.cwd,
      env: this.buildExecutionEnvironment({
        codexHome,
      }),
    });

    return {
      healthy: result.exitCode === 0,
      command: this.command,
      version: result.stdout.trim() || result.stderr.trim() || null,
      codexHome: codexHome ?? null,
    };
  }
}
