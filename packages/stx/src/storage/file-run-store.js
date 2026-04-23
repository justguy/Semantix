import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

function parseJsonLines(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function atomicWriteJson(path, value) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });

  const temporaryPath = `${path}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
}

async function appendJsonLine(path, value) {
  const directory = dirname(path);
  await mkdir(directory, { recursive: true });
  await writeFile(path, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    flag: "a",
  });
}

export class FileRunStore {
  constructor({ rootDir = join(process.cwd(), "data") } = {}) {
    this.rootDir = rootDir;
  }

  get runsDir() {
    return join(this.rootDir, "runs");
  }

  get auditDir() {
    return join(this.rootDir, "audit");
  }

  get eventsDir() {
    return join(this.rootDir, "events");
  }

  get sessionsDir() {
    return join(this.rootDir, "sessions");
  }

  get sessionTurnsDir() {
    return join(this.rootDir, "session-turns");
  }

  getRunPath(runId) {
    return join(this.runsDir, `${runId}.json`);
  }

  getAuditPath(runId) {
    return join(this.auditDir, `${runId}.jsonl`);
  }

  getEventsPath(runId) {
    return join(this.eventsDir, `${runId}.jsonl`);
  }

  getSessionPath(runId, sessionId) {
    return join(this.sessionsDir, runId, `${sessionId}.json`);
  }

  getSessionTurnsPath(runId, sessionId) {
    return join(this.sessionTurnsDir, runId, `${sessionId}.jsonl`);
  }

  async ensureReady() {
    await Promise.all([
      mkdir(this.runsDir, { recursive: true }),
      mkdir(this.auditDir, { recursive: true }),
      mkdir(this.eventsDir, { recursive: true }),
      mkdir(this.sessionsDir, { recursive: true }),
      mkdir(this.sessionTurnsDir, { recursive: true }),
    ]);
  }

  async getRun(runId) {
    await this.ensureReady();
    const path = this.getRunPath(runId);

    if (!(await fileExists(path))) {
      return null;
    }

    const content = await readFile(path, "utf8");
    return JSON.parse(content);
  }

  async saveRun(runState) {
    await this.ensureReady();
    await atomicWriteJson(this.getRunPath(runState.runId), runState);
    return runState;
  }

  async listRuns() {
    await this.ensureReady();
    const entries = await readdir(this.runsDir, {
      withFileTypes: true,
    });

    const runIds = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -".json".length))
      .sort((left, right) => left.localeCompare(right));

    return Promise.all(runIds.map((runId) => this.getRun(runId)));
  }

  async appendAuditRecord(runId, record) {
    await this.ensureReady();
    await appendJsonLine(this.getAuditPath(runId), record);
    return record;
  }

  async appendRunEvent(runId, event) {
    await this.ensureReady();
    await appendJsonLine(this.getEventsPath(runId), event);
    return event;
  }

  async listAuditRecords(runId) {
    await this.ensureReady();
    const path = this.getAuditPath(runId);

    if (!(await fileExists(path))) {
      return [];
    }

    return parseJsonLines(await readFile(path, "utf8"));
  }

  async listRunEvents(runId) {
    await this.ensureReady();
    const path = this.getEventsPath(runId);

    if (!(await fileExists(path))) {
      return [];
    }

    return parseJsonLines(await readFile(path, "utf8"));
  }

  async getSession(runId, sessionId) {
    await this.ensureReady();
    const path = this.getSessionPath(runId, sessionId);

    if (!(await fileExists(path))) {
      return null;
    }

    return JSON.parse(await readFile(path, "utf8"));
  }

  async saveSession(session) {
    await this.ensureReady();
    await atomicWriteJson(this.getSessionPath(session.runId, session.sessionId), session);
    return session;
  }

  async listSessions(runId) {
    await this.ensureReady();
    const directory = join(this.sessionsDir, runId);

    if (!(await fileExists(directory))) {
      return [];
    }

    const entries = await readdir(directory, {
      withFileTypes: true,
    });

    const sessionIds = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => entry.name.slice(0, -".json".length))
      .sort((left, right) => left.localeCompare(right));

    return Promise.all(sessionIds.map((sessionId) => this.getSession(runId, sessionId)));
  }

  async appendSessionTurn(runId, sessionId, turn) {
    await this.ensureReady();
    await appendJsonLine(this.getSessionTurnsPath(runId, sessionId), turn);
    return turn;
  }

  async listSessionTurns(runId, sessionId) {
    await this.ensureReady();
    const path = this.getSessionTurnsPath(runId, sessionId);

    if (!(await fileExists(path))) {
      return [];
    }

    const turns = parseJsonLines(await readFile(path, "utf8"));
    const latestByTurnId = new Map();

    for (const turn of turns) {
      latestByTurnId.set(turn.turnId, turn);
    }

    return [...latestByTurnId.values()].sort((left, right) => left.sequence - right.sequence);
  }
}
