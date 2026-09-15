import { expect, test, type Page, type Route } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { PreviewSession } from "../../shared/preview";
import type { ReviewData } from "../../shared/types";
import en from "../../src/i18n/messages/en/website.json";
import fr from "../../src/i18n/messages/fr/website.json";
import { baseURL } from "./helpers";

async function previewFixture(page: Page, failure: "request" | "handshake") {
  const ownerId = randomUUID();
  const timestamp = new Date().toISOString();
  const data: ReviewData = {
    project: {
      id: randomUUID(),
      name: "Preview opening fixture",
      description: null,
      type: "website",
      url: "https://opening.example.test/work",
      fileName: null,
      shareToken: randomUUID().replaceAll("-", "").padEnd(43, "a"),
      ownerId,
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      commentCount: 0,
      resolvedCount: 0,
    },
    comments: [],
    user: { id: ownerId, email: "opening@example.test", name: "Preview owner" },
    isOwner: true,
  };
  const origin = `https://${"a".repeat(48)}.preview.example.test`;
  const session: PreviewSession = {
    url: `${origin}/work`,
    origin,
    targetUrl: data.project.url!,
    channel: "b".repeat(32),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
  let attempts = 0;
  let recovered = false;
  const pendingRequests: Route[] = [];
  const apiPath = `/api/reviews/${data.project.shareToken}`;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === apiPath && route.request().method() === "GET") {
      await route.fulfill({ json: data });
    } else if (path === `${apiPath}/preview` && route.request().method() === "POST") {
      attempts++;
      if (failure === "request" && !recovered) {
        // Keep the real browser request pending; the UI must cancel its own wait.
        pendingRequests.push(route);
        return;
      }
      await route.fulfill({ json: session });
    } else {
      await route.fulfill({ status: 500, json: { error: "Unexpected fixture request" } });
    }
  });
  await page.route(`${origin}/**`, (route) => {
    const silent = failure === "handshake" && !recovered;
    return route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><h1>Website fixture</h1>${
        silent
          ? ""
          : `<script>
          const config = ${JSON.stringify({
            channel: session.channel,
            url: session.targetUrl,
            parentOrigin: new URL(baseURL()).origin,
          })};
          const ready = () => parent.postMessage({
            source: "repere-preview", channel: config.channel,
            type: "ready", url: config.url, title: "Website fixture"
          }, config.parentOrigin);
          addEventListener("message", event => {
            if (event.source === parent && event.origin === config.parentOrigin &&
                event.data?.source === "repere" && event.data.channel === config.channel &&
                event.data.type === "init") ready();
          });
          ready();
        </script>`
      }</body></html>`,
    });
  });
  return {
    path: `/r/${data.project.shareToken}`,
    targetUrl: session.targetUrl,
    attempts: () => attempts,
    recover: () => {
      recovered = true;
    },
    releasePending: () =>
      Promise.all(pendingRequests.map((route) => route.fulfill({ json: session }).catch(() => {}))),
  };
}

test("a stalled preview request times out in French and retry discards the old attempt", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await previewFixture(page, "request");
  await page.goto(fixture.path);
  await expect(page.getByText(fr.loading, { exact: true })).toBeVisible();
  await expect.poll(fixture.attempts).toBeGreaterThan(0);
  await page.clock.fastForward(26_000);
  const error = page.locator(".native-shell .viewer-state");
  await expect(error.getByRole("heading", { name: fr.retryTitle })).toBeVisible();
  await expect(error.getByText(fr.timeout, { exact: true })).toBeVisible();
  await expect(error.getByRole("link", { name: fr.openExternal })).toHaveAttribute(
    "href",
    fixture.targetUrl,
  );
  await expect(page.locator("iframe.native-preview")).toHaveCount(0);
  const attemptsBeforeRetry = fixture.attempts();
  fixture.recover();
  await error.getByRole("button", { name: fr.retry, exact: true }).click();
  await expect.poll(fixture.attempts).toBe(attemptsBeforeRetry + 1);
  await expect(error).toHaveCount(0);
  await fixture.releasePending();
  await page.clock.fastForward(40_000);
  await expect(error).toHaveCount(0);
  await expect(
    page.frameLocator("iframe.native-preview").getByRole("heading", { name: "Website fixture" }),
  ).toBeVisible();
});

test("a silent preview cannot extend the opening deadline by reloading and retry recovers in English", async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: baseURL(), locale: "en-US" });
  try {
    const page = await context.newPage();
    await page.clock.install();
    const fixture = await previewFixture(page, "handshake");
    await page.goto(fixture.path);
    const frameHeading = page
      .frameLocator("iframe.native-preview")
      .getByRole("heading", { name: "Website fixture" });
    await expect(frameHeading).toBeVisible();
    await expect(page.getByText(en.loading, { exact: true })).toBeVisible();
    await page.clock.fastForward(12_000);
    await frameHeading.evaluate(() => location.reload());
    await expect(frameHeading).toBeVisible();
    await page.clock.fastForward(14_000);
    const error = page.locator(".native-shell .viewer-state");
    await expect(error.getByText(en.timeout, { exact: true })).toBeVisible();
    await expect(error.getByRole("link", { name: en.openExternal })).toHaveAttribute(
      "target",
      "_blank",
    );
    const attemptsBeforeRetry = fixture.attempts();
    fixture.recover();
    await error.getByRole("button", { name: en.retry, exact: true }).click();
    await expect.poll(fixture.attempts).toBe(attemptsBeforeRetry + 1);
    await expect(error).toHaveCount(0);
    // A successfully opened document can reload without starting a stale timer.
    await frameHeading.evaluate(() => location.reload());
    await expect(frameHeading).toBeVisible();
    await page.clock.fastForward(40_000);
    await expect(error).toHaveCount(0);
  } finally {
    await context.close();
  }
});
