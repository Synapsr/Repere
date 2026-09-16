import { expect, test as base, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { PreviewSession } from "../../shared/preview";
import type { ReviewData } from "../../shared/types";
import { baseURL } from "./helpers";

const test = base.extend<{ coverServer: Server }>({
  coverServer: async ({}, runTest) => {
    const server = createServer();
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      await runTest(server);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  },
});

async function redirectedCoverFixture(page: Page, server: Server, navigateBeforeCapture: boolean) {
  const timestamp = new Date().toISOString();
  const data: ReviewData = {
    project: {
      id: randomUUID(),
      name: "Browser language redirect",
      description: null,
      type: "website",
      url: "https://language.example.test/",
      fileName: null,
      shareToken: randomUUID().replaceAll("-", "").padEnd(43, "a"),
      workspaceId: randomUUID(),
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      commentCount: 0,
      resolvedCount: 0,
      cover: null,
    },
    comments: [],
    user: { id: randomUUID(), email: "cover@example.test", name: "Cover owner" },
    canManage: true,
  };
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not listen");
  const origin = `http://127.0.0.1:${address.port}`;
  const session: PreviewSession = {
    url: `${origin}/`,
    origin,
    targetUrl: data.project.url!,
    channel: "d".repeat(32),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
  const apiPath = `/api/reviews/${data.project.shareToken}`;
  const uploads: Buffer[] = [];
  const browserLanguages: string[] = [];
  let redirects = 0;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === apiPath && request.method() === "GET") await route.fulfill({ json: data });
    else if (path === `${apiPath}/preview` && request.method() === "POST")
      await route.fulfill({ json: session });
    else if (path === `/api/projects/${data.project.id}/cover` && request.method() === "POST") {
      uploads.push(request.postDataBuffer()!);
      data.project.cover = { source: "automatic", version: "fixture-cover" };
      await route.fulfill({ json: { cover: data.project.cover } });
    } else await route.fulfill({ status: 500, json: { error: "Unexpected fixture request" } });
  });
  server.on("request", (request, response) => {
    // Registration returned '/' without browser language. The native iframe GET
    // carries French Accept-Language and follows this same-origin HTTP redirect.
    if (new URL(request.url!, origin).pathname === "/") {
      const language = request.headers["accept-language"] ?? "";
      browserLanguages.push(language);
      if (!/^fr/i.test(language)) {
        response.writeHead(400, { "content-type": "text/plain" });
        response.end("French browser language is required by this fixture");
        return;
      }
      redirects++;
      response.writeHead(302, { location: "/fr", "cache-control": "no-store" });
      response.end();
      return;
    }
    if (new URL(request.url!, origin).pathname !== "/fr") {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" });
    response.end(`<!doctype html><html><body data-cover-requests="0"><h1>French landing page</h1><script>
        const config = ${JSON.stringify({
          channel: session.channel,
          target: new URL(session.targetUrl).origin,
          parentOrigin: new URL(baseURL()).origin,
          navigateBeforeCapture,
        })};
        const emit = value => parent.postMessage({source:'repere-preview',channel:config.channel,...value},config.parentOrigin);
        const ready = () => emit({type:'ready',url:config.target+'/fr',title:'French landing page'});
        addEventListener('message',event=>{
          if(event.source!==parent || event.origin!==config.parentOrigin || event.data?.source!=='repere' || event.data.channel!==config.channel)return;
          if(event.data.type==='init')ready();
          if(event.data.type!=='cover')return;
          document.body.dataset.coverRequests=String(Number(document.body.dataset.coverRequests)+1);
          const canvas=document.createElement('canvas');canvas.width=600;canvas.height=400;
          const context=canvas.getContext('2d');context.fillStyle='#3657e8';context.fillRect(0,0,600,400);
          if(config.navigateBeforeCapture){
            history.pushState(null,'','/account');
            emit({type:'location',url:config.target+'/account',title:'Another page'});
          }else ready();
          emit({type:'cover',requestId:event.data.requestId,capture:{dataUrl:canvas.toDataURL('image/jpeg'),pointX:.5,pointY:.5,capturedAt:new Date().toISOString()}});
        });
        ready();
      </script></body></html>`);
  });
  return {
    path: `/r/${data.project.shareToken}`,
    uploads,
    browserLanguages,
    redirects: () => redirects,
  };
}

test("the first ready page can create a cover after a browser-language redirect", async ({
  page,
  coverServer,
}) => {
  const fixture = await redirectedCoverFixture(page, coverServer, false);
  await page.goto(fixture.path);
  const frame = page.frameLocator("iframe.native-preview");
  await expect(frame.getByRole("heading", { name: "French landing page" })).toBeVisible();
  await expect.poll(() => fixture.uploads.length).toBe(1);
  expect(fixture.redirects()).toBe(1);
  expect(fixture.browserLanguages).toEqual([expect.stringMatching(/^fr/i)]);
  await expect(frame.locator("body")).toHaveAttribute("data-cover-requests", "1");
  expect(fixture.uploads[0].toString("latin1")).toContain('name="source"\r\n\r\nautomatic');
  expect(fixture.uploads[0].toString("latin1")).toContain("Content-Type: image/jpeg");
});

test("navigation after the initial ready page discards a late cover instead of uploading another page", async ({
  page,
  coverServer,
}) => {
  await page.clock.install();
  const fixture = await redirectedCoverFixture(page, coverServer, true);
  await page.goto(fixture.path);
  const frame = page.frameLocator("iframe.native-preview");
  await expect(frame.locator("body")).toHaveAttribute("data-cover-requests", "1");
  await expect(page.locator("#review-page-address")).toHaveValue(
    "https://language.example.test/account",
  );
  await page.clock.fastForward(20_000);
  expect(fixture.uploads).toHaveLength(0);
  await expect(frame.locator("body")).toHaveAttribute("data-cover-requests", "1");
});
