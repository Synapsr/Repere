import { test, expect, type Page } from "@playwright/test";
import type { User, Workspace } from "../../shared/types";
import {
  assertLocalWorkspaceEnvironment,
  authenticatedPage,
  baseURL,
  createWebsite,
  emailMessage,
  identity,
  listWorkspaces,
} from "./helpers";
import { invitationEmail, workspacePeople } from "./invitations-helpers";

async function openMembers(page: Page, workspace: Workspace) {
  await page.goto(`/?workspace=${workspace.id}`);
  const trigger = page.getByRole("button", { name: "Changer d’espace", exact: true });
  await expect(trigger).toContainText(workspace.name);
  await trigger.focus();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitemradio", { name: workspace.name, exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Membres", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Membres de l’espace", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test("an owner invites by email, a new reviewer explicitly joins, and removal ends workspace access", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  assertLocalWorkspaceEnvironment();
  // Two real OTPs per engine: one owner, then the invited user through the login UI.
  const { api, person: owner } = await authenticatedPage(
    page,
    `invite-ui-owner-${testInfo.project.name}`,
  );
  const guest = identity(`invite-ui-guest-${testInfo.project.name}`);
  const guestContext = await browser.newContext({
    baseURL: baseURL(),
    locale: "en-US",
    viewport: { width: 390, height: 844 },
  });
  const guestPage = await guestContext.newPage();
  try {
    const workspace = (await listWorkspaces(api))[0];
    const project = await createWebsite(api, "Shared team project", workspace.id);
    await page.setViewportSize({ width: 390, height: 844 });
    const ownerDialog = await openMembers(page, workspace);
    await expect(ownerDialog.getByRole("list", { name: "Membres", exact: true })).toContainText(
      owner.name,
    );
    await expect(
      ownerDialog.getByRole("button", { name: `Retirer ${owner.name}`, exact: true }),
    ).toHaveCount(0);
    await ownerDialog.getByLabel("Adresse email", { exact: true }).fill(guest.email);
    const sent = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/workspaces/${workspace.id}/invitations` &&
        response.request().method() === "POST",
    );
    await ownerDialog.getByRole("button", { name: "Inviter", exact: true }).click();
    const sentResponse = await sent;
    expect(sentResponse.status()).toBe(201);
    await expect(
      ownerDialog.getByRole("heading", { name: "Invitations en attente", exact: true }),
    ).toBeVisible();
    await expect(
      ownerDialog.getByRole("button", {
        name: `Renvoyer l’invitation à ${guest.email}`,
        exact: true,
      }),
    ).toBeVisible();
    await expect(ownerDialog.getByLabel("Adresse email", { exact: true })).toHaveValue("");
    expect((await workspacePeople(api, workspace.id)).members).toHaveLength(1);
    const email = await invitationEmail(guest.email);
    expect(email.text).toContain(workspace.name);
    expect(email.text).toContain(owner.name);
    expect(email.text).toContain("vous invite");
    const dialogBounds = await ownerDialog.boundingBox();
    expect(dialogBounds).not.toBeNull();
    expect(dialogBounds!.x).toBeGreaterThanOrEqual(0);
    expect(dialogBounds!.x + dialogBounds!.width).toBeLessThanOrEqual(390);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );

    await guestPage.goto(email.url);
    await expect(
      guestPage.getByRole("heading", { name: workspace.name, exact: true }),
    ).toBeVisible();
    await expect(guestPage.locator("html")).toHaveAttribute("lang", "en");
    await expect(guestPage.locator("main")).not.toContainText(guest.email);
    const signInLink = guestPage.getByRole("link", { name: "Sign in to join", exact: true });
    await signInLink.focus();
    await guestPage.keyboard.press("Enter");
    await expect(guestPage).toHaveURL(
      (url) =>
        url.pathname === "/login" && url.searchParams.get("next") === `/invite/${email.token}`,
    );
    await guestPage.getByLabel("First name").fill(guest.name);
    await guestPage.getByLabel("Email address", { exact: true }).fill(guest.email);
    await guestPage.getByRole("button", { name: "Send me a code", exact: true }).click();
    await expect(guestPage.getByLabel("Sign-in code", { exact: true })).toBeVisible();
    const otp = await emailMessage(guest.email);
    expect(otp.Subject).toContain("Your Repère code");
    await guestPage
      .getByLabel("Sign-in code", { exact: true })
      .fill(otp.Text.match(/\b\d{6}\b/)![0]);
    await guestPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(guestPage).toHaveURL(email.url);
    const join = guestPage.getByRole("button", { name: "Join workspace", exact: true });
    await expect(join).toBeVisible();
    // Verification of an email address alone must never accept an invitation.
    expect((await workspacePeople(api, workspace.id)).members).toHaveLength(1);
    expect(
      (await guestPage.request.get(`/api/projects?workspaceId=${workspace.id}`)).status(),
    ).toBe(404);
    const guestUser = (
      (await (await guestPage.request.get("/api/auth/me")).json()) as { user: User }
    ).user;
    await join.focus();
    const joined = guestPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/invitations/${email.token}` &&
        response.request().method() === "POST",
    );
    await guestPage.keyboard.press("Enter");
    expect((await joined).status()).toBe(200);
    await expect(guestPage).toHaveURL(
      (url) => url.pathname === "/" && url.searchParams.get("workspace") === workspace.id,
    );
    await expect(
      guestPage.getByRole("button", { name: "Switch workspace", exact: true }),
    ).toContainText(workspace.name);
    await expect(
      guestPage.getByRole("link", { name: `Open ${project.name}`, exact: true }),
    ).toBeVisible();
    expect((await workspacePeople(api, workspace.id)).members).toContainEqual({
      user: guestUser,
      role: "member",
    });
    await guestPage.reload();
    await expect(
      guestPage.getByRole("link", { name: `Open ${project.name}`, exact: true }),
    ).toBeVisible();
    await guestPage.getByRole("button", { name: "Switch workspace", exact: true }).click();
    await guestPage.getByRole("menuitem", { name: "Members", exact: true }).click();
    const memberDialog = guestPage.getByRole("dialog", { name: "Workspace members", exact: true });
    await expect(memberDialog.getByRole("list", { name: "Members", exact: true })).toContainText(
      owner.name,
    );
    await expect(memberDialog.getByLabel("Email address", { exact: true })).toHaveCount(0);
    await expect(memberDialog.getByRole("button", { name: /^Remove / })).toHaveCount(0);
    await guestPage.keyboard.press("Escape");
    await expect(memberDialog).toBeHidden();
    expect(
      await guestPage.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390);

    const refreshedOwnerDialog = await openMembers(page, workspace);
    await expect(
      refreshedOwnerDialog.getByRole("heading", { name: "Invitations en attente", exact: true }),
    ).toHaveCount(0);
    const remove = refreshedOwnerDialog.getByRole("button", {
      name: `Retirer ${guest.name}`,
      exact: true,
    });
    await remove.focus();
    await page.keyboard.press("Enter");
    await expect(
      refreshedOwnerDialog.getByRole("group", { name: `Retirer ${guest.name}`, exact: true }),
    ).toBeVisible();
    // Opening the confirmation is reversible and does not remove the member.
    expect((await workspacePeople(api, workspace.id)).members).toHaveLength(2);
    const removed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/workspaces/${workspace.id}/members/${guestUser.id}` &&
        response.request().method() === "DELETE",
    );
    await refreshedOwnerDialog
      .getByRole("button", { name: "Confirmer le retrait", exact: true })
      .click();
    expect((await removed).status()).toBe(200);
    await expect(
      refreshedOwnerDialog.getByRole("list", { name: "Membres", exact: true }),
    ).not.toContainText(guest.email);
    await guestPage.reload();
    await expect(guestPage).not.toHaveURL(
      (url) => url.searchParams.get("workspace") === workspace.id,
    );
    await expect(
      guestPage.getByRole("link", { name: `Open ${project.name}`, exact: true }),
    ).toHaveCount(0);
    expect(
      (await guestPage.request.get(`/api/projects?workspaceId=${workspace.id}`)).status(),
    ).toBe(404);
    const shared = await guestPage.request.get(`/api/reviews/${project.shareToken}`);
    expect(shared.status()).toBe(200);
    expect((await shared.json()).canManage).toBe(false);
    await guestPage.goto(email.url);
    await expect(
      guestPage.getByRole("heading", { name: "This invitation is unavailable", exact: true }),
    ).toBeVisible();
    await expect(
      guestPage.getByRole("button", { name: "Join workspace", exact: true }),
    ).toHaveCount(0);
    expect((await workspacePeople(api, workspace.id)).members).toHaveLength(1);
  } finally {
    await guestContext.close();
    await api.dispose();
  }
});
