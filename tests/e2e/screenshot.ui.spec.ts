import { test, expect, type Locator, type Page, type Route } from "@playwright/test";
import sharp from "sharp";
import type { CaptureInput, Feedback, Project, ReviewData } from "../../shared/types";
import { assertLocalWorkspaceEnvironment, authenticatedPage, createWebsite } from "./helpers";

async function projectOptions(page: Page, open: boolean) {
  const options = page.locator("details.review-options");
  if (((await options.getAttribute("open")) !== null) !== open)
    await options.locator("summary").click();
}

async function decodedImage(image: Locator) {
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
    .toBeGreaterThan(0);
}

type CaptureDelivery = { captureId: string; capture: CaptureInput };
type ProbeWindow = typeof window & {
  captureProbe: {
    lastId: string | null;
    held: CaptureDelivery | null;
    hold: boolean;
    deliveries: number;
  };
};

async function observeCaptureDelivery(page: Page) {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    const probe = {
      lastId: null,
      held: null,
      hold: true,
      deliveries: 0,
    } as ProbeWindow["captureProbe"];
    (window as ProbeWindow).captureProbe = probe;
    // Hold only renderer results from the real preview, before the application's
    // listener runs. Replays below still originate in that exact cross-origin frame.
    window.addEventListener("message", (event) => {
      const iframe = document.querySelector<HTMLIFrameElement>('iframe[title="Site en relecture"]');
      if (
        !iframe?.src ||
        event.source !== iframe.contentWindow ||
        event.origin !== new URL(iframe.src).origin ||
        event.data?.source !== "repere-preview"
      )
        return;
      if (event.data.type === "anchor") probe.lastId = event.data.captureId;
      if (event.data.type === "capture") {
        if (probe.hold && event.data.captureId === probe.lastId && event.data.capture) {
          probe.held = { captureId: event.data.captureId, capture: event.data.capture };
          event.stopImmediatePropagation();
        } else probe.deliveries++;
      }
    });
  });
}

