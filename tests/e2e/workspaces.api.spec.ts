import { test, expect, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { Feedback, Project, ReviewData } from "../../shared/types";
import {
  apiContext,
  assertLocalWorkspaceEnvironment,
  createWebsite,
  createWorkspace,
  grantWorkspaceMember,
  listWorkspaces,
  pdfFixture,
  signIn,
  websiteAnchor,
  websiteURL,
} from "./helpers";

async function projectsIn(api: APIRequestContext, workspaceId?: string) {
  const response = await api.get("/api/projects", {
    params: workspaceId ? { workspaceId } : {},
  });
  expect(response.status(), await response.text()).toBe(200);
  return ((await response.json()) as { projects: Project[] }).projects;
}

async function review(api: APIRequestContext, project: Project) {
  const response = await api.get(`/api/reviews/${project.shareToken}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as ReviewData;
}

test("workspace membership isolates projects, controls transfers and preserves guest feedback", async () => {
  test.setTimeout(120_000);
  assertLocalWorkspaceEnvironment();
  const owner = await apiContext();
  const member = await apiContext();
  const guest = await apiContext();
  const anonymous = await apiContext();
  const cleanups: (() => Promise<void>)[] = [];
  try {
    expect((await anonymous.get("/api/workspaces")).status()).toBe(401);
    expect(
      (await anonymous.post("/api/workspaces", { data: { name: "Anonymous workspace" } })).status(),
    ).toBe(401);
    const ownerIdentity = await signIn(owner, "workspace-owner");
    const memberIdentity = await signIn(member, "workspace-member");
    const guestIdentity = await signIn(guest, "workspace-guest");

    // Simultaneous first visits must not create two default workspaces for one user.
    const [firstVisit, concurrentVisit] = await Promise.all([
      listWorkspaces(owner),
      listWorkspaces(owner),
    ]);
    expect(firstVisit).toHaveLength(1);
    expect(concurrentVisit).toEqual(firstVisit);
    const first = firstVisit[0];
    expect(first.role).toBe("owner");
    const second = await createWorkspace(owner, `Client ${randomUUID().slice(0, 8)}`);
    expect(second.role).toBe("owner");
    expect(second.id).not.toBe(first.id);
    expect((await listWorkspaces(owner)).map((workspace) => workspace.id)).toEqual([
      first.id,
      second.id,
    ]);
    for (const name of ["", " "]) {
      expect((await owner.post("/api/workspaces", { data: { name } })).status()).toBe(400);
    }
    expect(
      (
        await owner.post("/api/workspaces", {
          headers: { Origin: "https://untrusted.example" },
          data: { name: "Blocked cross-origin creation" },
        })
      ).status(),
    ).toBe(403);

    const unscoped = await createWebsite(owner, "Default workspace project");
    expect(unscoped.workspaceId).toBe(first.id);
    expect(unscoped).not.toHaveProperty("ownerId");
    const project = await createWebsite(owner, "Transfer with feedback", first.id);
    const secondProject = await createWebsite(owner, "Second workspace project", second.id);
    const bytes = pdfFixture();
    const uploaded = await owner.post(`/api/projects?workspaceId=${second.id}`, {
      multipart: {
        type: "pdf",
        name: "Workspace document",
        file: { name: "workspace.pdf", mimeType: "application/pdf", buffer: bytes },
      },
    });
    expect(uploaded.status(), await uploaded.text()).toBe(201);
    const pdf = ((await uploaded.json()) as { project: Project }).project;
    expect(pdf.workspaceId).toBe(second.id);
    expect((await projectsIn(owner)).map((item) => item.id).sort()).toEqual(
      [unscoped.id, project.id].sort(),
    );
    expect((await projectsIn(owner, second.id)).map((item) => item.id).sort()).toEqual(
      [secondProject.id, pdf.id].sort(),
    );
    expect((await owner.get("/api/projects?workspaceId=not-a-uuid")).status()).toBe(400);
    expect((await owner.get(`/api/projects?workspaceId=${randomUUID()}`)).status()).toBe(404);

    const guestWorkspace = (await listWorkspaces(guest))[0];
    const foreignProject = await createWebsite(guest, "Foreign source", guestWorkspace.id);
    expect((await listWorkspaces(guest)).some((workspace) => workspace.id === first.id)).toBe(
      false,
    );
    expect((await guest.get(`/api/projects?workspaceId=${first.id}`)).status()).toBe(404);
    for (const request of [
      () =>
        guest.post(`/api/projects?workspaceId=${first.id}`, {
          data: { name: "Foreign creation", type: "website", url: websiteURL() },
        }),
      () =>
        guest.post(`/api/projects?workspaceId=${first.id}`, {
          multipart: {
            name: "Foreign PDF",
            type: "pdf",
            file: { name: "foreign.pdf", mimeType: "application/pdf", buffer: bytes },
          },
        }),
      () => guest.patch(`/api/projects/${project.id}`, { data: { name: "Foreign rename" } }),
      () => guest.patch(`/api/projects/${project.id}`, { data: { archived: true } }),
      () => guest.patch(`/api/projects/${project.id}`, { data: { rotateShareToken: true } }),
      () =>
        guest.patch(`/api/projects/${project.id}`, { data: { workspaceId: guestWorkspace.id } }),
      () =>
        owner.patch(`/api/projects/${project.id}`, { data: { workspaceId: guestWorkspace.id } }),
      () => owner.patch(`/api/projects/${foreignProject.id}`, { data: { workspaceId: first.id } }),
    ]) {
      const response = await request();
      expect(response.status(), await response.text()).toBe(404);
    }
    // Client-supplied privilege flags must never make an outsider a workspace manager.
    const escalated = await guest.patch(`/api/projects/${project.id}`, {
      data: { workspaceId: guestWorkspace.id, canManage: true, role: "owner" },
    });
    expect([400, 404]).toContain(escalated.status());
    expect((await review(owner, project)).project).toMatchObject({
      workspaceId: first.id,
      name: project.name,
      shareToken: project.shareToken,
      archived: false,
    });

    cleanups.push(await grantWorkspaceMember(first.id, memberIdentity.user.id));
    expect(await listWorkspaces(member)).toContainEqual({ ...first, role: "member" });
    expect((await review(member, project)).canManage).toBe(true);
    expect((await review(guest, project)).canManage).toBe(false);
    expect((await review(anonymous, project)).canManage).toBe(false);
    const route = `/api/reviews/${project.shareToken}`;
    const posted = await guest.post(`${route}/comments`, {
      data: { body: "Keep this feedback during the move.", anchor: websiteAnchor(project.url!) },
    });
    expect(posted.status(), await posted.text()).toBe(201);
    const comment = ((await posted.json()) as { comment: Feedback }).comment;
    expect(comment.author).toEqual(guestIdentity.user);
    expect(
      (
        await member.patch(`${route}/comments/${comment.id}`, { data: { status: "resolved" } })
      ).status(),
    ).toBe(200);
    expect(
      (
        await member.post(`${route}/comments/${comment.id}/replies`, {
          data: { body: "Reviewed by another workspace member." },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await member.patch(`/api/projects/${project.id}`, { data: { workspaceId: second.id } })
      ).status(),
    ).toBe(404);

    const moved = await owner.patch(`/api/projects/${project.id}`, {
      data: { workspaceId: second.id },
    });
    expect(moved.status(), await moved.text()).toBe(200);
    expect((await moved.json()).project).toMatchObject({
      id: project.id,
      workspaceId: second.id,
      shareToken: project.shareToken,
      commentCount: 1,
      resolvedCount: 1,
    });
    expect(await projectsIn(member, first.id)).not.toContainEqual(
      expect.objectContaining({ id: project.id }),
    );
    expect((await member.get(`/api/projects?workspaceId=${second.id}`)).status()).toBe(404);
    expect((await review(member, project)).canManage).toBe(false);
    expect(
      (await member.patch(`/api/projects/${project.id}`, { data: { archived: true } })).status(),
    ).toBe(404);
    const retained = await review(guest, project);
    expect(retained.canManage).toBe(false);
    expect(retained.comments).toEqual([
      expect.objectContaining({
        id: comment.id,
        author: guestIdentity.user,
        anchor: comment.anchor,
        body: comment.body,
        status: "resolved",
        replies: [expect.objectContaining({ author: memberIdentity.user })],
      }),
    ]);

    cleanups.push(await grantWorkspaceMember(second.id, memberIdentity.user.id));
    expect((await review(member, project)).canManage).toBe(true);
    const movedBack = await member.patch(`/api/projects/${project.id}`, {
      data: { workspaceId: first.id },
    });
    expect(movedBack.status(), await movedBack.text()).toBe(200);
    expect((await movedBack.json()).project).toMatchObject({
      workspaceId: first.id,
      shareToken: project.shareToken,
    });
    // A member can archive and read; a share-link guest cannot read an archived project.
    for (const archivedProject of [project, pdf]) {
      expect(
        (
          await member.patch(`/api/projects/${archivedProject.id}`, { data: { archived: true } })
        ).status(),
      ).toBe(200);
      expect((await review(member, archivedProject)).canManage).toBe(true);
      expect((await guest.get(`/api/reviews/${archivedProject.shareToken}`)).status()).toBe(410);
      expect((await anonymous.get(`/api/reviews/${archivedProject.shareToken}`)).status()).toBe(
        410,
      );
    }
    const download = await member.get(`/api/reviews/${pdf.shareToken}/file`);
    expect(download.status()).toBe(200);
    expect(await download.body()).toEqual(bytes);
    expect((await guest.get(`/api/reviews/${pdf.shareToken}/file`)).status()).toBe(410);
    expect(
      (
        await member.post(`${route}/comments`, {
          data: { body: "Archived write", anchor: websiteAnchor(project.url!) },
        })
      ).status(),
    ).toBe(409);
    expect(await listWorkspaces(member)).toEqual(
      expect.arrayContaining([
        { ...first, role: "member" },
        { ...second, role: "member" },
      ]),
    );

    // createdBy is audit data, not a permanent permission after a transfer.
    const revokeDestination = await grantWorkspaceMember(guestWorkspace.id, ownerIdentity.user.id);
    cleanups.push(revokeDestination);
    expect(
      (
        await owner.patch(`/api/projects/${unscoped.id}`, {
          data: { workspaceId: guestWorkspace.id },
        })
      ).status(),
    ).toBe(200);
    await revokeDestination();
    expect((await review(owner, unscoped)).canManage).toBe(false);
    expect((await review(guest, unscoped)).canManage).toBe(true);
    expect(
      (
        await owner.patch(`/api/projects/${unscoped.id}`, { data: { workspaceId: first.id } })
      ).status(),
    ).toBe(404);
    expect(
      (await guest.patch(`/api/projects/${unscoped.id}`, { data: { archived: true } })).status(),
    ).toBe(200);
    expect((await owner.get(`/api/reviews/${unscoped.shareToken}`)).status()).toBe(410);
  } finally {
    try {
      await Promise.all(cleanups.map((cleanup) => cleanup()));
    } finally {
      await Promise.all([owner.dispose(), member.dispose(), guest.dispose(), anonymous.dispose()]);
    }
  }
});
