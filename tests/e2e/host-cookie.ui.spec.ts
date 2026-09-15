import { expect, test, type BrowserContextOptions } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net, { type AddressInfo, type Socket } from "node:net";
import { emailCode, identity } from "./helpers";

const gateway = process.env.E2E_HTTPS_GATEWAY;
const appOrigin = "https://app.repere.test";
type SeenRequest = {
  path: string;
  method: string;
  origin?: string;
  site?: string;
  status: number;
  sessionCookie: boolean;
};
test.use({ trace: "off", screenshot: "off", video: "off" });

/**
 * Opt-in against a dedicated container configured for app.repere.test and
 * preview.repere.test. A real local TLS terminator and CONNECT proxy replace
 * DNS/certificate provisioning; requests are never fulfilled through Playwright.
 * Browser cookies, CORS, same-origin checks and the backend are all exercised.
 * Requires the openssl CLI. No system trust store or hosts file is changed.
 */
async function startTlsTestProxy() {
  const certificateDir = mkdtempSync(path.join(tmpdir(), "repere-https-test-"));
  const key = path.join(certificateDir, "key.pem");
  const certificate = path.join(certificateDir, "certificate.pem");
  execFileSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "1",
      "-keyout",
      key,
      "-out",
      certificate,
      "-subj",
      "/CN=app.repere.test",
      "-addext",
      "subjectAltName=DNS:app.repere.test,DNS:*.preview.repere.test",
    ],
    { stdio: "ignore" },
  );
  const observed: SeenRequest[] = [];
  const connections = new Set<Socket>();
  const malicious = `<!doctype html><title>Adversarial preview fixture</title><script>
    document.cookie = '__Host-repere_session=evil-script; Domain=repere.test; Secure; Path=/; SameSite=Lax';
    document.cookie = 'repere_session=evil-legacy; Domain=repere.test; Secure; Path=/; SameSite=Lax';
    window.result = { parentBlocked: false, corsBlocked: false, postComplete: false };
    try { parent.document.body.dataset.compromised = 'yes'; } catch { result.parentBlocked = true; }
    Promise.all([
      fetch('${appOrigin}/api/auth/me', { credentials: 'include' })
        .then(r => r.text()).catch(() => { result.corsBlocked = true; }),
      fetch('${appOrigin}/api/auth/logout', { method: 'POST', credentials: 'include', mode: 'no-cors' })
        .then(() => { result.postComplete = true; })
    ]).then(() => { result.done = true; });
  </script>`;
  const tls = https.createServer(
    { key: readFileSync(key), cert: readFileSync(certificate) },
    (request, response) => {
      if (/^[a-f0-9]{48}\.preview\.repere\.test$/.test(request.headers.host ?? "")) {
        response.writeHead(200, {
          "content-type": "text/html",
          "set-cookie":
            "__Host-repere_session=evil-header; Domain=repere.test; Secure; Path=/; SameSite=Lax",
        });
        response.end(malicious);
        return;
      }
      if (request.headers.host !== "app.repere.test") {
        response.writeHead(421).end();
        return;
      }
      const upstream = http.request(
        new URL(request.url ?? "/", gateway),
        {
          method: request.method,
          headers: request.headers,
          agent: false,
        },
        (source) => {
          observed.push({
            path: (request.url ?? "").split("?", 1)[0],
            method: request.method ?? "GET",
            origin: request.headers.origin,
            site: String(request.headers["sec-fetch-site"] ?? ""),
            status: source.statusCode!,
            sessionCookie: /(?:^|;\s*)__Host-repere_session=/.test(request.headers.cookie ?? ""),
          });
          response.writeHead(source.statusCode!, source.headers);
          source.pipe(response);
          source.on("error", () => response.destroy());
        },
      );
      upstream.on("error", () => response.destroy());
      response.on("close", () => upstream.destroy());
      request.pipe(upstream);
    },
  );
  const proxy = http.createServer((_request, response) => response.writeHead(405).end());
  for (const server of [tls, proxy]) {
    server.on("connection", (socket) => {
      connections.add(socket);
      socket.on("close", () => connections.delete(socket));
      socket.on("error", () => socket.destroy());
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  }
  proxy.on("connect", (request, client, head) => {
    if (
      !/^(?:app\.repere\.test|[a-f0-9]{48}\.preview\.repere\.test):443$/.test(request.url ?? "")
    ) {
      client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    const upstream = net.connect((tls.address() as AddressInfo).port, "127.0.0.1", () => {
      client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    connections.add(upstream);
    upstream.on("close", () => {
      connections.delete(upstream);
      client.destroy();
    });
    client.on("close", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
  });
  return {
    observed,
    contextOptions: {
      ignoreHTTPSErrors: true,
      proxy: { server: `http://127.0.0.1:${(proxy.address() as AddressInfo).port}` },
    } satisfies BrowserContextOptions,
    async close() {
      for (const socket of connections) socket.destroy();
      await Promise.all(
        [tls, proxy].map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
      );
      rmSync(certificateDir, { recursive: true, force: true });
    },
  };
}

test.describe("HTTPS sibling-origin session isolation", () => {
  test.skip(!gateway, "Set E2E_HTTPS_GATEWAY to a dedicated HTTPS-configured test container.");

  test("rejects sibling session cookies and cross-origin access after real OTP authentication", async ({
    browser,
  }) => {
    const transport = await startTlsTestProxy();
    const context = await browser.newContext(transport.contextOptions);
    try {
      const page = await context.newPage();
      expect((await page.goto(`${appOrigin}/login`))?.status()).toBe(200);
      expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
      const person = identity(`host-cookie-${test.info().project.name}`);
      const requested = await page.evaluate(async (person) => {
        const response = await fetch("/api/auth/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(person),
        });
        return response.status;
      }, person);
      expect(requested).toBe(200);
      const code = await emailCode(person.email);
      const verified = await page.evaluate(
        async ({ email, code }) => {
          const response = await fetch("/api/auth/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, code }),
          });
          return response.status;
        },
        { email: person.email, code },
      );
      expect(verified).toBe(200);

      const original = (await context.cookies(appOrigin)).find(
        (cookie) => cookie.name === "__Host-repere_session",
      );
      expect(original?.value.length).toBeGreaterThan(30);
      expect({
        domain: original?.domain,
        path: original?.path,
        httpOnly: original?.httpOnly,
        secure: original?.secure,
        sameSite: original?.sameSite,
      }).toEqual({
        domain: "app.repere.test",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      });
      await page.goto(appOrigin);
      const previewOrigin = `https://${randomBytes(24).toString("hex")}.preview.repere.test`;
      await page.evaluate((previewOrigin) => {
        const iframe = document.createElement("iframe");
        iframe.setAttribute(
          "sandbox",
          "allow-scripts allow-forms allow-same-origin allow-pointer-lock allow-presentation allow-popups allow-popups-to-escape-sandbox allow-downloads",
        );
        iframe.src = previewOrigin;
        document.body.appendChild(iframe);
      }, previewOrigin);
      await expect
        .poll(() => page.frames().some((frame) => frame.url().startsWith(previewOrigin)))
        .toBe(true);
      const frame = page.frames().find((frame) => frame.url().startsWith(previewOrigin))!;
      await expect
        .poll(() =>
          frame.evaluate(() => (window as Window & { result?: { done?: boolean } }).result?.done),
        )
        .toBe(true);
      expect(
        await frame.evaluate(() => (window as Window & { result?: unknown }).result),
      ).toMatchObject({
        parentBlocked: true,
        corsBlocked: true,
        postComplete: true,
      });
      expect(await page.evaluate(() => document.body.dataset.compromised)).toBeUndefined();

      const attacked = await context.cookies(appOrigin);
      expect(
        attacked.find((cookie) => cookie.name === "__Host-repere_session")?.value ===
          original!.value,
      ).toBe(true);
      expect(
        attacked.some(
          (cookie) =>
            cookie.name === "__Host-repere_session" && cookie.domain !== "app.repere.test",
        ),
      ).toBe(false);
      expect(
        attacked.some(
          (cookie) => cookie.name === "repere_session" && cookie.value === "evil-legacy",
        ),
      ).toBe(true);
      const attackPost = transport.observed.find(
        (request) => request.path === "/api/auth/logout" && request.origin === previewOrigin,
      );
      expect(attackPost).toMatchObject({
        status: 403,
        method: "POST",
        site: "same-site",
        sessionCookie: true,
      });
      const attackGet = transport.observed.find(
        (request) => request.path === "/api/auth/me" && request.origin === previewOrigin,
      );
      expect(attackGet).toMatchObject({ status: 200, sessionCookie: true });
      expect(
        await page.evaluate(async () => (await (await fetch("/api/auth/me")).json()).user !== null),
      ).toBe(true);

      // The same valid token is ignored under the legacy, domain-writable name.
      const legacy = await browser.newContext(transport.contextOptions);
      try {
        await legacy.addCookies([
          {
            name: "repere_session",
            value: original!.value,
            domain: ".repere.test",
            path: "/",
            secure: true,
            httpOnly: true,
            sameSite: "Lax",
          },
        ]);
        const legacyPage = await legacy.newPage();
        await legacyPage.goto(`${appOrigin}/login`);
        expect(
          await legacyPage.evaluate(async () => (await (await fetch("/api/auth/me")).json()).user),
        ).toBeNull();
      } finally {
        await legacy.close();
      }
    } finally {
      await context.close();
      await transport.close();
    }
  });
});