async function replayCapture(
  page: Page,
  frameBody: Locator,
  captureId: string,
  capture: CaptureInput | null,
) {
  const before = await page.evaluate(() => (window as ProbeWindow).captureProbe.deliveries);
  await frameBody.evaluate(
    (_body, payload) => {
      const config = JSON.parse(document.getElementById("repere-preview-config")!.textContent!) as {
        appOrigin: string;
        channel: string;
      };
      window.parent.postMessage(
        { source: "repere-preview", channel: config.channel, type: "capture", ...payload },
        config.appOrigin,
      );
    },
    { captureId, capture },
  );
  await expect
    .poll(() => page.evaluate(() => (window as ProbeWindow).captureProbe.deliveries))
    .toBeGreaterThan(before);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

async function publish(page: Page, token: string, body: string) {
  await page.getByLabel("Votre commentaire").fill(body);
  const response = page.waitForResponse(
    (result) =>
      result.request().method() === "POST" &&
      new URL(result.url()).pathname === `/api/reviews/${token}/comments`,
  );
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  const saved = await response;
  expect(saved.status(), await saved.text()).toBe(201);
  await expect(page.locator(".feedback-card").getByText(body, { exact: true })).toBeVisible();
  return ((await saved.json()) as { comment: Feedback }).comment;
}

async function expectPixel(bytes: Buffer, x: number, y: number, color: number[]) {
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset =
    (Math.floor(y * info.height) * info.width + Math.floor(x * info.width)) * info.channels;
  for (const [channel, value] of color.entries())
    expect(Math.abs(data[offset + channel] - value)).toBeLessThan(18);
}

/** Two real PDF pages with intentionally distinct paint, so a stale page cannot pass. */
function coloredPdf() {
  const streams = ["0.86 0.16 0.24 rg 0 0 595 842 re f", "0.08 0.32 0.82 rg 0 0 595 842 re f"];
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents 6 0 R >>",
    ...streams.map(
      (stream) => `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    ),
  ];
  let document = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(document);
}

test("website and PDF points keep their original pixels and open a positioned large screenshot", async ({
  page,
}, testInfo) => {
  test.setTimeout(150_000);
  assertLocalWorkspaceEnvironment();
  const { api } = await authenticatedPage(page, `screenshot-ui-${testInfo.project.name}`);
  try {
    const project = await createWebsite(api, "Immutable website screenshot");
    const route = `/api/reviews/${project.shareToken}`;
    let commentPosts = 0;
    page.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === `${route}/comments`)
        commentPosts++;
    });
    await observeCaptureDelivery(page);
    await page.goto(`/r/${project.shareToken}`);
    const site = page.frameLocator('iframe[title="Site en relecture"]');
    await expect(site.locator('.forma-site[data-hydrated="true"]')).toBeVisible({
      timeout: 30_000,
    });
    const probe = site.locator('[data-testid="capture-pixel-probe"]');
    await site.locator("body").evaluate((body) => {
      const target = document.createElement("div");
      target.dataset.testid = "capture-pixel-probe";
      target.style.cssText =
        "position:fixed;left:24px;top:24px;width:180px;height:140px;background:rgb(26,148,82);z-index:9999";
      body.append(target);
    });
    await page.getByRole("button", { name: "Commenter", exact: true }).click();
    await probe.click({ position: { x: 90, y: 70 } });
    await expect(page.getByLabel("Votre commentaire")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => (window as ProbeWindow).captureProbe.held !== null))
      .toBe(true);
    const cancelledCapture = await page.evaluate(() => (window as ProbeWindow).captureProbe.held!);
    await replayCapture(page, site.locator("body"), cancelledCapture.captureId, null);
    await page
      .getByLabel("Votre commentaire")
      .fill("A missing capture must not interrupt writing.");
    await expect(page.getByRole("button", { name: "Publier", exact: true })).toBeEnabled();
    await expect(page.locator(".new-feedback").getByRole("img")).toHaveCount(0);
    await page.getByRole("button", { name: "Annuler le commentaire", exact: true }).click();
    await page.evaluate(() => {
      (window as ProbeWindow).captureProbe.hold = false;
    });
    await replayCapture(
      page,
      site.locator("body"),
      cancelledCapture.captureId,
      cancelledCapture.capture,
    );
    await expect(page.getByLabel("Votre commentaire")).not.toBeVisible();
    expect(commentPosts).toBe(0);
    expect(((await (await api.get(route)).json()) as ReviewData).comments).toEqual([]);

    const point = await probe.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { x: (rect.left + 90) / innerWidth, y: (rect.top + 70) / innerHeight };
    });
    await page.evaluate(() => {
      (window as ProbeWindow).captureProbe.hold = true;
      (window as ProbeWindow).captureProbe.held = null;
    });
    await probe.click({ position: { x: 90, y: 70 } });
    await expect
      .poll(() => page.evaluate(() => (window as ProbeWindow).captureProbe.held !== null))
      .toBe(true);
    const currentCapture = await page.evaluate(() => (window as ProbeWindow).captureProbe.held!);
    expect(currentCapture.captureId).not.toBe(cancelledCapture.captureId);
    await replayCapture(page, site.locator("body"), cancelledCapture.captureId, {
      ...cancelledCapture.capture,
      pointX: 0.99,
      pointY: 0.99,
    });
    await expect(
      page.locator(".new-feedback").getByText("Capture en cours…", { exact: true }),
    ).toHaveCount(0);
    await expect(page.locator(".new-feedback").getByRole("img")).toHaveCount(0);
    // Change the actual page before publishing: the saved image must describe the click, not submit time.
    await probe.evaluate((element) => {
      (element as HTMLElement).style.backgroundColor = "rgb(220,40,60)";
    });
    const liveDraft = site.locator("repere-annotations .draft");
    const originalDraftPoint = await liveDraft.evaluate((element) => ({
      left: (element as HTMLElement).style.left,
      top: (element as HTMLElement).style.top,
    }));
    let receivedPost!: () => void;
    let failPost!: () => void;
    const postReceived = new Promise<void>((resolve) => {
      receivedPost = resolve;
    });
    const postReleased = new Promise<void>((resolve) => {
      failPost = resolve;
    });
    const holdPost = async (request: Route) => {
      expect(request.request().postDataJSON().capture.dataUrl).toBe(currentCapture.capture.dataUrl);
      receivedPost();
      await postReleased;
      await request.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "INTERNAL_ERROR", error: "Temporary test delivery failure." }),
      });
    };
    const commentPath = `${route}/comments`;
    const matchComment = (url: URL) => url.pathname === commentPath;
    await page.route(matchComment, holdPost);
    const failed = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" && new URL(response.url()).pathname === commentPath,
    );
    await page
      .getByLabel("Votre commentaire")
      .fill("Keep the green state from the point placement.");
    await page.getByRole("button", { name: "Publier", exact: true }).click();
    await expect(page.getByLabel("Votre commentaire")).toBeDisabled();
    await expect(page.locator(".new-feedback").getByRole("img")).toHaveCount(0);
    await expect(
      page.locator(".new-feedback").getByText("Capture en cours…", { exact: true }),
    ).toHaveCount(0);
    // Publishing waits for the current capture without exposing capture UI or
    // accepting the old response replayed above.
    expect(commentPosts).toBe(0);
    await page.evaluate(() => {
      (window as ProbeWindow).captureProbe.hold = false;
    });
    await replayCapture(
      page,
      site.locator("body"),
      currentCapture.captureId,
      currentCapture.capture,
    );
    await postReceived;
    await expect(
      page.getByRole("button", { name: "Annuler le commentaire", exact: true }),
    ).toBeDisabled();
    // The bridge sees this real click while POST is pending. Its temporary point
    // must be restored because the parent cannot replace a submitting draft.
    await probe.click({ position: { x: 15, y: 15 } });
    await expect
      .poll(() => page.evaluate(() => (window as ProbeWindow).captureProbe.lastId))
      .not.toBe(currentCapture.captureId);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect
      .poll(() =>
        liveDraft.evaluate((element) => ({
          left: (element as HTMLElement).style.left,
          top: (element as HTMLElement).style.top,
        })),
      )
      .toEqual(originalDraftPoint);
    await expect(page.locator(".new-feedback").getByRole("img")).toHaveCount(0);
    failPost();
    expect((await failed).status()).toBe(503);
    await page.unroute(matchComment, holdPost);
    await expect(page.getByRole("button", { name: "Publier", exact: true })).toBeEnabled();
    await expect(page.getByLabel("Votre commentaire")).toHaveValue(
      "Keep the green state from the point placement.",
    );
    await expect(page.locator(".new-feedback").getByRole("img")).toHaveCount(0);
    expect(((await (await api.get(route)).json()) as ReviewData).comments).toEqual([]);
    const comment = await publish(
      page,
      project.shareToken,
      "Keep the green state from the point placement.",
    );
    expect(comment.screenshot).toBeTruthy();
    expect(comment.screenshot!.pointX).toBeCloseTo(point.x, 2);
    expect(comment.screenshot!.pointY).toBeCloseTo(point.y, 2);
    const screenshotUrl = `${route}/comments/${comment.id}/screenshot`;
    const saved = await api.get(screenshotUrl);
    expect(saved.status()).toBe(200);
    const original = await saved.body();
    await expectPixel(original, point.x, point.y, [26, 148, 82]);
    expect(commentPosts).toBe(2);

    await page.getByRole("button", { name: "Naviguer", exact: true }).click();
    await site.getByRole("button", { name: "Ajouter une idée", exact: true }).click();
    await expect(site.getByText("1 idée partagée", { exact: true })).toBeVisible();
    expect(await site.locator("body").evaluate(() => scrollY)).toBeGreaterThan(0);
    expect(await (await api.get(screenshotUrl)).body()).toEqual(original);
    await page.reload();
    const card = page.locator(".feedback-card").filter({ hasText: comment.body });
    const captureButton = card.getByRole("button", { name: "Voir la capture", exact: true });
    await expect(card.getByRole("img")).toHaveCount(0);
    await expect(
      card.locator(".feedback-card-heading").getByRole("button", { name: "Voir la capture" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("comment-capture-icon.png"),
      animations: "disabled",
    });
    await captureButton.click();
    const dialog = page.getByRole("dialog", { name: "Capture du point", exact: true });
    await decodedImage(dialog.getByRole("img", { name: "Capture du point", exact: true }));
    const large = await dialog
      .getByRole("img", { name: "Capture du point", exact: true })
      .boundingBox();
    expect(large!.width).toBeGreaterThan(400);
    const pin = dialog.locator(".capture-pin");
    await expect(pin).toBeVisible();
    const pinPosition = await pin.evaluate((element) => ({
      x: Number.parseFloat((element as HTMLElement).style.left) / 100,
      y: Number.parseFloat((element as HTMLElement).style.top) / 100,
    }));
    expect(pinPosition.x).toBeCloseTo(comment.screenshot!.pointX, 3);
    expect(pinPosition.y).toBeCloseTo(comment.screenshot!.pointY, 3);
    const websiteImagePath = testInfo.outputPath("website-point-capture-expanded.png");
    await dialog.screenshot({ path: websiteImagePath, animations: "disabled" });
    await testInfo.attach("website-point-capture-expanded", {
      path: websiteImagePath,
      contentType: "image/png",
    });
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();

    // An unavailable capture stays unobtrusive and does not block publishing.
    const withoutImage = await createWebsite(api, "Capture unavailable");
    await page.goto(`/r/${withoutImage.shareToken}`);
    await expect(site.locator('.forma-site[data-hydrated="true"]')).toBeVisible();
    await page.getByRole("button", { name: "Commenter", exact: true }).click();
    await site.locator("h1").click();
    await expect
      .poll(() => page.evaluate(() => (window as ProbeWindow).captureProbe.held !== null))
      .toBe(true);
    const missingCapture = await page.evaluate(() => (window as ProbeWindow).captureProbe.held!);
    await replayCapture(page, site.locator("body"), missingCapture.captureId, null);
    const textOnly = await publish(
      page,
      withoutImage.shareToken,
      "This comment still publishes normally.",
    );
    expect(textOnly.screenshot).toBeNull();
    await expect(
      page.locator(".feedback-card").getByRole("button", { name: "Voir la capture" }),
    ).toHaveCount(0);

    const uploaded = await api.post("/api/projects", {
      multipart: {
        name: "Two distinct PDF snapshot pages",
        type: "pdf",
        file: { name: "colored-pages.pdf", mimeType: "application/pdf", buffer: coloredPdf() },
      },
    });
    expect(uploaded.status(), await uploaded.text()).toBe(201);
    const pdf = ((await uploaded.json()) as { project: Project }).project;
    await page.goto(`/r/${pdf.shareToken}`);
    await expect(page.locator(".pdf-page")).toHaveAttribute("aria-busy", "false");
    await projectOptions(page, true);
    await page.getByRole("button", { name: "Page PDF suivante", exact: true }).click();
    await expect(page.getByLabel("Numéro de page PDF")).toHaveValue("2");
    await expect(page.locator(".pdf-page")).toHaveAttribute("aria-busy", "false");
    await projectOptions(page, false);
    await page.getByRole("button", { name: "Commenter", exact: true }).click();
    await page.getByLabel("PDF, page 2", { exact: true }).click({ position: { x: 180, y: 160 } });
    await expect(page.locator(".new-feedback").getByRole("img")).toHaveCount(0);
    const pdfComment = await publish(
      page,
      pdf.shareToken,
      "The second page was blue at this point.",
    );
    expect(pdfComment.anchor.type).toBe("pdf");
    expect(pdfComment.anchor).toMatchObject({ page: 2 });
    expect(pdfComment.screenshot).toBeTruthy();
    if (pdfComment.anchor.type !== "pdf") throw new Error("Expected a PDF anchor");
    expect(pdfComment.screenshot!.pointX).toBeCloseTo(pdfComment.anchor.x, 3);
    expect(pdfComment.screenshot!.pointY).toBeCloseTo(pdfComment.anchor.y, 3);
    expect(pdfComment.screenshot!.width / pdfComment.screenshot!.height).toBeCloseTo(595 / 842, 2);
    const pdfScreenshot = `/api/reviews/${pdf.shareToken}/comments/${pdfComment.id}/screenshot`;
    const blue = await (await api.get(pdfScreenshot)).body();
    await expectPixel(blue, 0.7, 0.7, [20, 82, 209]);
    await projectOptions(page, true);
    await page.getByRole("button", { name: "Page PDF précédente", exact: true }).click();
    await expect(page.getByLabel("Numéro de page PDF")).toHaveValue("1");
    await expect(page.locator(".pdf-page")).toHaveAttribute("aria-busy", "false");
    await projectOptions(page, false);
    expect(await (await api.get(pdfScreenshot)).body()).toEqual(blue);
    await page
      .locator(".feedback-card")
      .getByRole("button", { name: "Voir la capture", exact: true })
      .click();
    await decodedImage(
      page
        .getByRole("dialog", { name: "Capture du point", exact: true })
        .getByRole("img", { name: "Capture du point", exact: true }),
    );
    const pdfImagePath = testInfo.outputPath("pdf-page-two-capture-expanded.png");
    await page
      .getByRole("dialog", { name: "Capture du point", exact: true })
      .screenshot({ path: pdfImagePath, animations: "disabled" });
    await testInfo.attach("pdf-page-two-capture-expanded", {
      path: pdfImagePath,
      contentType: "image/png",
    });
  } finally {
    await api.dispose();
  }
});
