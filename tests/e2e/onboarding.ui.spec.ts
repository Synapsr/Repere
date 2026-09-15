import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { PreviewSession } from "../../shared/preview";
import type { ReviewData } from "../../shared/types";
import en from "../../src/i18n/messages/en/review.json";
import fr from "../../src/i18n/messages/fr/review.json";
import { baseURL, pdfFixture } from "./helpers";

function reviewFixture({
  owner = false,
  pdf = false,
  archived = false,
}: { owner?: boolean; pdf?: boolean; archived?: boolean } = {}): ReviewData {
  const ownerId = randomUUID();
  const timestamp = new Date().toISOString();
  return {
    project: {
      id: randomUUID(),
      name: "Onboarding fixture",
      description: null,
      type: pdf ? "pdf" : "website",
      url: pdf ? null : "https://onboarding.example.test/work",
      fileName: pdf ? "onboarding.pdf" : null,
      shareToken: randomUUID().replaceAll("-", "").padEnd(43, "a"),
      ownerId,
      archived,
      createdAt: timestamp,
      updatedAt: timestamp,
      commentCount: 0,
      resolvedCount: 0,
    },
    comments: [],
    user: {
      id: owner ? ownerId : randomUUID(),
      email: "onboarding-reviewer@example.test",
      name: "Demo reviewer",
    },
    isOwner: owner,
  };
}

