import { test, expect, type Page, type Request, type Route } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Project, Workspace } from "../../shared/types";
import {
  assertLocalWorkspaceEnvironment,
  authenticatedPage,
  createWebsite,
  listWorkspaces,
  websiteURL,
} from "./helpers";

async function selectedWorkspace(page: Page, workspace: Workspace) {
  await expect(page).toHaveURL(
    (url) => url.pathname === "/" && url.searchParams.get("workspace") === workspace.id,
  );
  await expect(page.getByRole("button", { name: "Changer d’espace", exact: true })).toContainText(
    workspace.name,
  );
}

async function selectWorkspace(page: Page, workspace: Workspace) {
  await page.getByRole("button", { name: "Changer d’espace", exact: true }).click();
  await page.getByRole("menuitemradio", { name: workspace.name, exact: true }).click();
  await selectedWorkspace(page, workspace);
}

function projectLink(page: Page, project: Project) {
  return page.getByRole("link", { name: `Ouvrir ${project.name}`, exact: true });
}

test("workspace creation, project moves and switching survive history, reload and delayed responses", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  assertLocalWorkspaceEnvironment();
  const { api, person } = await authenticatedPage(page, `workspace-ui-${testInfo.project.name}`);
  let releaseDelayed = () => {};
  let delayedHandler: ((route: Route) => Promise<void>) | undefined;
  let delayedMatcher: ((url: URL) => boolean) | undefined;
  try {
    const first = (await listWorkspaces(api))[0];
    const firstProject = await createWebsite(api, "First workspace", first.id);
    await page.goto("/");
    await selectedWorkspace(page, first);
    await expect(projectLink(page, firstProject)).toBeVisible();

    const trigger = page.getByRole("button", { name: "Changer d’espace", exact: true });
    await trigger.focus();
    await page.keyboard.press("ArrowDown");
    const currentOption = page.getByRole("menuitemradio", { name: first.name, exact: true });
    await expect(currentOption).toBeFocused();
    await expect(currentOption).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("End");
    await expect(
      page.getByRole("menuitem", { name: "Créer un espace", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    const createDialog = page.getByRole("dialog", { name: "Créer un espace", exact: true });
    await expect(createDialog).toBeVisible();
    const secondName = `Client ${testInfo.project.name} ${randomUUID().slice(0, 6)}`;
    await createDialog.getByLabel("Nom de l’espace", { exact: true }).fill(secondName);
    const workspaceSaved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/workspaces" &&
        response.request().method() === "POST",
    );
    await createDialog.getByRole("button", { name: "Créer l’espace", exact: true }).click();
    const workspaceResponse = await workspaceSaved;
    expect(workspaceResponse.status()).toBe(201);
    const second = ((await workspaceResponse.json()) as { workspace: Workspace }).workspace;
    expect(second.name).toBe(secondName);
    await expect(createDialog).toBeHidden();
    await selectedWorkspace(page, second);
    await expect(projectLink(page, firstProject)).toHaveCount(0);
    const secondProject = await createWebsite(api, "Second workspace stays here", second.id);

    await page.getByRole("button", { name: "Nouveau projet", exact: true }).click();
    const projectName = `Move me ${testInfo.project.name}`;
    await page.getByLabel("Nom du projet", { exact: true }).fill(projectName);
    await page.getByLabel("Adresse du site", { exact: true }).fill(websiteURL());
    const projectSaved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/projects" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Créer le projet", exact: true }).click();
    const projectResponse = await projectSaved;
    expect(projectResponse.status()).toBe(201);
    expect(new URL(projectResponse.url()).searchParams.get("workspaceId")).toBe(second.id);
    const movedProject = ((await projectResponse.json()) as { project: Project }).project;
    expect(movedProject.workspaceId).toBe(second.id);
    await expect(page).toHaveURL(new RegExp(`/r/${movedProject.shareToken}$`));
    await expect(page.getByRole("heading", { name: projectName, exact: true })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Retour aux projets", exact: true }),
    ).toHaveAttribute("href", `/?workspace=${second.id}`);
    await page.getByLabel("Options du projet", { exact: true }).click();
    await page.getByRole("button", { name: "Paramètres du projet", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Paramètres du projet", exact: true });
    await settings.getByLabel("Espace de destination", { exact: true }).selectOption(first.id);
    const moved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === `/api/projects/${movedProject.id}` &&
        response.request().method() === "PATCH",
    );
    await settings.getByRole("button", { name: "Déplacer le projet", exact: true }).click();
    const movedResponse = await moved;
    expect(movedResponse.status()).toBe(200);
    expect((await movedResponse.json()).project).toMatchObject({
      workspaceId: first.id,
      shareToken: movedProject.shareToken,
    });
    await expect(settings).toBeHidden();
    await expect(page).toHaveURL(new RegExp(`/r/${movedProject.shareToken}$`));
    await expect(
      page.getByRole("link", { name: "Retour aux projets", exact: true }),
    ).toHaveAttribute("href", `/?workspace=${first.id}`);
    await page.getByRole("link", { name: "Retour aux projets", exact: true }).click();
    await selectedWorkspace(page, first);
    await expect(projectLink(page, firstProject)).toBeVisible();
    await expect(projectLink(page, movedProject)).toBeVisible();
    await expect(projectLink(page, secondProject)).toHaveCount(0);

    await selectWorkspace(page, second);
    await expect(projectLink(page, secondProject)).toBeVisible();
    await expect(projectLink(page, movedProject)).toHaveCount(0);
    await selectWorkspace(page, first);
    await expect(projectLink(page, firstProject)).toBeVisible();
    await page.goBack();
    await selectedWorkspace(page, second);
    await expect(projectLink(page, secondProject)).toBeVisible();
    await page.goForward();
    await selectedWorkspace(page, first);
    await expect(projectLink(page, firstProject)).toBeVisible();
    await selectWorkspace(page, second);
    await page.reload();
    await selectedWorkspace(page, second);
    await expect(projectLink(page, secondProject)).toBeVisible();
    expect(
      await page.evaluate(
        (id) => localStorage.getItem(`repere.workspace.v1:${id}`),
        person.user.id,
      ),
    ).toBe(second.id);
    await page.goto("/");
    await selectedWorkspace(page, second);
    await expect(projectLink(page, secondProject)).toBeVisible();

    // Hold a real response from MySQL. Returning it after switching must not repopulate
    // the new workspace; aborting the obsolete request is also a valid outcome.
    let received!: () => void;
    let completed!: () => void;
    let settled!: () => void;
    let heldRequest: Request | undefined;
    const captured = new Promise<void>((resolve) => {
      received = resolve;
    });
    const delivered = new Promise<void>((resolve) => {
      completed = resolve;
    });
    const requestSettled = new Promise<void>((resolve) => {
      settled = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseDelayed = resolve;
    });
    const onSettled = (request: Request) => {
      if (request === heldRequest) settled();
    };
    page.on("requestfailed", onSettled);
    page.on("requestfinished", onSettled);
    delayedMatcher = (url) =>
      url.pathname === "/api/projects" && url.searchParams.get("workspaceId") === first.id;
    delayedHandler = async (route) => {
      heldRequest = route.request();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      received();
      await gate;
      try {
        await route.fulfill({ response });
      } finally {
        completed();
      }
    };
    await page.route(delayedMatcher, delayedHandler, { times: 1 });
    await selectWorkspace(page, first);
    await captured;
    await selectWorkspace(page, second);
    await expect(projectLink(page, secondProject)).toBeVisible();
    releaseDelayed();
    await Promise.all([delivered, requestSettled]);
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())),
    );
    await selectedWorkspace(page, second);
    await expect(projectLink(page, secondProject)).toBeVisible();
    await expect(projectLink(page, firstProject)).toHaveCount(0);
    await expect(projectLink(page, movedProject)).toHaveCount(0);
    page.off("requestfailed", onSettled);
    page.off("requestfinished", onSettled);

    await page.setViewportSize({ width: 390, height: 844 });
    await trigger.click();
    const menu = page.getByRole("menu", { name: "Espaces", exact: true });
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Home");
    await expect(page.getByRole("menuitemradio", { name: first.name, exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await selectedWorkspace(page, first);
    await expect(projectLink(page, firstProject)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    );
    // Search state belongs to its workspace and must not hide projects after switching.
    await page.getByLabel("Rechercher un projet", { exact: true }).fill("no-project-matches-this");
    await expect(projectLink(page, firstProject)).toHaveCount(0);
    await selectWorkspace(page, second);
    await expect(page.getByLabel("Rechercher un projet", { exact: true })).toHaveValue("");
    await expect(projectLink(page, secondProject)).toBeVisible();
  } finally {
    releaseDelayed();
    if (delayedMatcher && delayedHandler) await page.unroute(delayedMatcher, delayedHandler);
    await api.dispose();
  }
});
