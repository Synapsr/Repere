import "dotenv/config";
import http, {
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolveLocale, type Locale } from "../shared/locale";
import { previewMessage } from "./messages";
import type { PreviewConfig, PreviewSession } from "../shared/preview";
import { normalizeHost, validateNavigation, type Resolver } from "./network";
import { rewriteCss, rewriteHtml } from "./rewrite";
import {
  canonicalTarget,
  openUpstream,
  openUpstreamWebSocket,
  readTextResponse,
  rewriteCookie,
  stripHopHeaders,
  upstreamHeaders,
} from "./transport";

export type PreviewServerOptions = {
  secret: string;
  appUrl: string;
  previewBaseUrl: string;
  allowedPrivateHosts?: ReadonlySet<string>;
  resolver?: Resolver;
  bridgePath?: string;
  bridgeSource?: string;
  maxSessions?: number;
  sessionTtlMs?: number;
  maxHtmlBytes?: number;
  now?: () => number;
};
type ActiveSession = PreviewSession & { projectId: string; userId: string; locale: Locale };
const maximumControlBody = 8192;
const maximumUploadBytes = 25 * 1024 * 1024;

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(value));
}

function authorized(request: IncomingMessage, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(request.headers.authorization ?? "");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

async function readControlBody(
  request: IncomingMessage,
): Promise<{ url: string; projectId: string; userId: string }> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumControlBody) throw new Error("Registration body too large");
    chunks.push(buffer);
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object") throw new Error("Invalid registration");
  const value = body as Record<string, unknown>;
  if (
    typeof value.url !== "string" ||
    value.url.length > 4096 ||
    typeof value.projectId !== "string" ||
    !value.projectId ||
    value.projectId.length > 100 ||
    typeof value.userId !== "string" ||
    !value.userId ||
    value.userId.length > 100
  )
    throw new Error("Invalid registration");
  return { url: value.url, projectId: value.projectId, userId: value.userId };
}

