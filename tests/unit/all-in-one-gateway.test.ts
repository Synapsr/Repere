import http, { type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { afterEach, describe, expect, it } from "vitest";
import { createGateway } from "../../docker/all-in-one/gateway.mjs";

const sessionHost = `${"a".repeat(48)}.repere.dev`;
const cleanup: (() => Promise<void>)[] = [];
async function listen(server: Server) {
  const sockets = new Set<Socket>();
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  return (server.address() as AddressInfo).port;
}

function get(
  port: number,
  host: string,
  path = "/",
  headers: Record<string, string> = {},
  body?: Buffer,
): Promise<{ status: number; headers: IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: body ? "POST" : "GET",
        headers: { ...headers, Host: host },
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
    request.on("error", reject);
    request.end(body);
  });
}

afterEach(async () => {
  while (cleanup.length) await cleanup.pop()!();
});

async function fixture(options: { trustProxy?: boolean; upstreamTimeoutMs?: number } = {}) {
  const app = http.createServer((request, response) => {
    if (request.url === "/slow") return;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ service: "app", headers: request.headers }));
  });
  const preview = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    response.writeHead(206, {
      "content-type": "application/octet-stream",
      "content-range": "bytes 0-3/4",
      "set-cookie": ["one=1; Path=/; HttpOnly", "two=2; Path=/; Secure"],
      "x-original-host": request.headers.host,
      "x-original-range": request.headers.range ?? "",
      "x-original-path": request.url,
      "x-original-cookie": request.headers.cookie ?? "",
      connection: "x-hop-header",
      "x-hop-header": "private",
    });
    response.end(chunks.length ? Buffer.concat(chunks) : Buffer.from([0, 255, 13, 10]));
  });
  const gateway = createGateway({
    appUrl: "https://app.repere.dev",
    previewBaseUrl: "https://repere.dev",
    appPort: await listen(app),
    previewPort: await listen(preview),
    ...options,
  });
  const port = await listen(gateway.server);
  cleanup.push(() => gateway.close());
  return { port, app, preview };
}

