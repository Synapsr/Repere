import { test, expect } from "@playwright/test";
import type { Feedback } from "../../shared/types";
import {
  assertLocalWorkspaceEnvironment,
  authenticatedPage,
  baseURL,
  createWebsite,
  grantWorkspaceMember,
  websiteAnchor,
} from "./helpers";

type ClipboardWindow = typeof window & { promptCopies: string[]; denyPromptClipboard: boolean };

test("managers copy open prompts individually or together, with a manual clipboard fallback", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  assertLocalWorkspaceEnvironment();
  await page.addInitScript(() => {
    const state = window as ClipboardWindow;
    state.promptCopies = [];
    state.denyPromptClipboard = false;
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          if (state.denyPromptClipboard)
            throw new DOMException("Clipboard blocked", "NotAllowedError");
          state.promptCopies.push(value);
        },
      },
    });
  });
  const owner = await authenticatedPage(page, `prompt-owner-${testInfo.project.name}`);
  const guestContext = await browser.newContext({ locale: "fr-FR", baseURL: baseURL() });
  const guestPage = await guestContext.newPage();
  await guestPage.addInitScript(() =>
    localStorage.setItem("repere.review-onboarding.v1", "dismissed"),
  );
  const guest = await authenticatedPage(guestPage, `prompt-guest-${testInfo.project.name}`);
  let removeMember: (() => Promise<void>) | undefined;
  try {
    const project = await createWebsite(owner.api, "Prompt interface");
    const review = `/api/reviews/${project.shareToken}`;
    const feedback: Feedback[] = [];
    for (const body of [
      "Make the heading clearer.",
      "Increase the contact button.",
      "This request is completed.",
    ]) {
      const response = await owner.api.post(`${review}/comments`, {
        data: { body, anchor: websiteAnchor(project.url!) },
      });
      expect(response.status()).toBe(201);
      feedback.push((await response.json()).comment);
    }
    await owner.api.patch(`${review}/comments/${feedback[2].id}`, { data: { status: "resolved" } });
    await owner.api.post(`${review}/comments/${feedback[0].id}/replies`, {
      data: { body: "Keep the current typeface." },
    });
    await page.goto(`/r/${project.shareToken}`);
    const bulk = page.locator(".feedback-heading .copy-prompt-button");
    await expect(bulk).toHaveAccessibleName("Copier les retours à traiter en prompt");
    await bulk.click();
    await expect(bulk).toHaveAccessibleName("Prompt copié");
    const all = await page.evaluate(() => (window as ClipboardWindow).promptCopies[0]);
    expect(all).toContain("Applique les retours");
    for (const value of [feedback[0].body, feedback[1].body, "Keep the current typeface."])
      expect(all).toContain(value);
    expect(all).not.toContain(feedback[2].body);
    const first = page.locator(".feedback-card").filter({ hasText: feedback[0].body });
    await first.getByRole("button", { name: "Copier ce retour en prompt", exact: true }).click();
    await expect
      .poll(() => page.evaluate(() => (window as ClipboardWindow).promptCopies.length))
      .toBe(2);
    const single = await page.evaluate(() => (window as ClipboardWindow).promptCopies[1]);
    expect(single).toContain(feedback[0].body);
    expect(single).not.toContain(feedback[1].body);
    await page.getByRole("button", { name: /^Résolus/ }).click();
    await expect(page.locator(".copy-prompt-button")).toHaveCount(0);
    await page.getByRole("button", { name: /^À traiter/ }).click();
    // The visible review can be stale; the server still exports current statuses.
    await owner.api.patch(`${review}/comments/${feedback[0].id}`, { data: { status: "resolved" } });
    await bulk.click();
    await expect
      .poll(() => page.evaluate(() => (window as ClipboardWindow).promptCopies.length))
      .toBe(3);
    expect(await page.evaluate(() => (window as ClipboardWindow).promptCopies[2])).not.toContain(
      feedback[0].body,
    );
    await page.evaluate(() => {
      (window as ClipboardWindow).denyPromptClipboard = true;
    });
    await bulk.click();
    const fallback = page.getByRole("dialog", { name: "Copier le prompt", exact: true });
    await expect(fallback).toBeVisible();
    const promptText = fallback.getByRole("textbox", { name: "Copier le prompt" });
    await expect(promptText).toBeFocused();
    expect(await promptText.inputValue()).toContain(feedback[1].body);
    expect(
      await promptText.evaluate(
        (element: HTMLTextAreaElement) => element.selectionEnd - element.selectionStart,
      ),
    ).toBe((await promptText.inputValue()).length);
    expect(await page.evaluate(() => (window as ClipboardWindow).promptCopies.length)).toBe(3);
    await page.keyboard.press("Escape");
    await expect(fallback).not.toBeVisible();

    const own = await guest.api.post(`${review}/comments`, {
      data: { body: "Guest-owned feedback", anchor: websiteAnchor(project.url!) },
    });
    expect(own.status()).toBe(201);
    await guestPage.goto(`/r/${project.shareToken}`);
    await expect(
      guestPage.locator(".feedback-card").filter({ hasText: "Guest-owned feedback" }),
    ).toBeVisible();
    await expect(guestPage.locator(".copy-prompt-button")).toHaveCount(0);
    expect((await guest.api.get(`/api/projects/${project.id}/prompt`)).status()).toBe(404);
    removeMember = await grantWorkspaceMember(project.workspaceId, guest.person.user.id);
    await guestPage.reload();
    await expect(guestPage.locator(".feedback-heading .copy-prompt-button")).toBeVisible();
    await removeMember();
    removeMember = undefined;
    await expect(guestPage.locator(".copy-prompt-button")).toHaveCount(0, { timeout: 12_000 });
    await expect(
      guestPage.locator(".feedback-card").filter({ hasText: "Guest-owned feedback" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    if (!(await bulk.isVisible()))
      await page.getByRole("button", { name: "Afficher les retours", exact: true }).click();
    await expect(bulk).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("copy-prompts-mobile.png"),
      animations: "disabled",
    });
  } finally {
    await removeMember?.();
    await Promise.all([owner.api.dispose(), guest.api.dispose(), guestContext.close()]);
  }
});
