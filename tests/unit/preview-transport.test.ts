import http, { type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createPreviewServer, type PreviewServerOptions } from "../../preview/server";
import type { PreviewSession } from "../../shared/preview";

const secret = "preview-tests-a-very-long-secret-at-least-32-characters";
const appOrigin = "http://localhost:3000";
type Result = { status: number; headers: IncomingHttpHeaders; body: Buffer };
async function listen(server: Server) {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}
function request(
  port: number,
  path: string,
  options: { host?: string; method?: string; body?: string; headers?: Record<string, string> } = {},
): Promise<Result> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: options.method ?? "GET",
        headers: {
          ...options.headers,
          ...(options.host ? { host: options.host } : {}),
          ...(options.body ? { "content-length": String(Buffer.byteLength(options.body)) } : {}),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode!,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end(options.body);
  });
}

describe("real native preview HTTP transport", () => {
  const cleanup: (() => Promise<void>)[] = [];
  afterEach(async () => {
    while (cleanup.length) await cleanup.pop()!();
  });
  async function setup(overrides: Partial<PreviewServerOptions> = {}) {
    let target = "";
    let forbiddenRequests = 0;
    let resolverCalls = 0;
    const initialHeaders: IncomingHttpHeaders[] = [];
    const script = `globalThis.example = { original: "https://example.com/api" };`;
    const fixture = http.createServer(async (req, res) => {
      if (req.url === "/start") {
        initialHeaders.push(req.headers);
        res.writeHead(302, { location: "/page?lang=fr" });
        res.end();
        return;
      }
      if (req.url?.startsWith("/page")) {
        res.writeHead(200, {
          "content-type": "text/html",
          "x-frame-options": "DENY",
          "content-security-policy": "default-src 'none'",
          "clear-site-data": '"cookies"',
          "set-cookie": "site=private; Domain=fixture.test; Path=/; HttpOnly",
          "cache-control": "public, max-age=3600",
        });
        res.end(
          `<!doctype html><html><head><title>Native page</title><script>${script}</script></head><body><a href="${target}/next">Next</a></body></html>`,
        );
        return;
      }
      if (req.url === "/script.js") {
        res.setHeader("content-type", "text/javascript");
        res.end(script);
        return;
      }
      if (req.url === "/style.css") {
        res.writeHead(200, {
          "content-type": "text/css",
          "content-encoding": "gzip",
          etag: "original-css",
        });
        res.end(
          gzipSync(
            `@font-face{src:url('${target}/font.woff2')}body{background:url(https://cdn.example/image.png)}`,
          ),
        );
        return;
      }
      if (req.url === "/api") {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            body: Buffer.concat(chunks).toString(),
            host: req.headers.host,
            origin: req.headers.origin,
            referer: req.headers.referer,
            cookie: req.headers.cookie,
            authorization: req.headers.authorization,
            forwarded: req.headers["x-forwarded-for"],
          }),
        );
        return;
      }
      if (req.url === "/range") {
        res.writeHead(206, {
          "content-type": "video/mp4",
          "content-range": "bytes 4-7/16",
          "accept-ranges": "bytes",
          "content-length": "4",
        });
        res.end(Buffer.from([4, 5, 6, 7]));
        return;
      }
      if (req.url === "/gzip") {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": "gzip",
        });
        res.end(gzipSync("<h1>Héllo compressed</h1>"));
        return;
      }
      if (req.url === "/large") {
        res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" });
        res.end(gzipSync("<h1>" + "x".repeat(20_000) + "</h1>"));
        return;
      }
      if (req.url === "/ssrf") {
        res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" });
        res.end();
        return;
      }
      if (req.url === "/external") {
        res.writeHead(302, { location: "https://example.com/other" });
        res.end();
        return;
      }
      if (req.url === "/sse") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("data: first\n\n");
        const timer = setInterval(() => res.write("data: heartbeat\n\n"), 1000);
        req.once("close", () => clearInterval(timer));
        return;
      }
      if (req.url === "/private") forbiddenRequests++;
      res.writeHead(404);
      res.end("Not found");
    });
    const fixturePort = await listen(fixture);
    target = `http://fixture.test:${fixturePort}`;
    const wss = new WebSocketServer({ noServer: true });
    wss.on("headers", (headers) =>
      headers.push(
        "Set-Cookie: ws-session=value; Domain=fixture.test; Path=/; HttpOnly; SameSite=Lax",
      ),
    );
    fixture.on("upgrade", (req, socket, head) =>
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on("message", (data) =>
          ws.send(
            JSON.stringify({
              text: data.toString(),
              host: req.headers.host,
              origin: req.headers.origin,
            }),
          ),
        );
      }),
    );
    cleanup.push(async () => {
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      fixture.closeAllConnections();
      await new Promise<void>((resolve) => fixture.close(() => resolve()));
    });
    const service = await createPreviewServer({
      secret,
      appUrl: appOrigin,
      previewBaseUrl: "http://localhost:3001",
      bridgeSource: "window.repereBridgeLoaded=true;",
      allowedPrivateHosts: new Set(["fixture.test"]),
      resolver: async () => {
        resolverCalls++;
        return [{ address: "127.0.0.1", family: 4 }];
      },
      ...overrides,
    });
    const proxyPort = await listen(service.server);
    cleanup.push(service.close);
    const register = async (path = "/start", locale = "en") => {
      const response = await request(proxyPort, "/__repere/sessions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          cookie: "app-session=must-not-leak; repere_locale=fr",
          "accept-language": locale,
          "content-type": "application/json",
        },
        body: JSON.stringify({ url: `${target}${path}`, projectId: "project", userId: "reviewer" }),
      });
      return { response, session: JSON.parse(response.body.toString()) as PreviewSession };
    };
    return {
      proxyPort,
      target,
      register,
      script,
      initialHeaders,
      getResolverCalls: () => resolverCalls,
      getForbiddenRequests: () => forbiddenRequests,
    };
  }

  it("localizes the bridge from the control locale without translating target content", async () => {
    const fixture = await setup();
    for (const locale of ["en", "fr"]) {
      const { session } = await fixture.register("/start", locale);
      expect(session).not.toHaveProperty("locale");
      const page = await request(fixture.proxyPort, "/page?lang=fr", {
        host: new URL(session.origin).host,
        headers: { "accept-language": locale === "en" ? "fr" : "en" },
      });
      const html = page.body.toString();
      expect(html).toContain(`"locale":"${locale}"`);
      expect(html).toContain("<title>Native page</title>");
      expect(html).toContain(fixture.script);
      expect(html).not.toContain('"servicePage"');
    }
    expect(
      fixture.initialHeaders.every((headers) => !headers.cookie && !headers.authorization),
    ).toBe(true);
  });

  it("registers a canonical isolated capability and injects before unchanged scripts", async () => {
    const fixture = await setup();
    const { response, session } = await fixture.register();
    expect(response.status).toBe(201);
    expect(session.targetUrl).toBe(`${fixture.target}/page?lang=fr`);
    expect(new URL(session.origin).hostname).toMatch(/^[a-f0-9]{48}\.localhost$/);
    expect(session.channel).toMatch(/^[a-f0-9]{32}$/);
    expect(session.url).toBe(`${session.origin}/page?lang=fr`);
    expect(fixture.initialHeaders[0]).not.toHaveProperty("authorization");
    expect(fixture.initialHeaders[0]).not.toHaveProperty("cookie");
    const page = await request(fixture.proxyPort, "/page?lang=fr", {
      host: new URL(session.origin).host,
    });
    const html = page.body.toString();
    expect(html).toContain(`href="${session.origin}/next"`);
    expect(html).toContain(fixture.script);
    expect(html.indexOf('id="repere-preview-config"')).toBeLessThan(html.indexOf(fixture.script));
    expect(page.headers["content-security-policy"]).toBe(`frame-ancestors ${appOrigin}`);
    expect(page.headers).not.toHaveProperty("x-frame-options");
    expect(page.headers).not.toHaveProperty("clear-site-data");
    expect(page.headers["cache-control"]).toBe("private, no-store");
    expect(page.headers["set-cookie"]?.[0]).toContain("SameSite=None; Secure; Partitioned");
    expect(page.headers["set-cookie"]?.[0]).not.toContain("Domain=");
    const bridge = await request(fixture.proxyPort, "/__repere/bridge.js", {
      host: new URL(session.origin).host,
    });
    expect(bridge.body.toString()).toBe("window.repereBridgeLoaded=true;");
    const javascript = await request(fixture.proxyPort, "/script.js", {
      host: new URL(session.origin).host,
    });
    expect(javascript.body.toString()).toBe(fixture.script);
    const css = await request(fixture.proxyPort, "/style.css", {
      host: new URL(session.origin).host,
    });
    expect(css.body.toString()).toContain(`url('${session.origin}/font.woff2')`);
    expect(css.body.toString()).toContain("url(https://cdn.example/image.png)");
    expect(css.headers["content-type"]).toBe("text/css; charset=utf-8");
    expect(css.headers).not.toHaveProperty("content-encoding");
    expect(css.headers).not.toHaveProperty("etag");
    expect(fixture.getResolverCalls()).toBe(5);
  });

  it("preserves POST bodies during async DNS and translates native headers without leaking service credentials", async () => {
    const fixture = await setup({
      resolver: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return [{ address: "127.0.0.1", family: 4 }];
      },
    });
    const { session } = await fixture.register();
    const payload = JSON.stringify({ input: "Bonjour à tous", nested: { intact: true } });
    const response = await request(fixture.proxyPort, "/api", {
      host: new URL(session.origin).host,
      method: "POST",
      body: payload,
      headers: {
        "content-type": "application/json",
        origin: session.origin,
        referer: `${session.origin}/page?x=1`,
        cookie: "site=private",
        authorization: "Bearer site-credential",
        "x-forwarded-for": "127.0.0.1",
      },
    });
    expect(JSON.parse(response.body.toString())).toEqual({
      body: payload,
      host: new URL(fixture.target).host,
      origin: fixture.target,
      referer: `${fixture.target}/page?x=1`,
      cookie: "site=private",
      authorization: "Bearer site-credential",
    });
    const internal = await request(fixture.proxyPort, "/api", {
      host: new URL(session.origin).host,
      headers: { authorization: `Bearer ${secret}` },
    });
    expect(JSON.parse(internal.body.toString())).not.toHaveProperty("authorization");
  });

  it("streams binary ranges and decodes bounded compressed HTML", async () => {
    const fixture = await setup();
    const { session } = await fixture.register();
    const host = new URL(session.origin).host;
    const range = await request(fixture.proxyPort, "/range", {
      host,
      headers: { range: "bytes=4-7" },
    });
    expect(range.status).toBe(206);
    expect(range.headers["content-range"]).toBe("bytes 4-7/16");
    expect([...range.body]).toEqual([4, 5, 6, 7]);
    const html = await request(fixture.proxyPort, "/gzip", { host });
    expect(html.status).toBe(200);
    expect(html.headers).not.toHaveProperty("content-encoding");
    expect(html.body.toString()).toContain("Héllo compressed");
    expect(html.body.toString()).toContain("repere-preview-config");
  });

  it("does not buffer SSE until completion", async () => {
    const fixture = await setup();
    const { session } = await fixture.register();
    const first = await new Promise<string>((resolve, reject) => {
      const req = http.get(
        {
          hostname: "127.0.0.1",
          port: fixture.proxyPort,
          path: "/sse",
          headers: { host: new URL(session.origin).host },
        },
        (res) => {
          res.once("data", (chunk: Buffer) => {
            resolve(chunk.toString());
            res.destroy();
          });
        },
      );
      req.on("error", reject);
    });
    expect(first).toBe("data: first\n\n");
  });

  it("closes existing SSE streams at the hard session expiry", async () => {
    const fixture = await setup({ sessionTtlMs: 1000 });
    const { session } = await fixture.register();
    await new Promise<void>((resolve, reject) => {
      const req = http.get(
        {
          hostname: "127.0.0.1",
          port: fixture.proxyPort,
          path: "/sse",
          headers: { host: new URL(session.origin).host },
        },
        (res) => {
          let received = false;
          res.on("data", () => {
            received = true;
          });
          res.once("close", () => {
            if (received) resolve();
            else reject(new Error("Stream closed before its first event"));
          });
          res.on("error", () => {}); // Expected hard-expiry abort.
        },
      );
      req.on("error", reject);
    });
  }, 4000);

  it("rejects private redirect targets, unauthorized calls and unknown hosts", async () => {
    const fixture = await setup();
    expect(
      (await request(fixture.proxyPort, "/__repere/sessions", { method: "POST", body: "{}" }))
        .status,
    ).toBe(401);
    expect((await fixture.register("/ssrf")).response.status).toBe(400);
    expect(fixture.getForbiddenRequests()).toBe(0);
    expect(
      (await request(fixture.proxyPort, "/page", { host: `${"0".repeat(48)}.localhost:3001` }))
        .status,
    ).toBe(404);
    const { session } = await fixture.register();
    expect(
      (
        await request(fixture.proxyPort, "/__repere/sessions", {
          host: new URL(session.origin).host,
          method: "POST",
          headers: { authorization: `Bearer ${secret}` },
          body: "{}",
        })
      ).status,
    ).toBe(404);
    const external = await request(fixture.proxyPort, "/external", {
      host: new URL(session.origin).host,
    });
    expect(external.status).toBe(200);
    expect(external.headers).not.toHaveProperty("location");
    expect(external.body.toString()).toContain('href="https://example.com/other" target="_blank"');
  });

  it("expires capabilities, frees capacity and bounds decompression", async () => {
    let now = Date.now();
    const fixture = await setup({
      now: () => now,
      maxSessions: 1,
      sessionTtlMs: 1000,
      maxHtmlBytes: 1024,
    });
    const { session } = await fixture.register();
    expect((await fixture.register()).response.status).toBe(503);
    expect(
      (await request(fixture.proxyPort, "/large", { host: new URL(session.origin).host })).status,
    ).toBe(502);
    expect((await request(fixture.proxyPort, "/health")).status).toBe(200);
    now += 1001;
    expect(
      (await request(fixture.proxyPort, "/page", { host: new URL(session.origin).host })).status,
    ).toBe(404);
    expect((await fixture.register()).response.status).toBe(201);
  });

  it("forwards native same-target WebSockets over validated sockets", async () => {
    const fixture = await setup();
    const { session } = await fixture.register();
    const ws = new WebSocket(`ws://127.0.0.1:${fixture.proxyPort}/socket`, "fixture", {
      headers: { host: new URL(session.origin).host },
      origin: session.origin,
    });
    const handshake = once(ws, "upgrade");
    try {
      await once(ws, "open");
      const [upgradeResponse] = await handshake;
      expect(upgradeResponse.headers["set-cookie"][0]).toContain(
        "SameSite=None; Secure; Partitioned",
      );
      expect(upgradeResponse.headers["set-cookie"][0]).not.toContain("Domain=");
      const message = once(ws, "message");
      ws.send("native websocket");
      const [data] = await message;
      expect(JSON.parse(String(data))).toEqual({
        text: "native websocket",
        host: new URL(fixture.target).host,
        origin: fixture.target,
      });
    } finally {
      ws.terminate();
    }
  });
});