export async function createPreviewServer(options: PreviewServerOptions) {
  if (options.secret.length < 32) throw new Error("PROXY_SECRET must have at least 32 characters");
  const appOrigin = new URL(options.appUrl).origin;
  const baseUrl = new URL(options.previewBaseUrl);
  if (
    !["http:", "https:"].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.pathname !== "/" ||
    baseUrl.search ||
    baseUrl.hash
  )
    throw new Error("PREVIEW_BASE_URL must be an HTTP(S) origin");
  if (baseUrl.protocol !== "https:" && baseUrl.hostname !== "localhost")
    throw new Error("Use HTTPS for preview domains, or localhost for local development");
  const bridge =
    options.bridgeSource ??
    (await readFile(options.bridgePath ?? new URL("./dist/bridge.js", import.meta.url), "utf8"));
  const sessions = new Map<string, ActiveSession>();
  const sockets = new Set<Duplex>();
  const now = options.now ?? Date.now;
  const maxSessions = Math.max(1, Math.min(1000, options.maxSessions ?? 100));
  const sessionTtl = Math.max(1000, Math.min(3_600_000, options.sessionTtlMs ?? 3_600_000));
  const maxHtmlBytes = Math.max(
    1024,
    Math.min(32 * 1024 * 1024, options.maxHtmlBytes ?? 8 * 1024 * 1024),
  );
  const allowedPrivateHosts = new Set(Array.from(options.allowedPrivateHosts ?? [], normalizeHost));
  const transport = { allowedPrivateHosts, resolver: options.resolver };
  let pendingSessions = 0;
  let activeRequests = 0;
  let closing = false;
  const expireSessions = () => {
    for (const [id, session] of sessions)
      if (Date.parse(session.expiresAt) <= now()) sessions.delete(id);
  };
  const cleanupTimer = setInterval(expireSessions, 60_000);
  cleanupTimer.unref();

  function sessionFor(request: IncomingMessage): ActiveSession | undefined {
    const host = request.headers.host?.toLowerCase() ?? "";
    const id = /^([a-f0-9]{48})\./.exec(host)?.[1];
    if (!id) return;
    const session = sessions.get(id);
    if (!session || new URL(session.origin).host !== host) return;
    if (Date.parse(session.expiresAt) <= now()) {
      sessions.delete(id);
      return;
    }
    return session;
  }

  function siteHeaders(source: IncomingMessage, session: ActiveSession): OutgoingHttpHeaders {
    const headers = stripHopHeaders(source.headers);
    // The target may set policies for its own host; apply the policy for this isolated preview instead.
    for (const name of [
      "content-security-policy",
      "content-security-policy-report-only",
      "x-frame-options",
      "clear-site-data",
      "strict-transport-security",
      "alt-svc",
      "report-to",
      "nel",
      "refresh",
      "access-control-allow-origin",
      "access-control-allow-credentials",
      "cross-origin-opener-policy",
      "cross-origin-embedder-policy",
      "cross-origin-resource-policy",
    ])
      delete headers[name];
    headers["content-security-policy"] = `frame-ancestors ${appOrigin}`;
    headers["referrer-policy"] = "no-referrer";
    headers["x-content-type-options"] = "nosniff";
    // Private previews must never become public CDN cache entries.
    headers["cache-control"] = "private, no-store";
    if (source.headers["set-cookie"])
      headers["set-cookie"] = source.headers["set-cookie"]
        .map(rewriteCookie)
        .filter((cookie): cookie is string => cookie !== null);
    const upstreamOrigin = source.headers["access-control-allow-origin"];
    if (upstreamOrigin === "*" || upstreamOrigin === new URL(session.targetUrl).origin) {
      headers["access-control-allow-origin"] = upstreamOrigin === "*" ? "*" : session.origin;
      if (source.headers["access-control-allow-credentials"] === "true")
        headers["access-control-allow-credentials"] = "true";
    }
    return headers;
  }

  async function servePreview(
    request: IncomingMessage,
    response: ServerResponse,
    session: ActiveSession,
  ) {
    const message = (key: Parameters<typeof previewMessage>[1]) =>
      previewMessage(session.locale, key);
    const requested = new URL(request.url ?? "/", session.origin);
    if (requested.origin !== session.origin) {
      json(response, 400, { error: message("invalidRequest") });
      return;
    }
    if (requested.pathname === "/__repere/bridge.js") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        json(response, 405, { error: message("methodNotAllowed") });
        return;
      }
      response.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-length": Buffer.byteLength(bridge),
      });
      response.end(request.method === "HEAD" ? undefined : bridge);
      return;
    }
    if (requested.pathname.startsWith("/__repere/")) {
      json(response, 404, { error: message("unknownEndpoint") });
      return;
    }
    if (
      !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(request.method ?? "")
    ) {
      json(response, 405, { error: message("methodNotAllowed") });
      return;
    }
    const target = new URL(
      `${requested.pathname}${requested.search}`,
      new URL(session.targetUrl).origin,
    );
    const length = Number(request.headers["content-length"] ?? 0);
    if (!Number.isFinite(length) || length > maximumUploadBytes) {
      json(response, 413, { error: message("uploadTooLarge") });
      return;
    }
    const headers = upstreamHeaders(request.headers, target, session.origin);
    // This service credential can only authenticate the control API, never an upstream website.
    if (headers.authorization === `Bearer ${options.secret}`) delete headers.authorization;
    // Do not allow a cached unmodified HTML response to skip bridge injection.
    delete headers["if-none-match"];
    delete headers["if-modified-since"];
    const upstream = await openUpstream(target, {
      ...transport,
      method: request.method,
      headers,
      body: request,
    });
    const expires = setTimeout(
      () => {
        upstream.destroy();
        response.destroy();
      },
      Math.max(1, Date.parse(session.expiresAt) - now()),
    );
    response.once("close", () => {
      clearTimeout(expires);
      upstream.destroy();
    });
    response.once("finish", () => clearTimeout(expires));
    const status = upstream.statusCode ?? 502;
    const outgoing = siteHeaders(upstream, session);
    if (upstream.headers.location) {
      try {
        const location = new URL(upstream.headers.location, target);
        if (
          !["http:", "https:"].includes(location.protocol) ||
          location.username ||
          location.password
        )
          throw new Error("Unsafe redirect");
        if (location.origin === target.origin)
          outgoing.location = `${session.origin}${location.pathname}${location.search}${location.hash}`;
        else {
          // Keep the annotation frame on its registered origin. The reader may open external links explicitly.
          upstream.destroy();
          const config: PreviewConfig = {
            appOrigin,
            targetOrigin: target.origin,
            channel: session.channel,
            locale: session.locale,
            servicePage: "redirect",
          };
          const escaped = location.href
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;");
          const html = rewriteHtml(
            `<!doctype html><html lang="${session.locale}"><head><meta name="repere-service-page" content="redirect"><title data-repere-message="redirectTitle">${message("redirectTitle")}</title></head><body style="font-family:system-ui;padding:3rem;color:#202331"><h1 data-repere-message="redirectHeading">${message("redirectHeading")}</h1><p><a style="color:#3657e8" href="${escaped}" target="_blank" rel="noopener noreferrer" data-repere-message="redirectLink">${message("redirectLink")}</a></p><p data-repere-message="redirectHint">${message("redirectHint")}</p></body></html>`,
            target.origin,
            session.origin,
            config,
          );
          delete outgoing.location;
          delete outgoing["content-encoding"];
          delete outgoing.etag;
          outgoing["content-type"] = "text/html; charset=utf-8";
          outgoing["content-length"] = Buffer.byteLength(html);
          response.writeHead(200, outgoing);
          response.end(request.method === "HEAD" ? undefined : html);
          return;
        }
      } catch {
        upstream.destroy();
        json(response, 502, { error: message("unsafeRedirect") });
        return;
      }
    }
    const contentType = String(upstream.headers["content-type"] ?? "");
    const htmlContent = /^text\/html\b/i.test(contentType);
    const cssContent = /^text\/css\b/i.test(contentType);
    if (
      (htmlContent || cssContent) &&
      request.method !== "HEAD" &&
      status !== 204 &&
      status !== 206 &&
      status !== 304 &&
      !outgoing.location
    ) {
      const original = await readTextResponse(upstream, maxHtmlBytes);
      const html = htmlContent
        ? rewriteHtml(original, target.origin, session.origin, {
            appOrigin,
            targetOrigin: target.origin,
            channel: session.channel,
            locale: session.locale,
          })
        : rewriteCss(original, target.origin, session.origin);
      for (const header of [
        "content-encoding",
        "etag",
        "content-md5",
        "digest",
        "content-range",
        "accept-ranges",
      ])
        delete outgoing[header];
      outgoing["content-type"] = htmlContent
        ? "text/html; charset=utf-8"
        : "text/css; charset=utf-8";
      outgoing["content-length"] = Buffer.byteLength(html);
      response.writeHead(status, outgoing);
      response.end(html);
    } else {
      // Native JavaScript, images, PDFs, ranges, compressed assets and SSE retain their original bytes.
      response.writeHead(status, outgoing);
      upstream.on("error", () => response.destroy());
      upstream.pipe(response);
    }
  }

  const server = http.createServer(async (request, response) => {
    const session = sessionFor(request);
    const locale =
      session?.locale ??
      resolveLocale({
        get: (name) =>
          name === "accept-language" ? String(request.headers["accept-language"] ?? "") : null,
      });
    const message = (key: Parameters<typeof previewMessage>[1]) => previewMessage(locale, key);
    if (closing) {
      json(response, 503, { error: message("stopping") });
      return;
    }
    const looksLikeSession = /^[a-f0-9]{48}\./.test(request.headers.host ?? "");
    // Reserved endpoints on a session host never expose the control plane.
    if (!session && !looksLikeSession && request.url === "/health" && request.method === "GET") {
      expireSessions();
      json(response, 200, { ok: true, sessions: sessions.size, capacity: maxSessions });
      return;
    }
    if (
      !session &&
      !looksLikeSession &&
      request.url === "/__repere/sessions" &&
      request.method === "POST"
    ) {
      if (!authorized(request, options.secret)) {
        json(response, 401, { error: message("unauthorized") });
        return;
      }
      expireSessions();
      if (sessions.size + pendingSessions >= maxSessions) {
        json(response, 503, { error: message("capacity") });
        return;
      }
      pendingSessions++;
      try {
        const body = await readControlBody(request);
        const target = await canonicalTarget(validateNavigation(body.url), transport);
        const id = randomBytes(24).toString("hex");
        const preview = new URL(baseUrl);
        preview.hostname = `${id}.${baseUrl.hostname}`;
        const origin = preview.origin;
        const result: PreviewSession = {
          url: `${origin}${target.pathname}${target.search}${target.hash}`,
          origin,
          targetUrl: target.href,
          channel: randomBytes(16).toString("hex"),
          expiresAt: new Date(now() + sessionTtl).toISOString(),
        };
        sessions.set(id, { ...result, projectId: body.projectId, userId: body.userId, locale });
        json(response, 201, result);
      } catch {
        if (!response.destroyed)
          json(response, 400, {
            error: message("openFailed"),
          });
      } finally {
        pendingSessions--;
      }
      return;
    }
    if (!session) {
      json(response, 404, {
        error: message("expired"),
      });
      return;
    }
    if (activeRequests >= 200) {
      json(response, 503, { error: message("capacity") });
      return;
    }
    activeRequests++;
    let completed = false;
    const finish = () => {
      if (!completed) {
        completed = true;
        activeRequests--;
      }
    };
    response.once("close", finish);
    response.once("finish", finish);
    try {
      await servePreview(request, response, session);
    } catch {
      if (!response.destroyed) {
        if (response.headersSent) response.destroy();
        else
          json(response, 502, {
            error: message("upstreamFailed"),
          });
      }
    }
  });
  server.requestTimeout = 30_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 100;
  server.on("connection", (socket) => {
    if (sockets.size >= 500) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  server.on("upgrade", async (request, client, head) => {
    const session = sessionFor(request);
    if (!session || request.headers.upgrade?.toLowerCase() !== "websocket") {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const controller = new AbortController();
    client.once("close", () => controller.abort());
    try {
      const path = new URL(request.url ?? "/", session.origin);
      if (path.origin !== session.origin || path.pathname.startsWith("/__repere/"))
        throw new Error("Invalid WebSocket path");
      const target = new URL(`${path.pathname}${path.search}`, new URL(session.targetUrl).origin);
      const headers = upstreamHeaders(request.headers, target, session.origin);
      if (headers.authorization === `Bearer ${options.secret}`) delete headers.authorization;
      const upgraded = await openUpstreamWebSocket(target, headers, {
        ...transport,
        signal: controller.signal,
      });
      const upstream = upgraded.socket;
      if (client.destroyed) {
        upstream.destroy();
        return;
      }
      sockets.add(upstream);
      const outgoing = siteHeaders(upgraded.response, session);
      outgoing.connection = "Upgrade";
      outgoing.upgrade = "websocket";
      const serialized = Object.entries(outgoing)
        .filter((entry) => entry[1] !== undefined)
        .flatMap(([name, value]) => {
          return (Array.isArray(value) ? value : [value]).map((item) => `${name}: ${item}`);
        })
        .join("\r\n");
      client.write(`HTTP/1.1 101 Switching Protocols\r\n${serialized}\r\n\r\n`);
      if (upgraded.head.length) client.write(upgraded.head);
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
      const expires = setTimeout(
        () => {
          upstream.destroy();
          client.destroy();
        },
        Math.max(1, Date.parse(session.expiresAt) - now()),
      );
      upstream.once("close", () => {
        clearTimeout(expires);
        sockets.delete(upstream);
        client.destroy();
      });
      client.once("close", () => upstream.destroy());
      client.on("error", () => upstream.destroy());
      upstream.on("error", () => client.destroy());
    } catch {
      if (!client.destroyed) client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
    }
  });
  return {
    server,
    close: async () => {
      closing = true;
      clearInterval(cleanupTimer);
      sessions.clear();
      for (const socket of sockets) socket.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function main() {
  const service = await createPreviewServer({
    secret: process.env.PROXY_SECRET ?? "",
    appUrl: process.env.APP_URL ?? "http://localhost:3000",
    previewBaseUrl: process.env.PREVIEW_BASE_URL ?? "http://localhost:3001",
    allowedPrivateHosts: new Set(
      (process.env.PREVIEW_ALLOWED_PRIVATE_HOSTS ?? "")
        .split(",")
        .map((value) => normalizeHost(value.trim()))
        .filter(Boolean),
    ),
    bridgePath: process.env.PREVIEW_BRIDGE_PATH,
    maxSessions: Number(process.env.PREVIEW_MAX_SESSIONS ?? 100),
    sessionTtlMs: Number(process.env.PREVIEW_SESSION_TTL_MS ?? 3_600_000),
    maxHtmlBytes: Number(process.env.PREVIEW_MAX_HTML_BYTES ?? 8 * 1024 * 1024),
  });
  const port = Number(process.env.PORT ?? 3001);
  service.server.listen(port, process.env.PREVIEW_BIND_HOST ?? "0.0.0.0", () =>
    console.info(`Repere native preview listening on :${port}`),
  );
  const shutdown = () => {
    void service.close();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error: unknown) => {
    console.error(
      "Preview startup failed:",
      error instanceof Error ? error.message : "Unknown error",
    );
    process.exitCode = 1;
  });
}
