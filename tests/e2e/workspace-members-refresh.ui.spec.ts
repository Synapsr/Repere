import { expect, test, type Page, type Route } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { User, WorkspaceInvitation, WorkspaceMember } from "../../shared/types";
import fr from "../../src/i18n/messages/fr/dashboard.json";

async function rosterFixture(page: Page) {
  const workspaceId = randomUUID();
  const owner: User = { id: randomUUID(), name: "Camille Owner", email: "owner@example.test" };
  const colleague: User = { id: randomUUID(), name: "Alex Member", email: "member@example.test" };
  let members: WorkspaceMember[] = [{ user: owner, role: "owner" }];
  let invitations: WorkspaceInvitation[] = [
    {
      id: randomUUID(),
      email: colleague.email,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    },
  ];
  let reads = 0;
  let holdNextRead = false;
  let pending: {
    route: Route;
    snapshot: { members: WorkspaceMember[]; invitations: WorkspaceInvitation[] };
  } | null = null;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { user: owner } });
    if (path === "/api/workspaces")
      return route.fulfill({
        json: { workspaces: [{ id: workspaceId, name: "Roster fixture", role: "owner" }] },
      });
    if (path === "/api/projects") return route.fulfill({ json: { projects: [] } });
    if (path === `/api/workspaces/${workspaceId}/members`) {
      reads++;
      const snapshot = { members: [...members], invitations: [...invitations] };
      if (holdNextRead) {
        holdNextRead = false;
        pending = { route, snapshot };
        return;
      }
      return route.fulfill({ json: snapshot });
    }
    if (
      path === `/api/workspaces/${workspaceId}/members/${colleague.id}` &&
      request.method() === "DELETE"
    ) {
      members = members.filter((member) => member.user.id !== colleague.id);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ status: 500, json: { error: "Unexpected roster fixture request" } });
  });
  return {
    path: `/?workspace=${workspaceId}`,
    colleague,
    reads: () => reads,
    accept: () => {
      members = [...members, { user: colleague, role: "member" }];
      invitations = [];
    },
    hold: () => {
      holdNextRead = true;
    },
    release: async () => {
      if (pending) await pending.route.fulfill({ json: pending.snapshot }).catch(() => {});
    },
  };
}

async function openMembers(page: Page) {
  await page.getByRole("button", { name: fr.switchWorkspace, exact: true }).click();
  await page.getByRole("menuitem", { name: fr.members, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: fr.membersTitle, exact: true });
  await expect(dialog.getByText("Camille Owner", { exact: true })).toBeVisible();
  return dialog;
}

async function visibility(page: Page, state: "visible" | "hidden") {
  await page.evaluate((value) => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value });
    document.dispatchEvent(new Event("visibilitychange"));
  }, state);
}

test("an accepted invitation appears in the open roster, with polling paused while hidden", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await rosterFixture(page);
  await page.goto(fixture.path);
  const dialog = await openMembers(page);
  await expect(dialog.getByRole("heading", { name: fr.pendingInvitations })).toBeVisible();
  await dialog.getByLabel(fr.memberEmail, { exact: true }).fill("draft@example.test");
  await visibility(page, "hidden");
  const readsBefore = fixture.reads();
  fixture.accept();
  await page.clock.fastForward(16_000);
  expect(fixture.reads()).toBe(readsBefore);
  await expect(dialog.getByText(fixture.colleague.name, { exact: true })).toHaveCount(0);
  await visibility(page, "visible");
  await expect(dialog.getByText(fixture.colleague.name, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: fr.pendingInvitations })).toHaveCount(0);
  await expect(dialog.getByLabel(fr.memberEmail, { exact: true })).toHaveValue(
    "draft@example.test",
  );
  await expect(dialog.getByText(fr.membersLoading, { exact: true })).toHaveCount(0);
  const visibleReads = fixture.reads();
  await page.clock.fastForward(8_000);
  await expect.poll(fixture.reads).toBe(visibleReads + 1);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  const closedReads = fixture.reads();
  await page.clock.fastForward(16_000);
  expect(fixture.reads()).toBe(closedReads);
});

test("a stale background response cannot undo removal or interrupt its confirmation", async ({
  page,
}) => {
  await page.clock.install();
  const fixture = await rosterFixture(page);
  fixture.accept();
  await page.goto(fixture.path);
  const dialog = await openMembers(page);
  await expect(dialog.getByText(fixture.colleague.name, { exact: true })).toBeVisible();
  fixture.hold();
  const initialReads = fixture.reads();
  await page.clock.fastForward(8_000);
  await expect.poll(fixture.reads).toBe(initialReads + 1);
  await dialog
    .getByRole("button", { name: `Retirer ${fixture.colleague.name}`, exact: true })
    .click();
  const confirm = dialog.getByRole("button", { name: fr.confirmRemoveMember, exact: true });
  await expect(confirm).toBeVisible();
  await page.clock.fastForward(16_000);
  expect(fixture.reads()).toBe(initialReads + 1);
  await expect(confirm).toBeVisible();
  await confirm.click();
  await expect(dialog.getByText(fixture.colleague.name, { exact: true })).toHaveCount(0);
  await fixture.release();
  await page.clock.fastForward(8_000);
  await expect.poll(fixture.reads).toBe(initialReads + 2);
  await expect(dialog.getByText(fixture.colleague.name, { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel(fr.memberEmail, { exact: true })).toBeEnabled();
});
