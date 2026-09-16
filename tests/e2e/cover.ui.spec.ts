import { test, expect, type Page } from "@playwright/test";
import sharp from "sharp";
import { createHash } from "node:crypto";
import type { Project, ReviewData } from "../../shared/types";
import {
  assertLocalWorkspaceEnvironment,
  authenticatedPage,
  createWebsite,
  pdfFixture,
} from "./helpers";

async function settings(page: Page) {
  await page.locator("details.review-options summary").click();
  await page.getByRole("button", { name: "Paramètres du projet", exact: true }).click();
  return page.getByRole("dialog", { name: "Paramètres du projet", exact: true });
}
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function pixel(bytes: Buffer, color: number[]) {
  const { data, info } = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offset =
    (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  for (const [channel, expected] of color.entries())
    expect(Math.abs(data[offset + channel] - expected)).toBeLessThan(18);
}

test("projects retain automatic website and first-page PDF covers, with a reversible custom image", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  assertLocalWorkspaceEnvironment();
  const { api } = await authenticatedPage(page, `covers-${testInfo.project.name}`);
  try {
    const website = await createWebsite(api, "Website cover");
    const review = `/api/reviews/${website.shareToken}`;
    const image = `/api/projects/${website.id}/cover`;
    const read = async () => ((await (await api.get(review)).json()) as ReviewData).project;
    await page.goto(`/r/${website.shareToken}`);
    await expect
      .poll(async () => (await read()).cover?.source, { timeout: 25_000 })
      .toBe("automatic");
    const automatic = await (await api.get(image)).body();
    const stats = await sharp(automatic).stats();
    expect(stats.channels.some((channel) => channel.stdev > 10)).toBe(true);
    const dialog = await settings(page);
    await expect(dialog.locator(".project-cover-image")).toBeVisible();
    const custom = await sharp({
      create: { width: 900, height: 600, channels: 3, background: { r: 156, g: 38, b: 180 } },
    })
      .png()
      .toBuffer();
    const uploaded = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === image && response.request().method() === "POST",
    );
    await dialog.getByLabel("Changer l’image", { exact: true }).setInputFiles({
      name: "custom.png",
      mimeType: "image/png",
      buffer: custom,
    });
    expect((await uploaded).status()).toBe(200);
    await expect(
      dialog.getByRole("button", { name: "Utiliser l’aperçu automatique" }),
    ).toBeVisible();
    await pixel(await (await api.get(image)).body(), [156, 38, 180]);
    await expect.poll(async () => (await read()).cover?.source).toBe("custom");
    await page.screenshot({
      path: testInfo.outputPath("cover-settings-desktop.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({
      path: testInfo.outputPath("cover-settings-mobile.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.reload();
    await expect.poll(async () => (await read()).cover?.source).toBe("custom");
    const reopened = await settings(page);
    const removed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === image && response.request().method() === "DELETE",
    );
    await reopened.getByRole("button", { name: "Utiliser l’aperçu automatique" }).click();
    expect((await removed).status()).toBe(200);
    await expect.poll(async () => (await read()).cover?.source).toBe("automatic");
    expect(hash(await (await api.get(image)).body())).toBe(hash(automatic));
    await expect(
      reopened.getByRole("button", { name: "Utiliser l’aperçu automatique" }),
    ).toHaveCount(0);
    await reopened.getByLabel("Changer l’image", { exact: true }).setInputFiles({
      name: "unsupported.svg",
      mimeType: "image/svg+xml",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    });
    await expect(reopened.getByText("Choisissez une image PNG, JPG ou WebP.")).toBeVisible();
    expect(hash(await (await api.get(image)).body())).toBe(hash(automatic));
    await page.keyboard.press("Escape");

    const pdfResult = await api.post(`/api/projects?workspaceId=${website.workspaceId}`, {
      multipart: {
        name: "PDF cover",
        type: "pdf",
        file: {
          name: "cover.pdf",
          mimeType: "application/pdf",
          buffer: pdfFixture(["0.86 0.16 0.24", "0.08 0.32 0.82"]),
        },
      },
    });
    expect(pdfResult.status()).toBe(201);
    const { project: pdf } = (await pdfResult.json()) as { project: Project };
    await page.goto(`/r/${pdf.shareToken}`);
    await expect
      .poll(
        async () => {
          const current = (await (
            await api.get(`/api/reviews/${pdf.shareToken}`)
          ).json()) as ReviewData;
          return current.project.cover?.source;
        },
        { timeout: 20_000 },
      )
      .toBe("automatic");
    const pdfImage = `/api/projects/${pdf.id}/cover`;
    const firstPage = await (await api.get(pdfImage)).body();
    await pixel(firstPage, [219, 41, 61]);
    await page.locator("details.review-options summary").click();
    await page.getByLabel("Numéro de page PDF", { exact: true }).fill("2");
    await expect(page.locator(".pdf-page")).toHaveAttribute("aria-busy", "false");
    expect(hash(await (await api.get(pdfImage)).body())).toBe(hash(firstPage));

    await page.goto(`/?workspace=${website.workspaceId}`);
    await expect(page.locator(".project-card .project-cover-image")).toHaveCount(2);
    for (const element of await page.locator(".project-card .project-cover-image").all())
      await expect
        .poll(() => element.evaluate((image: HTMLImageElement) => image.naturalWidth))
        .toBeGreaterThan(0);
    await page.screenshot({
      path: testInfo.outputPath("project-covers-desktop.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".project-card .project-cover-image").first()).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    await page.screenshot({
      path: testInfo.outputPath("project-covers-mobile.png"),
      animations: "disabled",
    });
  } finally {
    await api.dispose();
  }
});