describe("the all-in-one fixed-origin gateway", () => {
  it("routes only the app authority and exact 48-hex session hosts", async () => {
    const { port } = await fixture();
    expect(JSON.parse((await get(port, "app.repere.dev")).body.toString()).service).toBe("app");
    expect((await get(port, sessionHost)).status).toBe(206);
    for (const host of [
      "repere.dev",
      "www.repere.dev",
      "attacker.example",
      `${"a".repeat(47)}.repere.dev`,
      `${sessionHost}.evil.test`,
      `${sessionHost}:9999`,
      `${sessionHost}.`,
    ])
      expect((await get(port, host)).status, host).toBe(421);
  });

  it("blocks control routes on every public host, including normalized and encoded paths", async () => {
    const { port } = await fixture();
    for (const host of ["app.repere.dev", sessionHost]) {
      for (const path of [
        "/__repere/sessions",
        "/__repere/sessions?any=1",
        "/x/../__repere/sessions",
        "/%5f%5frepere/sessions",
        "/__repere%2fsessions",
        "http://app.repere.dev/",
      ])
        expect((await get(port, host, path)).status, `${host}${path}`).toBe(404);
    }
    expect((await get(port, sessionHost, "/__repere/bridge.js")).status).toBe(206);
  });

  it("preserves binary uploads, ranges, cookies and encoded URLs while stripping hop headers", async () => {
    const { port } = await fixture();
    const payload = Buffer.from([0, 255, 13, 10]);
    const result = await get(
      port,
      sessionHost,
      "/asset%20name?q=%2F",
      {
        Range: "bytes=0-3",
        Cookie: "target=private",
        "Content-Type": "application/pdf",
      },
      payload,
    );
    expect(result.status).toBe(206);
    expect(result.body).toEqual(payload);
    expect(result.headers["content-range"]).toBe("bytes 0-3/4");
    expect(result.headers["x-original-host"]).toBe(sessionHost);
    expect(result.headers["x-original-path"]).toBe("/asset%20name?q=%2F");
    expect(result.headers["x-original-range"]).toBe("bytes=0-3");
    expect(result.headers["x-original-cookie"]).toBe("target=private");
    expect(result.headers["x-hop-header"]).toBeUndefined();
    expect(result.headers["set-cookie"]).toEqual([
      "one=1; Path=/; HttpOnly",
      "two=2; Path=/; Secure",
    ]);
  });

  it("replaces spoofed forwarding headers unless trusted ingress mode is enabled", async () => {
    const ordinary = await fixture();
    const supplied = {
      "X-Forwarded-For": "203.0.113.8, 127.0.0.1",
      "X-Forwarded-Host": "evil.test",
      "X-Forwarded-Proto": "http",
      Forwarded: "host=evil.test",
    };
    const result = JSON.parse(
      (await get(ordinary.port, "app.repere.dev", "/", supplied)).body.toString(),
    );
    expect(result.headers["x-forwarded-for"]).toBe("127.0.0.1");
    expect(result.headers["x-forwarded-host"]).toBe("app.repere.dev");
    expect(result.headers["x-forwarded-proto"]).toBe("https");
    expect(result.headers.forwarded).toBeUndefined();
    const trusted = await fixture({ trustProxy: true });
    const trustedResult = JSON.parse(
      (await get(trusted.port, "app.repere.dev", "/", supplied)).body.toString(),
    );
    expect(trustedResult.headers["x-forwarded-for"]).toBe("203.0.113.8");
  });

  it("delivers the first SSE event before the upstream closes", async () => {
    let finish: (() => void) | undefined;
    const stream = http.createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("data: first\n\n");
      finish = () => response.end("data: final\n\n");
    });
    const streamPort = await listen(stream);
    const gateway = createGateway({
      appUrl: "http://localhost:8080",
      previewBaseUrl: "http://localhost:8080",
      appPort: streamPort,
      previewPort: streamPort,
    });
    const port = await listen(gateway.server);
    cleanup.push(() => gateway.close());
    const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
      http
        .get({ hostname: "127.0.0.1", port, headers: { Host: "localhost:8080" } }, resolve)
        .on("error", reject);
    });
    const chunks: string[] = [];
    const ended = once(response, "end");
    response.on("data", (chunk: Buffer) => chunks.push(chunk.toString()));
    await once(response, "data");
    expect(chunks.join("")).toBe("data: first\n\n");
    expect(response.complete).toBe(false);
    finish!();
    await ended;
    expect(chunks.join("")).toBe("data: first\n\ndata: final\n\n");
  });

  it("forwards a real WebSocket upgrade, its cookies, protocol and binary frames", async () => {
    const { port, preview } = await fixture();
    const sockets = new WebSocketServer({ noServer: true });
    sockets.on("headers", (headers) => headers.push("Set-Cookie: websocket=ready; Path=/"));
    preview.on("upgrade", (request, socket, head) => {
      expect(request.headers.host).toBe(sessionHost);
      sockets.handleUpgrade(request, socket, head, (client) => {
        client.on("message", (message, binary) => client.send(message, { binary }));
      });
    });
    const client = new WebSocket(`ws://127.0.0.1:${port}/events`, ["repere-test"], {
      headers: { Host: sessionHost },
    });
    let cookies: string[] | undefined;
    client.on("upgrade", (response) => {
      cookies = response.headers["set-cookie"];
    });
    await once(client, "open");
    expect(client.protocol).toBe("repere-test");
    expect(cookies).toEqual(["websocket=ready; Path=/"]);
    const message = once(client, "message");
    client.send(Buffer.from([0, 2, 254, 255]));
    const [data, binary] = await message;
    expect(binary).toBe(true);
    expect(data).toEqual(Buffer.from([0, 2, 254, 255]));
    const closed = once(client, "close");
    client.close();
    await closed;
    await new Promise<void>((resolve) => sockets.close(() => resolve()));
  });

  it("times out unresponsive upstream headers without exposing internal details", async () => {
    const { port } = await fixture({ upstreamTimeoutMs: 25 });
    const result = await get(port, "app.repere.dev", "/slow");
    expect(result.status).toBe(502);
    expect(result.body.toString()).toBe("Bad Gateway");
  });

  it("refuses malformed configuration and overlapping app/session namespaces", () => {
    for (const appUrl of [
      "https://user:pass@app.repere.dev",
      "https://app.repere.dev/path",
      `https://${sessionHost}`,
    ]) {
      expect(() => createGateway({ appUrl, previewBaseUrl: "https://repere.dev" })).toThrow();
    }
    expect(() =>
      createGateway({ appUrl: "https://app.repere.dev", previewBaseUrl: "http://localhost" }),
    ).toThrow();
  });
});
