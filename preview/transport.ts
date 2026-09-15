import http, {
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
} from "node:http";
import https from "node:https";
import { promisify } from "node:util";
import type { Duplex } from "node:stream";
import { brotliDecompress, gunzip, inflate } from "node:zlib";
import { resolveDestination, type Resolver } from "./network";

const decompressGzip = promisify(gunzip);
const decompressBrotli = promisify(brotliDecompress);
const decompressDeflate = promisify(inflate);
const hopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

export function stripHopHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const connectionHeaders = new Set(
    String(headers.connection ?? "")
      .toLowerCase()
      .split(",")
      .map((value) => value.trim()),
  );
  return Object.fromEntries(
    Object.entries(headers).filter(
      ([name]) => !hopHeaders.has(name) && !connectionHeaders.has(name),
    ),
  );
}

export function upstreamHeaders(
  headers: IncomingHttpHeaders,
  target: URL,
  previewOrigin: string,
): OutgoingHttpHeaders {
  const result = stripHopHeaders(headers);
  result.host = target.host;
  for (const name of Object.keys(result)) {
    if (name === "forwarded" || name.startsWith("x-forwarded-") || name.startsWith("x-repere-"))
      delete result[name];
  }
  if (result.origin === previewOrigin) result.origin = target.origin;
  if (typeof result.referer === "string") {
    try {
      const referer = new URL(result.referer);
      if (referer.origin !== previewOrigin) delete result.referer;
      else result.referer = `${target.origin}${referer.pathname}${referer.search}`;
    } catch {
      delete result.referer;
    }
  }
  return result;
}

export type TransportOptions = {
  allowedPrivateHosts?: ReadonlySet<string>;
  resolver?: Resolver;
  timeoutMs?: number;
};

/** DNS is resolved and validated once. The socket uses that numeric address, retaining Host and TLS SNI. */
export async function openUpstream(
  target: URL,
  options: TransportOptions & {
    method?: string;
    headers?: OutgoingHttpHeaders;
    body?: IncomingMessage;
  } = {},
): Promise<IncomingMessage> {
  const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
  const address = await resolveDestination(
    target.hostname,
    port,
    options.allowedPrivateHosts,
    options.resolver,
  );
  return new Promise((resolve, reject) => {
    const request = (target.protocol === "https:" ? https : http).request(
      {
        hostname: address.address,
        family: address.family,
        port,
        servername: target.hostname.replace(/^\[|\]$/g, ""),
        method: options.method ?? "GET",
        path: `${target.pathname}${target.search}`,
        headers: { ...options.headers, host: target.host },
        agent: false,
      },
      (response) => {
        request.setTimeout(0); // SSE and streaming responses may legitimately stay idle.
        resolve(response);
      },
    );
    request.setTimeout(options.timeoutMs ?? 20_000, () =>
      request.destroy(new Error("Upstream response timed out")),
    );
    request.on("error", reject);
    if (options.body) {
      options.body.once("aborted", () => request.destroy());
      options.body.once("error", (error) => request.destroy(error));
      let bytesReceived = 0;
      options.body.on("data", (chunk: Buffer) => {
        bytesReceived += chunk.length;
        if (bytesReceived > 25 * 1024 * 1024)
          request.destroy(new Error("Preview upload exceeds 25 MB"));
      });
      options.body.pipe(request);
    } else request.end();
  });
}

/** Node parses the bounded HTTP upgrade headers before any WebSocket frames are relayed. */
export async function openUpstreamWebSocket(
  target: URL,
  headers: OutgoingHttpHeaders,
  options: TransportOptions & { signal?: AbortSignal } = {},
): Promise<{ response: IncomingMessage; socket: Duplex; head: Buffer }> {
  const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
  const address = await resolveDestination(
    target.hostname,
    port,
    options.allowedPrivateHosts,
    options.resolver,
  );
  return new Promise((resolve, reject) => {
    const request = (target.protocol === "https:" ? https : http).request({
      hostname: address.address,
      family: address.family,
      port,
      servername: target.hostname.replace(/^\[|\]$/g, ""),
      method: "GET",
      path: `${target.pathname}${target.search}`,
      headers: { ...headers, host: target.host, connection: "Upgrade", upgrade: "websocket" },
      agent: false,
      maxHeaderSize: 32 * 1024,
      signal: options.signal,
    });
    request.setTimeout(options.timeoutMs ?? 20_000, () =>
      request.destroy(new Error("WebSocket handshake timed out")),
    );
    request.once("upgrade", (response, socket, head) => {
      request.setTimeout(0);
      resolve({ response, socket, head });
    });
    request.once("response", (response) => {
      response.destroy();
      reject(new Error("Target refused WebSocket upgrade"));
    });
    request.once("error", reject);
    request.end();
  });
}

export async function canonicalTarget(initial: URL, options: TransportOptions = {}): Promise<URL> {
  let target = new URL(initial);
  for (let count = 0; count < 6; count++) {
    const response = await openUpstream(target, {
      ...options,
      headers: {
        "user-agent": "Mozilla/5.0 Repere/0.1",
        accept: "text/html",
        "accept-encoding": "identity",
      },
    });
    const status = response.statusCode ?? 502;
    const location = response.headers.location;
    const hasCookies = !!response.headers["set-cookie"]?.length;
    response.destroy(); // Read headers only: never download a target body while registering a session.
    if (![301, 302, 303, 307, 308].includes(status) || !location) return target;
    const next = new URL(location, target);
    if (!["http:", "https:"].includes(next.protocol) || next.username || next.password)
      throw new Error("Unsafe redirect");
    // Cookie-dependent same-URL redirects can complete normally inside the native browser.
    if (hasCookies && next.href === target.href) return target;
    target = next;
  }
  throw new Error("Too many target redirects");
}

export async function readTextResponse(
  response: IncomingMessage,
  maximumBytes: number,
): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maximumBytes) {
      response.destroy();
      throw new Error("Text response exceeds the size limit");
    }
    chunks.push(buffer);
  }
  let buffer = Buffer.concat(chunks);
  const encoding = String(response.headers["content-encoding"] ?? "identity")
    .trim()
    .toLowerCase();
  if (encoding === "gzip") buffer = await decompressGzip(buffer, { maxOutputLength: maximumBytes });
  else if (encoding === "br")
    buffer = await decompressBrotli(buffer, { maxOutputLength: maximumBytes });
  else if (encoding === "deflate")
    buffer = await decompressDeflate(buffer, { maxOutputLength: maximumBytes });
  else if (encoding !== "identity") throw new Error("Unsupported text compression");
  if (buffer.length > maximumBytes) throw new Error("Decoded Text response exceeds the size limit");
  const charset =
    /charset\s*=\s*["']?([^\s;"']+)/i.exec(String(response.headers["content-type"] ?? ""))?.[1] ??
    "utf-8";
  return new TextDecoder(charset).decode(buffer);
}

/** Cookies remain in the user's browser and are scoped to the isolated preview host. */
export function rewriteCookie(cookie: string): string | null {
  const [pair, ...attributes] = cookie.split(";");
  if (!pair || !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+=/.test(pair.trim())) return null;
  const preserved = attributes
    .map((attribute) => attribute.trim())
    .filter((attribute) => {
      const name = attribute.split("=", 1)[0].toLowerCase();
      return !["domain", "samesite", "secure", "partitioned"].includes(name);
    });
  return [pair.trim(), ...preserved, "SameSite=None", "Secure", "Partitioned"].join("; ");
}
