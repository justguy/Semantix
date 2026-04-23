import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, relative, resolve } from "node:path";
import http from "node:http";
import { URL } from "node:url";

const MAIN_UI_ROUTE = "/index.html";
const LEGACY_UI_ROUTES = new Set([
  "/chat",
  "/chat/",
  "/canvas",
  "/canvas/",
  "/how-it-works",
  "/how-it-works/",
  "/Design/Semantix.html",
  "/Design/Semantix%20Chat.html",
  "/Design/Semantix%20Canvas.html",
  "/Design/Semantix%20How%20It%20Works.html",
]);
const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jsx": "application/javascript; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".svg": "image/svg+xml",
};

function json(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function sendSse(response, eventName, payload) {
  response.write(`event: ${eventName}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function redirect(response, location) {
  response.writeHead(302, {
    location,
  });
  response.end();
}

function routeMatch(pathname, method) {
  const parts = pathname.split("/").filter(Boolean);
  const [runs, runId, collection, item, child] = parts;

  if (method === "GET" && pathname === "/health") {
    return { name: "health" };
  }

  if (method === "GET" && pathname === "/runs") {
    return { name: "runs.list" };
  }

  if (method === "POST" && pathname === "/runs") {
    return { name: "runs.bootstrap" };
  }

  if (runs !== "runs" || !runId) {
    return null;
  }

  if (method === "PUT" && collection === "intent") {
    return { name: "intent.upsert", runId };
  }

  if (method === "POST" && collection === "compile") {
    return { name: "plan.compile", runId };
  }

  if (method === "GET" && collection === "artifact") {
    return { name: "artifact.get", runId };
  }

  if (method === "GET" && collection === "previews" && !item) {
    return { name: "preview.get", runId };
  }

  if (method === "GET" && collection === "events") {
    return { name: "events.stream", runId };
  }

  if (method === "GET" && collection === "sessions" && !item) {
    return { name: "sessions.list", runId };
  }

  if (method === "POST" && collection === "sessions" && !item) {
    return { name: "sessions.create", runId };
  }

  if (method === "GET" && collection === "sessions" && item && !child) {
    return { name: "session.get", runId, sessionId: item };
  }

  if (method === "GET" && collection === "sessions" && item && child === "turns") {
    return { name: "session.turns.list", runId, sessionId: item };
  }

  if (method === "POST" && collection === "sessions" && item && child === "turns") {
    return { name: "session.turns.submit", runId, sessionId: item };
  }

  if (method === "POST" && collection === "sessions" && item && child === "interrupt") {
    return { name: "session.interrupt", runId, sessionId: item };
  }

  if (method === "POST" && collection === "approvals") {
    return { name: "approvals.submit", runId };
  }

  if (method === "POST" && collection === "execute") {
    return { name: "execute.run", runId };
  }

  if (method === "POST" && collection === "pause") {
    return { name: "execute.pause", runId };
  }

  if (method === "POST" && collection === "resume") {
    return { name: "execute.resume", runId };
  }

  if (collection === "nodes" && item && method === "GET" && child === "inspector") {
    return { name: "node.inspect", runId, nodeId: item };
  }

  if (collection === "nodes" && item && method === "POST" && child === "interventions") {
    return { name: "node.intervene", runId, nodeId: item };
  }

  return null;
}

function getUiAlias(pathname) {
  if (pathname === "/") {
    return MAIN_UI_ROUTE;
  }

  if (LEGACY_UI_ROUTES.has(pathname)) {
    return MAIN_UI_ROUTE;
  }

  return pathname;
}

function decodePathSegment(segment) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

function resolveUiFilePath(uiDir, pathname) {
  if (!uiDir) {
    return null;
  }

  const aliasPath = getUiAlias(pathname);
  if (aliasPath !== pathname) {
    return {
      type: "redirect",
      location: aliasPath,
    };
  }

  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodePathSegment(segment));

  if (segments.length === 0 || segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  const rootDir = resolve(uiDir);
  const filePath = resolve(rootDir, ...segments);
  const relativePath = relative(rootDir, filePath);

  if (relativePath.startsWith("..")) {
    return null;
  }

  return {
    type: "file",
    filePath,
  };
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

async function serveStatic({ request, response, uiDir, pathname }) {
  const target = resolveUiFilePath(uiDir, pathname);

  if (!target) {
    return false;
  }

  if (target.type === "redirect") {
    redirect(response, target.location);
    return true;
  }

  let fileStat;
  try {
    fileStat = await stat(target.filePath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }

  if (!fileStat.isFile()) {
    return false;
  }

  response.writeHead(200, {
    "cache-control": "no-store",
    "content-length": fileStat.size,
    "content-type": contentTypeFor(target.filePath),
  });

  if (request.method === "HEAD") {
    response.end();
    return true;
  }

  await new Promise((resolveStream, rejectStream) => {
    const stream = createReadStream(target.filePath);
    stream.on("end", resolveStream);
    stream.on("error", rejectStream);
    stream.pipe(response);
  });
  return true;
}

function handleError(response, error) {
  if (error?.code === "STALE_STATE") {
    return json(response, 409, {
      error: error.code,
      message: error.message,
      details: error.details,
    });
  }

  if (error?.code === "NOT_FOUND") {
    return json(response, 404, {
      error: error.code,
      message: error.message,
      details: error.details,
    });
  }

  if (error?.code === "VALIDATION_ERROR") {
    return json(response, 400, {
      error: error.code,
      message: error.message,
      details: error.details,
    });
  }

  return json(response, 500, {
    error: "INTERNAL_ERROR",
    message: error?.message ?? "Unexpected server error.",
  });
}

export function createControlPlaneServer({ service, uiDir, defaultRunCwd }) {
  if (!service) {
    throw new Error("createControlPlaneServer requires a ControlPlaneService instance.");
  }

  return http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const match = routeMatch(url.pathname, request.method);

    if (!match) {
      if ((request.method === "GET" || request.method === "HEAD") && (await serveStatic({
        request,
        response,
        uiDir,
        pathname: url.pathname,
      }))) {
        return undefined;
      }

      return json(response, 404, {
        error: "NOT_FOUND",
        message: "Route not found.",
      });
    }

    try {
      if (match.name === "health") {
        return json(response, 200, {
          status: "ok",
        });
      }

      if (match.name === "runs.list") {
        return json(response, 200, await service.listRuns());
      }

      if (match.name === "events.stream") {
        const afterSequence = Number(url.searchParams.get("after") ?? 0);
        const sessionIdFilter = url.searchParams.get("sessionId") ?? undefined;
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });

        sendSse(response, "ping", {
          type: "ping",
          runId: match.runId,
        });

        const backlog = await service.listEvents({
          runId: match.runId,
          afterSequence: Number.isFinite(afterSequence) ? afterSequence : 0,
          sessionId: sessionIdFilter,
        });
        for (const event of backlog) {
          sendSse(response, "run-event", event);
        }

        const unsubscribe = service.subscribe(match.runId, (event) => {
          if (sessionIdFilter && event.sessionId !== sessionIdFilter) {
            return;
          }
          sendSse(response, "run-event", event);
        });

        request.on("close", () => {
          unsubscribe();
          response.end();
        });

        return undefined;
      }

      const body =
        request.method === "GET" || request.method === "HEAD"
          ? {}
          : await readJsonBody(request);

      if (match.name === "runs.bootstrap") {
        return json(
          response,
          200,
          await service.bootstrapRun({
            ...body,
            cwd: body.cwd ?? defaultRunCwd,
          }),
        );
      }

      if (match.name === "intent.upsert") {
        return json(
          response,
          200,
          await service.createOrUpdateIntent({
            runId: match.runId,
            ...body,
          }),
        );
      }

      if (match.name === "plan.compile") {
        return json(
          response,
          200,
          await service.compilePlan({
            runId: match.runId,
            ...body,
            cwd: body.cwd ?? defaultRunCwd,
          }),
        );
      }

      if (match.name === "artifact.get") {
        return json(response, 200, await service.getCurrentArtifact(match.runId));
      }

      if (match.name === "preview.get") {
        return json(
          response,
          200,
          await service.getPreviewByRef({
            runId: match.runId,
            previewRef:
              url.searchParams.get("previewRef") ??
              url.searchParams.get("ref") ??
              url.searchParams.get("preview") ??
              "",
          }),
        );
      }

      if (match.name === "sessions.list") {
        return json(
          response,
          200,
          await service.listSessions({
            runId: match.runId,
          }),
        );
      }

      if (match.name === "sessions.create") {
        return json(
          response,
          200,
          await service.createSession({
            runId: match.runId,
            ...body,
          }),
        );
      }

      if (match.name === "session.get") {
        return json(
          response,
          200,
          await service.getSession({
            runId: match.runId,
            sessionId: match.sessionId,
            includeTurns:
              url.searchParams.get("includeTurns") === "1" ||
              url.searchParams.get("includeTurns") === "true",
            sync: url.searchParams.get("sync") === "1" || url.searchParams.get("sync") === "true",
          }),
        );
      }

      if (match.name === "session.turns.list") {
        return json(
          response,
          200,
          await service.listSessionTurns({
            runId: match.runId,
            sessionId: match.sessionId,
          }),
        );
      }

      if (match.name === "session.turns.submit") {
        return json(
          response,
          200,
          await service.submitSessionTurn({
            runId: match.runId,
            sessionId: match.sessionId,
            ...body,
          }),
        );
      }

      if (match.name === "session.interrupt") {
        return json(
          response,
          200,
          await service.interruptSession({
            runId: match.runId,
            sessionId: match.sessionId,
            ...body,
          }),
        );
      }

      if (match.name === "node.inspect") {
        return json(
          response,
          200,
          await service.getNodeInspectorPayload({
            runId: match.runId,
            nodeId: match.nodeId,
          }),
        );
      }

      if (match.name === "node.intervene") {
        return json(
          response,
          200,
          await service.submitIntervention({
            runId: match.runId,
            nodeId: match.nodeId,
            ...body,
          }),
        );
      }

      if (match.name === "approvals.submit") {
        return json(
          response,
          200,
          await service.submitApprovalAction({
            runId: match.runId,
            ...body,
          }),
        );
      }

      if (match.name === "execute.run") {
        return json(
          response,
          200,
          await service.executeApprovedNodes({
            runId: match.runId,
            ...body,
          }),
        );
      }

      if (match.name === "execute.pause") {
        return json(
          response,
          200,
          await service.pauseRun({
            runId: match.runId,
            ...body,
          }),
        );
      }

      if (match.name === "execute.resume") {
        return json(
          response,
          200,
          await service.resumeFromCheckpoint({
            runId: match.runId,
            ...body,
          }),
        );
      }

      return json(response, 404, {
        error: "NOT_FOUND",
        message: "Route not found.",
      });
    } catch (error) {
      return handleError(response, error);
    }
  });
}
