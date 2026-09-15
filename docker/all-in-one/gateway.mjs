import http from "node:http";
import { isIP } from "node:net";
import { pathToFileURL } from "node:url";

const hopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

function origin(value, name) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(`${name} must be an HTTP(S) origin.`);
  }
  return url;
}

function cleanHeaders(input) {
  const blocked = new Set(hopHeaders);
  for (const token of String(input.connection ?? "").split(","))
    blocked.add(token.trim().toLowerCase());
  return Object.fromEntries(
    Object.entries(input).filter(([key]) => !blocked.has(key.toLowerCase())),
  );
}

function reply(response, code) {
  response.writeHead(code, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(http.STATUS_CODES[code]);
}

function socketReply(socket, code) {
  socket.end(
    `HTTP/1.1 ${code} ${http.STATUS_CODES[code]}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
  );
}

/** A fixed two-upstream router. It never resolves a client-supplied address. */
export function createGateway({
  appUrl,
  previewBaseUrl,
  appPort = 3000,
  previewPort = 3001,
  trustProxy = false,
  upstreamTimeoutMs = 30_000,
  maxConnections = 1024,
}) {
  const app = origin(appUrl, "APP_URL");
  const preview = origin(previewBaseUrl, "PREVIEW_BASE_URL");
  if (app.protocol === "https:" && preview.protocol !== "https:") {
    throw new Error("An HTTPS application requires HTTPS previews.");
  }
  if (isIP(preview.hostname))
    throw new Error("PREVIEW_BASE_URL needs a hostname for session subdomains.");
  const sessionSuffix = `.${preview.hostname}`;
  // An application host can never occupy the preview-session namespace.
  if (
    app.hostname.endsWith(sessionSuffix) &&
    /^[a-f0-9]{48}$/.test(app.hostname.slice(0, -sessionSuffix.length))
  ) {
    throw new Error("APP_URL overlaps the preview-session namespace.");
  }
  for (const port of [appPort, previewPort]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error("Invalid internal port.");
  }
  const sockets = new Set();
  const upstreamSockets = new Set();
  let stopping = false;

  function route(request) {
    const host = request.headers.host?.toLowerCase();
    const hostCount = request.rawHeaders.filter(
      (_, index) => index % 2 === 0 && request.rawHeaders[index].toLowerCase() === "host",
    ).length;
    if (!host || hostCount !== 1 || /[\s/@\\?#]/.test(host)) return null;
    let authority;
    try {
      authority = new URL(`http://${host}`);
    } catch {
      return null;
    }
    if (authority.host !== host) return null;
    if (host === app.host) return { port: appPort, origin: app, host };
    const suffix = `.${preview.host}`;
    const label = host.endsWith(suffix) ? host.slice(0, -suffix.length) : "";
    return /^[a-f0-9]{48}$/.test(label) ? { port: previewPort, origin: preview, host } : null;
  }

  function allowedPath(request) {
    const path = request.url ?? "";
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return false;
    try {
      const pathname = decodeURIComponent(new URL(path, "http://gateway.invalid").pathname);
      // Registration is private even when a client knows the service credential.
      return !pathname.startsWith("/__repere/") || pathname === "/__repere/bridge.js";
    } catch {
      return false;
    }
  }

  function headers(request, destination, upgrade = false) {
    const outgoing = cleanHeaders(request.headers);
    for (const key of Object.keys(outgoing)) {
      if (key.startsWith("x-forwarded-") || key === "forwarded") delete outgoing[key];
    }
    const suppliedIp = String(request.headers["x-forwarded-for"] ?? "")
      .split(",", 1)[0]
      .trim();
    outgoing.host = destination.host;
    outgoing["x-forwarded-host"] = destination.host;
    outgoing["x-forwarded-proto"] = destination.origin.protocol.slice(0, -1);
    outgoing["x-forwarded-port"] =
      destination.origin.port || (destination.origin.protocol === "https:" ? "443" : "80");
    outgoing["x-forwarded-for"] =
      trustProxy && isIP(suppliedIp) ? suppliedIp : (request.socket.remoteAddress ?? "127.0.0.1");
    if (upgrade) {
      outgoing.connection = "Upgrade";
      outgoing.upgrade = "websocket";
    }
    return outgoing;
  }

  function requestUpstream(request, destination, upgrade = false) {
    const upstream = http.request({
      hostname: "127.0.0.1",
      port: destination.port,
      method: request.method,
      path: request.url,
      headers: headers(request, destination, upgrade),
      agent: false,
    });
    const timeout = setTimeout(
      () => upstream.destroy(new Error("Upstream response timeout")),
      upstreamTimeoutMs,
    );
    const clear = () => clearTimeout(timeout);
    upstream.once("response", clear);
    upstream.once("upgrade", clear);
    upstream.once("close", clear);
    upstream.once("socket", (socket) => {
      upstreamSockets.add(socket);
      socket.once("close", () => upstreamSockets.delete(socket));
    });
    return upstream;
  }

  const server = http.createServer({ maxHeaderSize: 32 * 1024 }, (request, response) => {
    if (stopping) {
      reply(response, 503);
      return;
    }
    const destination = route(request);
    if (!destination) {
      reply(response, 421);
      return;
    }
    if (!allowedPath(request)) {
      reply(response, 404);
      return;
    }
    const upstream = requestUpstream(request, destination);
    upstream.on("response", (source) => {
      response.writeHead(source.statusCode ?? 502, cleanHeaders(source.headers));
      source.on("error", () => response.destroy());
      source.pipe(response);
    });
    upstream.on("error", () => {
      if (response.headersSent) response.destroy();
      else if (!response.destroyed) reply(response, 502);
    });
    request.on("aborted", () => upstream.destroy());
    request.on("error", () => upstream.destroy());
    response.on("close", () => upstream.destroy());
    request.pipe(upstream);
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 15_000;
  server.maxHeadersCount = 100;
  server.on("connection", (socket) => {
    if (sockets.size >= maxConnections) {
      socket.destroy();
      return;
    }
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => socket.destroy());
  });
  server.on("connect", (_request, socket) => socketReply(socket, 405));
  server.on("upgrade", (request, client, head) => {
    const destination = route(request);
    if (
      stopping ||
      !destination ||
      !allowedPath(request) ||
      request.method !== "GET" ||
      request.headers.upgrade?.toLowerCase() !== "websocket"
    ) {
      socketReply(client, 403);
      return;
    }
    const upstream = requestUpstream(request, destination, true);
    let upgraded = false;
    client.once("close", () => upstream.destroy());
    upstream.on("error", () => {
      if (!client.destroyed) {
        if (upgraded) client.destroy();
        else socketReply(client, 502);
      }
    });
    upstream.once("response", (source) => {
      source.destroy();
      socketReply(client, 502);
    });
    upstream.once("upgrade", (response, socket, incomingHead) => {
      upgraded = true;
      if (client.destroyed) {
        socket.destroy();
        return;
      }
      const outgoing = cleanHeaders(response.headers);
      outgoing.connection = "Upgrade";
      outgoing.upgrade = "websocket";
      const serialized = Object.entries(outgoing)
        .flatMap(([name, value]) =>
          (Array.isArray(value) ? value : [value]).map((item) => `${name}: ${item}`),
        )
        .join("\r\n");
      client.write(`HTTP/1.1 101 Switching Protocols\r\n${serialized}\r\n\r\n`);
      if (incomingHead.length) client.write(incomingHead);
      if (head.length) socket.write(head);
      client.pipe(socket).pipe(client);
      socket.on("error", () => client.destroy());
      client.on("error", () => socket.destroy());
      socket.once("close", () => client.destroy());
      client.once("close", () => socket.destroy());
    });
    upstream.end();
  });

  return {
    server,
    async close() {
      stopping = true;
      for (const socket of sockets) socket.destroy();
      for (const socket of upstreamSockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const gateway = createGateway({
    appUrl: process.env.APP_URL ?? "http://localhost:8080",
    previewBaseUrl: process.env.PREVIEW_BASE_URL ?? "http://localhost:8080",
    trustProxy: process.env.TRUST_PROXY === "true",
  });
  gateway.server.listen(Number(process.env.PORT ?? 8080), "0.0.0.0", () =>
    console.info("Repere gateway ready."),
  );
  const stop = () => {
    void gateway.close();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
