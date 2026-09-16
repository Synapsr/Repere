import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { PreviewSession } from "../../shared/preview";
import type { Feedback, ReviewData } from "../../shared/types";
import { baseURL } from "./helpers";

async function controlsFixture(page: Page) {
  const timestamp = new Date().toISOString();
  const user = { id: randomUUID(), email: "controls@example.test", name: "Review owner" };
  const projectId = randomUUID();
  const targetUrl = "https://controls.example.test/";
  const comment: Feedback = {
    id: randomUUID(),
    number: 1,
    projectId,
    body: "Spacing needs attention.",
    status: "open",
    kind: "text",
    author: user,
    replies: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    screenshot: null,
    anchor: {
      type: "website",
      url: targetUrl,
      selector: "#draft-target",
      text: "Place a point",
      x: 0.5,
      y: 0.5,
      documentX: 200,
      documentY: 200,
      viewportWidth: 1_200,
      viewportHeight: 800,
    },
  };
  const data: ReviewData = {
    project: {
      id: projectId,
      name: "Review controls fixture",
      description: null,
      type: "website",
      url: targetUrl,
      fileName: null,
      shareToken: randomUUID().replaceAll("-", "").padEnd(43, "a"),
      workspaceId: randomUUID(),
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      commentCount: 1,
      resolvedCount: 0,
      cover: { source: "automatic", version: "existing-cover" },
    },
    comments: [comment],
    user,
    canManage: true,
  };
  const origin = `https://${"e".repeat(48)}.preview.example.test`;
  const session: PreviewSession = {
    url: `${origin}/`,
    origin,
    targetUrl,
    channel: "f".repeat(32),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
  let previews = 0;
  let documents = 0;
  const apiPath = `/api/reviews/${data.project.shareToken}`;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === apiPath && request.method() === "GET") await route.fulfill({ json: data });
    else if (path === `${apiPath}/preview` && request.method() === "POST") {
      previews++;
      await route.fulfill({ json: session });
    } else await route.fulfill({ status: 500, json: { error: "Unexpected fixture request" } });
  });
  await page.route(`${origin}/**`, async (route) => {
    if (route.request().isNavigationRequest()) documents++;
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head><style>
        body{margin:0;padding:40px;background:#f6f7fb;font:16px system-ui}
        button{margin:12px;padding:12px}#draft-target{display:block;margin:24px 0}
      </style></head><body data-mode="browse">
        <h1>Interactive website fixture</h1>
        <button id="counter">Count: 0</button>
        <button id="draft-target">Place a point</button>
        <button id="existing-pin" aria-label="Existing point 1">1</button>
        <script>
          const config=${JSON.stringify({
            channel: session.channel,
            parentOrigin: new URL(baseURL()).origin,
            targetUrl,
            commentId: comment.id,
            anchor: comment.anchor,
          })};
          const emit=value=>parent.postMessage({source:'repere-preview',channel:config.channel,...value},config.parentOrigin);
          const ready=()=>emit({type:'ready',url:config.targetUrl,title:'Interactive website fixture'});
          addEventListener('message',event=>{
            if(event.source!==parent||event.origin!==config.parentOrigin||event.data?.source!=='repere'||event.data.channel!==config.channel)return;
            if(event.data.type==='init')ready();
            if(event.data.type==='mode')document.body.dataset.mode=event.data.mode;
          });
          let count=0;
          document.querySelector('#counter').onclick=event=>event.currentTarget.textContent='Count: '+(++count);
          document.querySelector('#existing-pin').onclick=()=>emit({type:'select',id:config.commentId});
          document.querySelector('#draft-target').onclick=()=>{
            if(document.body.dataset.mode!=='comment')return;
            emit({type:'anchor',anchor:config.anchor,captureId:'aabbccddeeff00112233445566778899'});
            emit({type:'capture',captureId:'aabbccddeeff00112233445566778899',capture:null});
          };
          ready();
        </script>
      </body></html>`,
    });
  });
  return {
    path: `/r/${data.project.shareToken}`,
    requests: () => ({ previews, documents }),
  };
}

test("the desktop feedback rail preserves the live iframe and draft, reopens from a pin and remembers visibility", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_440, height: 900 });
  const fixture = await controlsFixture(page);
  await page.goto(fixture.path);
  const iframe = page.locator("iframe.native-preview");
  const site = page.frameLocator("iframe.native-preview");
  const sidebar = page.locator("#review-feedback");
  const toggle = page.locator(".review-sidebar-toggle");
  await expect(site.getByRole("heading", { name: "Interactive website fixture" })).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar).toBeVisible();
  const initialWidth = (await iframe.boundingBox())!.width;
  const initialSource = (await iframe.getAttribute("src"))!;
  await site.getByRole("button", { name: "Count: 0", exact: true }).click();
  await toggle.click();
  await expect(sidebar).toBeHidden();
  await expect(toggle).toHaveAccessibleName("Afficher les retours");
  await expect
    .poll(async () => (await iframe.boundingBox())!.width)
    .toBeGreaterThan(initialWidth + 200);
  await expect(iframe).toHaveAttribute("src", initialSource);
  await expect(site.getByRole("button", { name: "Count: 1", exact: true })).toBeVisible();
  expect(fixture.requests()).toEqual({ previews: 1, documents: 1 });

  await toggle.click();
  await page.getByRole("button", { name: "Commenter", exact: true }).click();
  await expect(site.locator("body")).toHaveAttribute("data-mode", "comment");
  await site.getByRole("button", { name: "Place a point", exact: true }).click();
  const draft = "Preserve this draft when the feedback panel is hidden.";
  await page.getByLabel("Votre commentaire", { exact: true }).fill(draft);
  await page
    .getByRole("complementary")
    .getByRole("button", { name: "Masquer les retours", exact: true })
    .click();
  await expect(sidebar).toBeHidden();
  await toggle.click();
  await expect(page.getByLabel("Votre commentaire", { exact: true })).toHaveValue(draft);
  await toggle.click();
  await site.getByRole("button", { name: "Existing point 1", exact: true }).click();
  await expect(sidebar).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByLabel("Votre commentaire", { exact: true })).toHaveValue(draft);
  await expect(page.locator(".feedback-card.selected")).toContainText("Spacing needs attention.");
  await expect(site.getByRole("button", { name: "Count: 1", exact: true })).toBeVisible();
  expect(fixture.requests()).toEqual({ previews: 1, documents: 1 });

  await toggle.click();
  expect(await page.evaluate(() => localStorage.getItem("repere.feedback-panel.v1"))).toBe(
    "closed",
  );
  await page.reload();
  await expect(site.getByRole("heading", { name: "Interactive website fixture" })).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar).toBeHidden();
  await toggle.click();
  await expect(sidebar).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("repere.feedback-panel.v1"))).toBe("open");
});

test("comment actions support keyboard navigation, focus restoration and custom tooltips without native titles", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1_440, height: 900 });
  const fixture = await controlsFixture(page);
  await page.goto(fixture.path);
  const card = page.locator(".feedback-card").filter({ hasText: "Spacing needs attention." });
  const trigger = card.getByRole("button", { name: "Actions du retour 1", exact: true });
  const tooltip = page.getByRole("tooltip", { name: "Actions du retour 1", exact: true });
  await expect(trigger).toBeVisible();
  expect(await trigger.getAttribute("title")).toBeNull();
  await trigger.hover();
  await expect(tooltip).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-describedby", (await tooltip.getAttribute("id"))!);
  await page.keyboard.press("Escape");
  await expect(tooltip).not.toBeVisible();
  await page.mouse.move(0, 0);
  await card.getByRole("button", { name: "Ouvrir le retour 1", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(trigger).toBeFocused();
  await expect(tooltip).toBeVisible();

  await page.keyboard.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "Actions du retour 1", exact: true });
  const showPoint = page.getByRole("menuitem", { name: "Voir le point", exact: true });
  const copy = page.getByRole("menuitem", { name: "Copier ce retour en prompt", exact: true });
  const resolve = page.getByRole("menuitem", { name: "Résoudre le retour 1", exact: true });
  await expect(menu).toBeVisible();
  await expect(card.getByRole("menu")).toHaveCount(0);
  await expect(showPoint).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("feedback-menu-desktop.png"),
    animations: "disabled",
  });
  await page.keyboard.press("ArrowDown");
  await expect(copy).toBeFocused();
  await page.keyboard.press("End");
  await expect(resolve).toBeFocused();
  await page.keyboard.press("Home");
  await expect(showPoint).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const heading = (await page.locator(".review-project-heading").boundingBox())!;
    const modes = (await page.locator(".review-header .mode-switch").boundingBox())!;
    const actions = (await page.locator(".review-header-actions").boundingBox())!;
    expect(heading.x).toBeGreaterThanOrEqual(0);
    expect(heading.x + heading.width).toBeLessThanOrEqual(modes.x + 1);
    expect(modes.x + modes.width).toBeLessThanOrEqual(actions.x + 1);
    expect(actions.x + actions.width).toBeLessThanOrEqual(width);
    await expect(page.getByRole("button", { name: "Naviguer", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Commenter", exact: true })).toBeVisible();
    await trigger.click();
    await expect(menu).toBeVisible();
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await page.screenshot({
      path: testInfo.outputPath(`feedback-menu-mobile-${width}.png`),
      animations: "disabled",
    });
    await page.keyboard.press("Escape");
    await expect(menu).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
});
