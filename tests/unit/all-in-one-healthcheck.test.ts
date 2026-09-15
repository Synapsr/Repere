import http, { type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, expect, test } from "vitest";
import { checkServices } from "../../docker/all-in-one/healthcheck.mjs";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

async function service(handler: http.RequestListener) {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

test("health uses the configured public Host while connecting only to loopback", async () => {
  const internal = await service((_request, response) => response.writeHead(200).end());
  for (const appUrl of ["https://app.repere.dev", "http://localhost:3081"]) {
    let receivedHost: string | undefined;
    const gateway = await service((request, response) => {
      receivedHost = request.headers.host;
      response.writeHead(receivedHost === new URL(appUrl).host ? 200 : 421).end();
    });
    await checkServices({ appUrl, appPort: internal, previewPort: internal, gatewayPort: gateway });
    expect(receivedHost).toBe(new URL(appUrl).host);
  }
});

test("health rejects failed services and bounds unresponsive upstreams", async () => {
  const healthy = await service((_request, response) => response.writeHead(200).end());
  const failed = await service((_request, response) => response.writeHead(503).end());
  const silent = await service(() => {});
  for (const appPort of [failed, silent]) {
    await expect(
      checkServices({ appPort, previewPort: healthy, gatewayPort: healthy, timeoutMs: 30 }),
    ).rejects.toThrow("Service unavailable");
  }
});
