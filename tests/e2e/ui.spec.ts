import { test, expect, type Page, type Request } from "@playwright/test";
import type { Project, ReviewData } from "../../shared/types";
import { ccittPdfFixture } from "../fixtures/ccitt-pdf";
import {
  authenticatedPage,
  baseURL,
  createWebsite,
  emailCode,
  identity,
  pdfFixture,
  websiteAnchor,
  websiteURL,
} from "./helpers";

async function signInThroughUI(page: Page, label: string) {
  const person = identity(label);
  await page.getByLabel("Votre prénom").fill(person.name);
  await page.getByLabel("Votre adresse email").fill(person.email);
  await page.getByRole("button", { name: "Recevoir mon code" }).click();
  await expect(page.getByLabel("Code de connexion")).toBeVisible();
  await page.getByLabel("Code de connexion").fill(await emailCode(person.email));
  await page.getByRole("button", { name: "Se connecter" }).click();
  return person;
}

async function projectOptions(page: Page, open: boolean) {
  const options = page.locator("details.review-options");
  await expect(options).toBeVisible();
  if (((await options.getAttribute("open")) !== null) !== open)
    await options.locator("summary").click();
}

async function publishComment(page: Page, buttonName: string, body: string) {
  const route = `/api/reviews/${new URL(page.url()).pathname.split("/").at(-1)}/comments`;
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === route,
  );
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.locator(".feedback-card").getByText(body, { exact: true })).toBeVisible();
}

async function waitForWebsite(page: Page) {
  const iframe = page.locator('iframe[title="Site en relecture"]');
  await expect(iframe).toBeVisible({ timeout: 30_000 });
  const source = new URL((await iframe.getAttribute("src"))!);
  expect(source.hostname).toMatch(/^[a-f0-9]{48}\./);
  expect(source.origin).not.toBe(new URL(page.url()).origin);
  const site = page.frameLocator('iframe[title="Site en relecture"]');
  await expect(site.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 30_000 });
  await expect(site.locator('.forma-site[data-hydrated="true"]')).toBeVisible();
  return site;
}