async function installReviewFixture(page: Page, data: ReviewData) {
  const routePath = `/api/reviews/${data.project.shareToken}`;
  const previewOrigin = `https://${"a".repeat(48)}.preview.example.test`;
  const session: PreviewSession = {
    url: `${previewOrigin}/work`,
    origin: previewOrigin,
    targetUrl: data.project.url ?? "https://onboarding.example.test/work",
    channel: "b".repeat(48),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
  const unexpectedApiCalls: string[] = [];
  let previewRequests = 0;

  // Only the page's data boundary is simulated. The real Review, modal, storage,
  // keyboard handling and CSS run in the app; no authentication or SMTP is used.
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === routePath && request.method() === "GET") {
      await route.fulfill({ json: data });
    } else if (path === `${routePath}/preview` && request.method() === "POST") {
      previewRequests++;
      await route.fulfill({ json: session });
    } else if (path === `${routePath}/file` && request.method() === "GET") {
      await route.fulfill({ contentType: "application/pdf", body: pdfFixture() });
    } else {
      unexpectedApiCalls.push(`${request.method()} ${path}`);
      await route.fulfill({
        status: 500,
        json: { error: "Unexpected request in isolated onboarding fixture" },
      });
    }
  });
  // A tiny isolated document acknowledges the real preview protocol. This avoids
  // opening a proxy session or making a request to an external website.
  await page.route(`${previewOrigin}/**`, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html lang="en"><head><title>Preview fixture</title></head>
        <body><h1>Website preview fixture</h1><script>
          const config = ${JSON.stringify({
            appOrigin: new URL(baseURL()).origin,
            channel: session.channel,
            targetUrl: session.targetUrl,
          })};
          const ready = () => parent.postMessage({
            source: "repere-preview", channel: config.channel,
            type: "ready", url: config.targetUrl, title: "Preview fixture"
          }, config.appOrigin);
          addEventListener("message", event => {
            if (event.source !== parent || event.origin !== config.appOrigin ||
                event.data?.source !== "repere" || event.data.channel !== config.channel) return;
            if (event.data.type === "init") ready();
          });
          ready();
        </script></body></html>`,
    }),
  );
  return {
    path: `/r/${data.project.shareToken}`,
    unexpectedApiCalls,
    previewRequests: () => previewRequests,
  };
}

async function waitForPreview(page: Page) {
  await expect(
    page.frameLocator("iframe.native-preview").getByRole("heading", {
      name: "Website preview fixture",
    }),
  ).toBeVisible();
  await expect(page.locator(".native-shell .viewer-state")).toHaveCount(0);
}

test("a first website guest sees the three-step introduction once and can replay it", async ({
  page,
}) => {
  const fixture = await installReviewFixture(page, reviewFixture());
  await page.goto(fixture.path);
  const dialog = page.getByRole("dialog", { name: fr.onboardingTitle });
  await expect(dialog).toBeVisible();
  await waitForPreview(page);
  const steps = dialog.locator(".review-onboarding-steps li");
  await expect(steps).toHaveCount(3);
  await expect(steps.locator("strong")).toHaveText([
    fr.browse,
    fr.comment,
    fr.onboardingResumeTitle,
  ]);
  for (const instruction of [fr.onboardingBrowse, fr.onboardingComment, fr.onboardingResume]) {
    await expect(dialog.getByText(instruction, { exact: true })).toBeVisible();
  }
  await dialog.getByRole("button", { name: fr.onboardingStart, exact: true }).click();
  await expect(dialog).toHaveCount(0);

  const modes = page.getByRole("group", { name: fr.mode, exact: true });
  await expect(modes.getByRole("button", { name: fr.browse, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await modes.getByRole("button", { name: fr.comment, exact: true }).click();
  await expect(modes.getByRole("button", { name: fr.comment, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await modes.getByRole("button", { name: fr.browse, exact: true }).click();
  await expect(modes.getByRole("button", { name: fr.browse, exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.reload();
  await waitForPreview(page);
  await expect(dialog).toHaveCount(0);
  await page.getByLabel(fr.options, { exact: true }).click();
  await page.getByRole("button", { name: fr.onboardingReplay, exact: true }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: fr.onboardingStart, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(fixture.unexpectedApiCalls).toEqual([]);
});

test("owners, PDF reviewers and archived projects are not automatically interrupted", async ({
  page,
}) => {
  for (const variant of [{ owner: true }, { pdf: true }, { owner: true, archived: true }]) {
    await page.unrouteAll({ behavior: "wait" });
    const data = reviewFixture(variant);
    const fixture = await installReviewFixture(page, data);
    await page.goto(fixture.path);
    await expect(page.getByRole("heading", { name: data.project.name, exact: true })).toBeVisible();
    if (data.project.archived) {
      await expect(page.getByRole("heading", { name: fr.archivedTitle })).toBeVisible();
      await expect(page.getByRole("button", { name: fr.comment, exact: true })).toBeDisabled();
      expect(fixture.previewRequests()).toBe(0);
    } else if (data.project.type === "pdf") {
      await expect(page.locator(".pdf-page canvas")).toBeVisible();
      await expect(page.locator(".pdf-loading")).toHaveCount(0);
      expect(fixture.previewRequests()).toBe(0);
    } else {
      await waitForPreview(page);
    }
    await expect(page.getByRole("dialog", { name: fr.onboardingTitle })).toHaveCount(0);
    expect(fixture.unexpectedApiCalls).toEqual([]);
  }
});

test("the introduction respects reduced motion, Escape and unavailable local storage", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: baseURL(),
    locale: "en-US",
    reducedMotion: "reduce",
  });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fixture = await installReviewFixture(page, reviewFixture());
    await page.goto(fixture.path);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    const dialog = page.getByRole("dialog", { name: en.onboardingTitle });
    await expect(dialog).toBeVisible();
    await waitForPreview(page);
    await expect(dialog.getByText(en.onboardingResume, { exact: true })).toBeVisible();
    const demo = dialog.locator(".review-onboarding-demo");
    await expect(demo.locator(".review-onboarding-pointer")).toBeHidden();
    await expect(demo.locator(".review-onboarding-pin")).toBeVisible();
    expect(await demo.evaluate((element) => element.getAnimations({ subtree: true }).length)).toBe(
      0,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await page.reload();
    await waitForPreview(page);
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(fixture.unexpectedApiCalls).toEqual([]);
  } finally {
    await context.close();
  }

  const blockedContext = await browser.newContext({ baseURL: baseURL(), locale: "en-US" });
  try {
    await blockedContext.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get() {
          throw new DOMException("Storage access denied", "SecurityError");
        },
      });
    });
    const page = await blockedContext.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const fixture = await installReviewFixture(page, reviewFixture());
    await page.goto(fixture.path);
    const dialog = page.getByRole("dialog", { name: en.onboardingTitle });
    await expect(dialog).toBeVisible();
    await waitForPreview(page);
    await dialog.getByRole("button", { name: en.onboardingStart, exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const comment = page
      .getByRole("group", { name: en.mode, exact: true })
      .getByRole("button", { name: en.comment, exact: true });
    await comment.click();
    await expect(comment).toHaveAttribute("aria-pressed", "true");
    await expect(dialog).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(fixture.unexpectedApiCalls).toEqual([]);
  } finally {
    await blockedContext.close();
  }
});