test("OTP, website creation, precise page comments and shared review work end to end", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const siteRequests: Request[] = [];
  page.on("request", (request) => {
    if (/^[a-f0-9]{48}\./.test(new URL(request.url()).hostname)) siteRequests.push(request);
  });
  await page.goto("/login");
  const owner = await signInThroughUI(page, `ui-owner-${testInfo.project.name}`);
  await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
  await page.getByRole("button", { name: "Nouveau projet", exact: true }).click();
  const projectName = `Studio review ${testInfo.project.name}`;
  await page.getByLabel("Nom du projet", { exact: true }).fill(projectName);
  await page.getByLabel("Adresse du site").fill(websiteURL());
  await page.getByRole("button", { name: "Créer le projet", exact: true }).click();
  await expect(page.getByRole("heading", { name: projectName, exact: true })).toBeVisible();
  const site = await waitForWebsite(page);
  const previewUrl = (await page.locator('iframe[title="Site en relecture"]').getAttribute("src"))!;
  const appSession = (await page.context().cookies(page.url())).find((cookie) => cookie.httpOnly);
  expect(appSession).toBeTruthy();
  // Playwright's cookie URL filter includes localhost subdomains for host-only cookies;
  // inspect the real browser request to check what was actually sent to the preview.
  const documentRequest = siteRequests.find((request) => request.isNavigationRequest());
  expect(documentRequest).toBeTruthy();
  expect((await documentRequest!.allHeaders()).cookie ?? "").not.toContain(`${appSession!.name}=`);
  const frame = page
    .frames()
    .find((candidate) => candidate.url().startsWith(new URL(previewUrl).origin));
  expect(frame).toBeTruthy();
  expect(
    await frame!.evaluate(() => {
      try {
        return window.parent.document.title;
      } catch (error) {
        return error instanceof DOMException ? error.name : "unknown";
      }
    }),
  ).toBe("SecurityError");
  await frame!.evaluate((targetHost) => {
    document.cookie = `native_script_probe=present; Domain=${targetHost}; Path=/`;
  }, new URL(websiteURL()).hostname);
  expect(await frame!.evaluate(() => document.cookie)).toContain("native_script_probe=present");
  expect(await page.evaluate(() => document.cookie)).not.toContain("native_script_probe");
  const cookieEndpoint = new URL("/demo-site/cookies", websiteURL()).toString();
  expect(
    await frame!.evaluate(async (url) => {
      await fetch(`${url}?set=1`, { credentials: "include" });
      return (await fetch(url, { credentials: "include" })).json() as Promise<{ present: boolean }>;
    }, cookieEndpoint),
  ).toMatchObject({ present: true });
  expect(await frame!.evaluate(() => document.cookie)).not.toContain("native_server_probe");
  expect((await page.context().cookies(page.url())).map((cookie) => cookie.name)).not.toContain(
    "native_server_probe",
  );
  const token = new URL(page.url()).pathname.split("/").at(-1)!;

  // Real links, inputs and JavaScript run directly in the reviewer's browser.
  await site.getByRole("link", { name: "Le studio", exact: true }).click();
  await expect(site.getByRole("heading", { level: 1 })).toContainText("De bonnes personnes.");
  const about = new URL(websiteURL());
  about.pathname = `${about.pathname.replace(/\/$/, "")}/about`;
  await expect(page.getByLabel("Adresse de la page")).toHaveValue(about.toString());
  // SSR controls are visible before Next.js finishes attaching their event handlers.
  await expect(site.locator('.forma-site[data-hydrated="true"]')).toBeVisible();
  await site.getByRole("button", { name: "Ajouter une idée" }).click();
  await expect(site.getByText("1 idée partagée", { exact: true })).toBeVisible();
  await site.getByLabel("Votre email", { exact: true }).fill("native-review@example.test");
  await site.getByRole("button", { name: "Envoyer ma demande" }).click();
  await expect(site.getByRole("status")).toContainText(
    "Votre demande de démonstration est enregistrée",
  );
  await site.getByRole("tab", { name: "Web", exact: true }).click();
  await expect(site.getByText("Maison Noma", { exact: true })).toBeVisible();
  about.hash = "web";
  await expect(page.getByLabel("Adresse de la page")).toHaveValue(about.toString());
  const heading = site.getByRole("heading", { level: 1 });
  const websiteLink = site.getByRole("link", { name: "Le studio", exact: true });
  const nativeHeadingCursor = await heading.evaluate((element) => getComputedStyle(element).cursor);
  const nativeLinkCursor = await websiteLink.evaluate(
    (element) => getComputedStyle(element).cursor,
  );
  await page.getByRole("button", { name: "Commenter", exact: true }).click();
  await expect(heading).toHaveCSS("cursor", /data:image\/svg\+xml/);
  const addingCursor = await heading.evaluate((element) => getComputedStyle(element).cursor);
  await expect(websiteLink).toHaveCSS("cursor", addingCursor);
  // Confirm that the native cursor image actually decodes, not just that CSS accepts it.
  expect(
    await heading.evaluate(async (element) => {
      const url = getComputedStyle(element).cursor.match(/url\("([^\"]+)"\)/)![1];
      const image = new Image();
      image.src = url;
      await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    }),
  ).toEqual([32, 32]);
  await frame!.evaluate(() => {
    const config = JSON.parse(document.getElementById("repere-preview-config")!.textContent!) as {
      appOrigin: string;
      channel: string;
      targetOrigin: string;
    };
    const base = {
      type: "website",
      url: `${config.targetOrigin}/demo-site/about#web`,
      selector: "h1",
      text: "Forged",
      x: 0.5,
      y: 0.5,
      documentX: 100,
      documentY: 100,
      viewportWidth: 1200,
      viewportHeight: 800,
    };
    window.parent.postMessage(
      {
        source: "repere-preview",
        channel: config.channel,
        type: "anchor",
        anchor: { ...base, text: {} },
      },
      config.appOrigin,
    );
    window.parent.postMessage(
      {
        source: "repere-preview",
        channel: config.channel,
        type: "anchor",
        anchor: { ...base, url: "https://unrelated.example/" },
      },
      config.appOrigin,
    );
  });
  await expect(page.getByLabel("Votre commentaire")).not.toBeVisible();
  await expect(page.getByRole("heading", { name: projectName, exact: true })).toBeVisible();
  await site.getByRole("heading", { level: 1 }).click({ position: { x: 100, y: 35 } });
  await expect(page.getByLabel("Votre commentaire")).toBeVisible();
  await expect(heading).not.toHaveCSS("cursor", addingCursor);
  await expect(heading).toHaveCSS("cursor", /data:image\/svg\+xml/);
  const placedCursor = await heading.evaluate((element) => getComputedStyle(element).cursor);
  await expect(site.locator("repere-annotations .draft")).toBeVisible();
  await expect(site.locator("repere-annotations .draft")).toBeEmpty();
  await page.getByRole("button", { name: "Annuler le commentaire", exact: true }).click();
  await expect(heading).toHaveCSS("cursor", addingCursor);
  await expect(site.locator("repere-annotations .draft")).toHaveCount(0);
  await heading.click({ position: { x: 100, y: 35 } });
  await expect(heading).toHaveCSS("cursor", placedCursor);
  const body = "Ce titre mérite un peu plus de respiration.";
  await page.getByLabel("Votre commentaire").fill(body);
  await publishComment(page, "Publier", body);
  await expect(heading).toHaveCSS("cursor", addingCursor);
  const persisted = (await (await page.request.get(`/api/reviews/${token}`)).json()) as ReviewData;
  expect(persisted.comments[0].author.name).toBe(owner.name);
  expect(persisted.comments[0].anchor).toMatchObject({ type: "website", url: about.toString() });
  if (persisted.comments[0].anchor.type === "website") {
    expect(persisted.comments[0].anchor.selector).toBeTruthy();
    expect(persisted.comments[0].anchor.x).toBeGreaterThanOrEqual(0);
    expect(persisted.comments[0].anchor.x).toBeLessThanOrEqual(1);
  }
  await expect(site.getByRole("button", { name: "Retour 1", exact: true })).toBeVisible();
  const iframeReloaded = page.waitForEvent("framenavigated", (candidate) => candidate === frame);
  await projectOptions(page, true);
  await page.getByRole("button", { name: "Actualiser le site" }).click();
  await projectOptions(page, false);
  await iframeReloaded;
  await expect(site.locator('.forma-site[data-hydrated="true"]')).toBeVisible();
  await expect(site.getByRole("button", { name: "Retour 1", exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "Naviguer", exact: true }).click();
  await expect(heading).toHaveCSS("cursor", nativeHeadingCursor);
  await expect(websiteLink).toHaveCSS("cursor", nativeLinkCursor);
  await site.getByRole("button", { name: "Ajouter une idée" }).click();
  await expect(site.getByText("1 idée partagée", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ouvrir le retour 1", exact: true }).click();
  await page.getByRole("button", { name: "Partager", exact: true }).click();
  const sharedLink = await page.getByLabel("Lien de relecture").inputValue();
  expect(sharedLink).toBe(page.url());
  await page.getByRole("dialog").getByRole("button", { name: "Fermer" }).click();

  const reviewerContext = await browser.newContext({ locale: "fr-FR" });
  const reviewerPage = await reviewerContext.newPage();
  try {
    await reviewerPage.goto(sharedLink);
    await expect(
      reviewerPage.getByRole("heading", { name: "Rejoignez la conversation." }),
    ).toBeVisible();
    await expect(
      reviewerPage.locator(".feedback-card").getByText(body, { exact: true }),
    ).not.toBeVisible();
    const reviewer = await signInThroughUI(reviewerPage, `ui-guest-${testInfo.project.name}`);
    const welcome = reviewerPage.getByRole("dialog", {
      name: "Un petit repère avant de commencer",
    });
    await expect(welcome).toBeVisible();
    await welcome.getByRole("button", { name: "C’est parti", exact: true }).click();
    await expect(welcome).not.toBeVisible();
    await expect(
      reviewerPage.locator(".feedback-card").getByText(body, { exact: true }),
    ).toBeVisible();
    await waitForWebsite(reviewerPage);
    const guestPreviewUrl = (await reviewerPage
      .locator('iframe[title="Site en relecture"]')
      .getAttribute("src"))!;
    expect(new URL(guestPreviewUrl).origin).not.toBe(new URL(previewUrl).origin);
    const guestFrame = reviewerPage
      .frames()
      .find((candidate) => candidate.url().startsWith(new URL(guestPreviewUrl).origin));
    expect(await guestFrame!.evaluate(() => document.cookie)).not.toContain("native_script_probe");
    expect(
      await guestFrame!.evaluate(
        async (url) =>
          (await fetch(url, { credentials: "include" })).json() as Promise<{ present: boolean }>,
        cookieEndpoint,
      ),
    ).toMatchObject({ present: false });
    await reviewerPage.getByRole("button", { name: "Ouvrir le retour 1", exact: true }).click();
    const reply = "Bien vu, nous ajustons cette section.";
    await reviewerPage.getByLabel("Répondre au retour 1").fill(reply);
    await reviewerPage
      .locator(".replies form")
      .getByRole("button", { name: "Répondre", exact: true })
      .click();
    await expect(reviewerPage.locator(".reply").getByText(reply, { exact: true })).toBeVisible();
    await expect(
      reviewerPage.getByRole("button", { name: "Résoudre le retour 1" }),
    ).not.toBeVisible();
    await page.reload();
    await expect(page.locator(".feedback-card").getByText(body, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Ouvrir le retour 1", exact: true }).click();
    await expect(page.locator(".reply").getByText(reply, { exact: true })).toBeVisible();
    await expect(page.locator(".reply").getByText(reviewer.name, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Résoudre le retour 1" }).click();
    await expect(page.locator(".feedback-card").getByText(body, { exact: true })).not.toBeVisible();
    await page.getByRole("button", { name: /^Résolus/ }).click();
    await expect(page.locator(".feedback-card").getByText(body, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Rouvrir le retour 1" }).click();
    await page.getByRole("button", { name: /^À traiter/ }).click();
    await expect(page.locator(".feedback-card").getByText(body, { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("website-review.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    const hideFeedback = page.getByRole("button", { name: "Masquer les retours" });
    if (await hideFeedback.isVisible()) await hideFeedback.click();
    // Resizing a focused desktop comment must not pan or crop the native document.
    await expect
      .poll(async () =>
        site.locator("html").evaluate((html) => {
          const heading = document.querySelector("h1")!.getBoundingClientRect();
          return {
            scrollX,
            width: innerWidth,
            documentWidth: html.scrollWidth,
            headingFits: heading.left >= 0 && heading.right <= innerWidth + 1,
          };
        }),
      )
      .toEqual({ scrollX: 0, width: 390, documentWidth: 390, headingFits: true });
    const resizedFrame = await page.locator('iframe[title="Site en relecture"]').boundingBox();
    expect(resizedFrame?.x).toBe(0);
    expect(resizedFrame?.width).toBe(390);
    await projectOptions(page, true);
    await page.getByRole("button", { name: "Vue mobile" }).click();
    await expect(page.getByRole("button", { name: "Vue mobile" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await projectOptions(page, false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    const mobileFrame = await page.locator('iframe[title="Site en relecture"]').boundingBox();
    expect(mobileFrame?.width).toBeLessThanOrEqual(390);
    await page.screenshot({
      path: testInfo.outputPath("mobile-review.png"),
      fullPage: true,
      animations: "disabled",
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Projets" })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("dashboard.png"),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await reviewerContext.close();
  }
});

test("a PDF renders two pages and retains a precise point when changing pages and zoom", async ({
  page,
}, testInfo) => {
  const { api } = await authenticatedPage(page, `ui-pdf-${testInfo.project.name}`);
  try {
    await page.goto("/");
    await page.getByRole("button", { name: "Nouveau projet", exact: true }).click();
    await page.getByRole("button", { name: /Document PDF/ }).click();
    await page
      .getByLabel("Nom du projet", { exact: true })
      .fill(`Document review ${testInfo.project.name}`);
    await page.locator('input[type="file"]').setInputFiles({
      name: "brand-guidelines.pdf",
      mimeType: "application/pdf",
      buffer: pdfFixture(),
    });
    await page.getByRole("button", { name: "Créer le projet", exact: true }).click();
    await expect(page.getByLabel("PDF, page 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Chargement du document…", { exact: true })).not.toBeVisible({
      timeout: 30_000,
    });
    await projectOptions(page, true);
    await expect(page.getByRole("button", { name: "Page PDF suivante" })).toBeEnabled();
    await page.getByRole("button", { name: "Page PDF suivante" }).click();
    await expect(page.getByLabel("Numéro de page PDF")).toHaveValue("2");
    await expect(page.getByText("Chargement du document…", { exact: true })).not.toBeVisible();
    await projectOptions(page, false);
    await page.getByRole("button", { name: "Commenter", exact: true }).click();
    await page.getByLabel("PDF, page 2", { exact: true }).click({ position: { x: 180, y: 160 } });
    await page.getByLabel("Votre commentaire").fill("Ajuster cette zone sur la deuxième page.");
    await publishComment(page, "Publier", "Ajuster cette zone sur la deuxième page.");
    await expect(page.getByRole("button", { name: "Retour 1", exact: true })).toBeVisible();
    await projectOptions(page, true);
    await page.getByRole("button", { name: "Page PDF précédente" }).click();
    await expect(page.getByLabel("Numéro de page PDF")).toHaveValue("1");
    await expect(page.getByRole("button", { name: "Retour 1", exact: true })).not.toBeVisible();
    await projectOptions(page, false);
    await page.getByRole("button", { name: "Ouvrir le retour 1", exact: true }).click();
    await expect(page.getByLabel("Numéro de page PDF")).toHaveValue("2");
    await expect(page.getByRole("button", { name: "Retour 1", exact: true })).toBeVisible();
    const pin = page.getByRole("button", { name: "Retour 1", exact: true });
    const beforeZoom = await pin.getAttribute("style");
    // Focusing an already rendered page or entering the same numeric page must not
    // clear the bitmap, flash a loader, or leave the reader waiting indefinitely.
    const pdfPage = page.locator(".pdf-page");
    await expect(pdfPage).toHaveAttribute("aria-busy", "false");
    await pdfPage.evaluate((element) => {
      element.dataset.bitmapChanges = "0";
      element.dataset.loadingChanges = "0";
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "attributes" && record.target instanceof HTMLCanvasElement)
            element.dataset.bitmapChanges = String(Number(element.dataset.bitmapChanges) + 1);
          for (const node of record.addedNodes)
            if (
              node instanceof Element &&
              (node.matches(".pdf-loading") || node.querySelector(".pdf-loading"))
            )
              element.dataset.loadingChanges = String(Number(element.dataset.loadingChanges) + 1);
        }
      });
      observer.observe(element, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["width", "height"],
      });
      (element as HTMLElement & { renderObserver?: MutationObserver }).renderObserver = observer;
    });
    await page.getByRole("button", { name: "Ouvrir le retour 1", exact: true }).click();
    await projectOptions(page, true);
    await page.getByLabel("Numéro de page PDF").fill("02");
    await expect(pdfPage).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".pdf-loading")).toBeHidden();
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await pdfPage.evaluate((element) => {
        (
          element as HTMLElement & { renderObserver?: MutationObserver }
        ).renderObserver?.disconnect();
        return {
          bitmapChanges: Number(element.dataset.bitmapChanges),
          loadingChanges: Number(element.dataset.loadingChanges),
        };
      }),
    ).toEqual({ bitmapChanges: 0, loadingChanges: 0 });
    await projectOptions(page, true);
    await page.getByRole("button", { name: "Agrandir le PDF" }).click();
    await expect(page.getByText("125 %", { exact: true })).toBeVisible();
    expect(await pin.getAttribute("style")).toBe(beforeZoom);
    await page.reload();
    await projectOptions(page, false);
    await page.getByRole("button", { name: "Ouvrir le retour 1", exact: true }).click();
    await expect(page.getByLabel("Numéro de page PDF")).toHaveValue("2");
    await expect(page.getByRole("button", { name: "Retour 1", exact: true })).toBeVisible();
    await pin.scrollIntoViewIfNeeded();
    await expect(pin).toBeInViewport();
    await page.screenshot({
      path: testInfo.outputPath("pdf-review.png"),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await api.dispose();
  }
});

test("a scanned CCITT PDF loads its decoder and paints the actual image pixels", async ({
  page,
}, testInfo) => {
  const { api } = await authenticatedPage(page, `ui-scan-${testInfo.project.name}`);
  try {
    const created = await api.post("/api/projects", {
      multipart: {
        name: "Scanned PDF decoder regression",
        type: "pdf",
        file: { name: "scan.pdf", mimeType: "application/pdf", buffer: ccittPdfFixture() },
      },
    });
    expect(created.ok(), await created.text()).toBeTruthy();
    const { project } = (await created.json()) as { project: Project };
    const decoderLoaded = page.waitForResponse((response) =>
      /\/pdfjs\/[\d.]+\/wasm\/jbig2\.wasm$/.test(response.url()),
    );
    await page.goto(`/r/${project.shareToken}`);
    expect((await decoderLoaded).status()).toBe(200);
    const canvas = page.getByLabel("PDF, page 1", { exact: true });
    await expect(canvas).toBeVisible();
    await expect(page.getByText("Chargement du document…", { exact: true })).not.toBeVisible();
    await expect
      .poll(() =>
        canvas.evaluate((element) => {
          const image = element as HTMLCanvasElement;
          const context = image.getContext("2d")!;
          const sample = (fraction: number) =>
            Array.from(
              context.getImageData(
                Math.floor(image.width * fraction),
                Math.floor(image.height * fraction),
                1,
                1,
              ).data,
            );
          return { center: sample(0.5), corner: sample(0.1) };
        }),
      )
      .toEqual({ center: [0, 0, 0, 255], corner: [255, 255, 255, 255] });
  } finally {
    await api.dispose();
  }
});

test("archived projects retain owner-readable feedback and PDFs without starting a website preview", async ({
  page,
}, testInfo) => {
  const { api } = await authenticatedPage(page, `ui-archive-${testInfo.project.name}`);
  try {
    const website = await createWebsite(api, "Archived website");
    const comment = await api.post(`/api/reviews/${website.shareToken}/comments`, {
      data: { body: "Keep this archived discussion.", anchor: websiteAnchor(website.url!) },
    });
    expect(comment.ok()).toBeTruthy();
    expect(
      (await api.patch(`/api/projects/${website.id}`, { data: { archived: true } })).ok(),
    ).toBeTruthy();
    const previewRequests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/preview"))
        previewRequests.push(request.url());
    });
    await page.goto(`/r/${website.shareToken}`);
    await expect(page.getByRole("heading", { name: "Ce projet est archivé." })).toBeVisible();
    await expect(page.locator('iframe[title="Site en relecture"]')).toHaveCount(0);
    await expect(page.getByText("Keep this archived discussion.", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Commenter", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Partager", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Ouvrir le retour 1", exact: true }).click();
    await expect(page.getByLabel("Répondre au retour 1")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Résoudre le retour 1" })).not.toBeVisible();
    expect(previewRequests).toEqual([]);

    const createdPdf = await api.post("/api/projects", {
      multipart: {
        name: "Archived document",
        type: "pdf",
        file: { name: "archived.pdf", mimeType: "application/pdf", buffer: pdfFixture() },
      },
    });
    expect(createdPdf.ok()).toBeTruthy();
    const { project: pdf } = (await createdPdf.json()) as { project: Project };
    expect(
      (await api.patch(`/api/projects/${pdf.id}`, { data: { archived: true } })).ok(),
    ).toBeTruthy();
    await page.goto(`/r/${pdf.shareToken}`);
    await expect(page.getByLabel("PDF, page 1", { exact: true })).toBeVisible();
    await expect(page.getByText("Chargement du document…", { exact: true })).not.toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: "Commenter", exact: true })).toBeDisabled();
    await projectOptions(page, true);
    await page.getByRole("button", { name: "Page PDF suivante" }).click();
    await expect(page.getByLabel("Numéro de page PDF")).toHaveValue("2");
    await expect(page.getByLabel("PDF, page 2", { exact: true })).toBeVisible();
    expect(previewRequests).toEqual([]);
  } finally {
    await api.dispose();
  }
});

test("English UI and persistent language changes preserve the review page, session and unsent draft", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const englishContext = await browser.newContext({ locale: "en-US" });
  try {
    const englishPage = await englishContext.newPage();
    await englishPage.goto(new URL("/login", baseURL()).toString());
    await expect(englishPage.locator("html")).toHaveAttribute("lang", "en");
    await expect(englishPage.getByLabel("Email address", { exact: true })).toBeVisible();
    await expect(englishPage.getByRole("button", { name: "Send me a code" })).toBeVisible();
  } finally {
    await englishContext.close();
  }

  const { api } = await authenticatedPage(page, `ui-language-${testInfo.project.name}`);
  try {
    const project = await createWebsite(api, "Language preservation");
    const previewRequests: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/preview"))
        previewRequests.push(request.url());
    });
    await page.goto(`/r/${project.shareToken}`);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    const site = await waitForWebsite(page);
    await site.getByRole("link", { name: "Le studio", exact: true }).click();
    await expect(site.getByRole("heading", { level: 1 })).toContainText("De bonnes personnes.");
    await expect(site.locator('.forma-site[data-hydrated="true"]')).toBeVisible();
    await site.getByRole("button", { name: "Ajouter une idée" }).click();
    await expect(site.getByText("1 idée partagée", { exact: true })).toBeVisible();
    const originalAddress = await page.getByLabel("Adresse de la page").inputValue();
    const originalPreview = await page
      .locator('iframe[title="Site en relecture"]')
      .getAttribute("src");
    const originalLink = page.url();
    await page.getByRole("button", { name: "Commenter", exact: true }).click();
    await site.getByRole("heading", { level: 1 }).click({ position: { x: 90, y: 30 } });
    const draft = "Conserver ce brouillon pendant le changement de langue.";
    await page.getByLabel("Votre commentaire").fill(draft);
    expect(previewRequests).toHaveLength(1);

    await projectOptions(page, true);
    await page.getByLabel("Langue", { exact: true }).selectOption("en");
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await projectOptions(page, false);
    await expect(page.getByLabel("Your comment", { exact: true })).toHaveValue(draft);
    await expect(page.getByRole("button", { name: "Comment", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByLabel("Page address")).toHaveValue(originalAddress);
    await expect(page.locator('iframe[title="Website under review"]')).toHaveAttribute(
      "src",
      originalPreview!,
    );
    expect(page.url()).toBe(originalLink);
    expect(previewRequests).toHaveLength(1);
    const englishSite = page.frameLocator('iframe[title="Website under review"]');
    await expect(englishSite.getByText("1 idée partagée", { exact: true })).toBeVisible();
    await publishComment(page, "Post", draft);
    await expect(englishSite.getByRole("button", { name: "Comment 1", exact: true })).toBeVisible();

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("button", { name: "Share", exact: true })).toBeVisible();
    await expect(page.locator(".feedback-card").getByText(draft, { exact: true })).toBeVisible();
    expect(page.url()).toBe(originalLink);
    const localeCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === "repere_locale",
    );
    expect(localeCookie).toMatchObject({ value: "en", httpOnly: true, sameSite: "Lax" });
  } finally {
    await api.dispose();
  }
});
