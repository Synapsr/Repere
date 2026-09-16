import { test, expect, type APIRequestContext, type APIResponse } from "@playwright/test";
import sharp from "sharp";
import type { Project, ReviewData } from "../../shared/types";
import {
  apiContext,
  assertLocalWorkspaceEnvironment,
  createWebsite,
  listWorkspaces,
  signIn,
} from "./helpers";
import { invitationEmail, sendInvitation } from "./invitations-helpers";

type Cover = { source: "automatic" | "custom"; version: string };
type Image = { name: string; mimeType: string; buffer: Buffer };

async function coverResult(response: APIResponse) {
  expect(response.status(), await response.text()).toBe(200);
  const result = (await response.json()) as { cover: Cover | null };
  expect(Object.keys(result)).toEqual(["cover"]);
  if (result.cover) {
    expect(Object.keys(result.cover).sort()).toEqual(["source", "version"]);
    expect(["automatic", "custom"]).toContain(result.cover.source);
    expect(result.cover.version).toEqual(expect.any(String));
    expect(result.cover.version.length).toBeGreaterThan(0);
  }
  return result.cover;
}

async function upload(api: APIRequestContext, route: string, source: Cover["source"], file: Image) {
  return coverResult(await api.post(route, { multipart: { source, file } }));
}

async function denied(response: APIResponse, status: number, code?: string) {
  expect(response.status(), await response.text()).toBe(status);
  if (code) expect(await response.json()).toMatchObject({ code });
}

async function jpeg(api: APIRequestContext, route: string, expectedColor: number[]) {
  const response = await api.get(route);
  expect(response.status(), await response.text()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/jpeg");
  expect(response.headers()["cache-control"]).toContain("private");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["x-content-type-options"]).toBe("nosniff");
  const bytes = await response.body();
  expect((await sharp(bytes).metadata()).format).toBe("jpeg");
  const pixel = await sharp(bytes).resize(1, 1).removeAlpha().raw().toBuffer();
  for (const [channel, value] of expectedColor.entries())
    expect(Math.abs(pixel[channel] - value)).toBeLessThan(15);
  return bytes;
}

async function listedProject(api: APIRequestContext, workspaceId: string, id: string) {
  const response = await api.get("/api/projects", { params: { workspaceId } });
  expect(response.status(), await response.text()).toBe(200);
  const { projects } = (await response.json()) as { projects: Project[] };
  const project = projects.find((item) => item.id === id);
  expect(project).toBeTruthy();
  return project!;
}

async function sharedProject(api: APIRequestContext, token: string) {
  const response = await api.get(`/api/reviews/${token}`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as ReviewData;
}

test("project covers preserve their automatic original, support custom overrides and follow workspace access", async () => {
  test.setTimeout(120_000);
  assertLocalWorkspaceEnvironment();
  // Two OTP identities; membership changes use real invitation emails and APIs.
  const owner = await apiContext();
  const guest = await apiContext();
  const anonymous = await apiContext();
  try {
    const ownerIdentity = await signIn(owner, "cover-owner");
    const guestIdentity = await signIn(guest, "cover-guest");
    const guestWorkspace = (await listWorkspaces(guest))[0];
    const project = await createWebsite(owner, "Project cover lifecycle");
    const route = `/api/projects/${project.id}/cover`;
    expect(project).toMatchObject({ cover: null });
    await denied(await owner.get(route), 404, "COVER_NOT_FOUND");

    const makeImage = (background: string) =>
      sharp({ create: { width: 320, height: 180, channels: 3, background } });
    const automaticImage: Image = {
      name: "automatic.png",
      mimeType: "image/png",
      buffer: await makeImage("#1a9452").png().toBuffer(),
    };
    const customImage: Image = {
      name: "custom.webp",
      mimeType: "image/webp",
      buffer: await makeImage("#dc283c").webp().toBuffer(),
    };
    const replacementImage: Image = {
      name: "replacement.jpg",
      mimeType: "image/jpeg",
      buffer: await makeImage("#1452d1").jpeg().toBuffer(),
    };
    for (const api of [anonymous, guest]) {
      const status = api === anonymous ? 401 : 404;
      await denied(await api.get(route), status);
      await denied(
        await api.post(route, { multipart: { source: "custom", file: customImage } }),
        status,
      );
      await denied(await api.delete(route), status);
    }

    const automatic = await upload(owner, route, "automatic", automaticImage);
    expect(automatic).toMatchObject({ source: "automatic" });
    const originalBytes = await jpeg(owner, route, [26, 148, 82]);
    expect(await listedProject(owner, project.workspaceId, project.id)).toMatchObject({
      cover: automatic,
      commentCount: 0,
    });
    expect(await sharedProject(owner, project.shareToken)).toMatchObject({
      canManage: true,
      project: { cover: automatic },
    });
    for (const api of [guest, anonymous]) {
      expect(await sharedProject(api, project.shareToken)).toMatchObject({
        canManage: false,
        project: { cover: null },
      });
    }
    // Even a valid newer automatic image cannot replace the first successful upload.
    expect(await upload(owner, route, "automatic", replacementImage)).toEqual(automatic);
    expect(await jpeg(owner, route, [26, 148, 82])).toEqual(originalBytes);

    const custom = await upload(owner, route, "custom", customImage);
    expect(custom).toMatchObject({ source: "custom" });
    expect(custom!.version).not.toBe(automatic!.version);
    await jpeg(owner, route, [220, 40, 60]);
    const replacement = await upload(owner, route, "custom", replacementImage);
    expect(replacement).toMatchObject({ source: "custom" });
    expect(replacement!.version).not.toBe(custom!.version);
    const replacementBytes = await jpeg(owner, route, [20, 82, 209]);
    expect(await upload(owner, route, "automatic", automaticImage)).toEqual(replacement);
    expect(await jpeg(owner, route, [20, 82, 209])).toEqual(replacementBytes);

    await denied(
      await owner.post(route, {
        headers: { Origin: "https://untrusted.example" },
        multipart: { source: "custom", file: automaticImage },
      }),
      403,
    );
    await denied(
      await owner.delete(route, { headers: { Origin: "https://untrusted.example" } }),
      403,
    );
    for (const response of [
      await owner.post(route, { data: { source: "custom" } }),
      await owner.post(route, { multipart: { source: "custom" } }),
      await owner.post(route, { multipart: { file: automaticImage } }),
      await owner.post(route, { multipart: { source: "owner", file: automaticImage } }),
      await owner.post(route, {
        multipart: {
          source: "custom",
          file: { name: "fake.jpg", mimeType: "image/jpeg", buffer: Buffer.from("not an image") },
        },
      }),
    ])
      await denied(response, 400, "COVER_INVALID");
    await denied(
      await owner.post(route, {
        multipart: {
          source: "custom",
          file: {
            name: "oversized.jpg",
            mimeType: "image/jpeg",
            buffer: Buffer.alloc(10 * 1024 * 1024 + 1),
          },
        },
      }),
      413,
      "PAYLOAD_TOO_LARGE",
    );
    expect(await listedProject(owner, project.workspaceId, project.id)).toMatchObject({
      cover: replacement,
      commentCount: 0,
    });
    expect(await jpeg(owner, route, [20, 82, 209])).toEqual(replacementBytes);
    const restored = await coverResult(await owner.delete(route));
    expect(restored).toMatchObject({ source: "automatic" });
    expect(restored!.version).not.toBe(replacement!.version);
    expect(await jpeg(owner, route, [26, 148, 82])).toEqual(originalBytes);
    expect(await listedProject(owner, project.workspaceId, project.id)).toMatchObject({
      cover: restored,
    });

    const archived = await createWebsite(owner, "Archived project custom cover");
    const archivedRoute = `/api/projects/${archived.id}/cover`;
    expect(
      (await owner.patch(`/api/projects/${archived.id}`, { data: { archived: true } })).status(),
    ).toBe(200);
    expect(await upload(owner, archivedRoute, "automatic", automaticImage)).toBeNull();
    await denied(await owner.get(archivedRoute), 404, "COVER_NOT_FOUND");
    const archivedCustom = await upload(owner, archivedRoute, "custom", customImage);
    expect(archivedCustom).toMatchObject({ source: "custom" });
    await jpeg(owner, archivedRoute, [220, 40, 60]);
    expect(await upload(owner, archivedRoute, "automatic", automaticImage)).toEqual(archivedCustom);
    await denied(await guest.get(archivedRoute), 404, "PROJECT_NOT_FOUND");
    expect(await coverResult(await owner.delete(archivedRoute))).toBeNull();
    await denied(await owner.get(archivedRoute), 404, "COVER_NOT_FOUND");

    await sendInvitation(owner, project.workspaceId, guestIdentity.email);
    const memberInvitation = await invitationEmail(guestIdentity.email);
    expect((await guest.post(`/api/invitations/${memberInvitation.token}`)).status()).toBe(200);
    expect(await jpeg(guest, route, [26, 148, 82])).toEqual(originalBytes);
    expect(await sharedProject(guest, project.shareToken)).toMatchObject({
      canManage: true,
      project: { cover: restored },
    });
    expect(await upload(guest, route, "custom", customImage)).toMatchObject({ source: "custom" });
    const restoredByMember = await coverResult(await guest.delete(route));
    expect(restoredByMember).toMatchObject({ source: "automatic" });
    expect(await jpeg(owner, route, [26, 148, 82])).toEqual(originalBytes);
    expect(
      (
        await owner.delete(
          `/api/workspaces/${project.workspaceId}/members/${guestIdentity.user.id}`,
        )
      ).status(),
    ).toBe(200);
    await denied(await guest.get(route), 404, "PROJECT_NOT_FOUND");
    await denied(
      await guest.post(route, { multipart: { source: "custom", file: customImage } }),
      404,
      "PROJECT_NOT_FOUND",
    );
    await denied(await guest.delete(route), 404, "PROJECT_NOT_FOUND");
    expect(await sharedProject(guest, project.shareToken)).toMatchObject({
      canManage: false,
      project: { cover: null },
    });

    // Moving the project changes cover permissions immediately. Its original
    // creator has no permanent access after losing destination membership.
    await sendInvitation(guest, guestWorkspace.id, ownerIdentity.email);
    const transferInvitation = await invitationEmail(ownerIdentity.email);
    expect((await owner.post(`/api/invitations/${transferInvitation.token}`)).status()).toBe(200);
    const moved = await owner.patch(`/api/projects/${project.id}`, {
      data: { workspaceId: guestWorkspace.id },
    });
    expect(moved.status(), await moved.text()).toBe(200);
    expect((await moved.json()).project).toMatchObject({
      shareToken: project.shareToken,
      workspaceId: guestWorkspace.id,
      cover: restoredByMember,
    });
    expect(
      (
        await guest.delete(`/api/workspaces/${guestWorkspace.id}/members/${ownerIdentity.user.id}`)
      ).status(),
    ).toBe(200);
    await denied(await owner.get(route), 404, "PROJECT_NOT_FOUND");
    await denied(
      await owner.post(route, { multipart: { source: "automatic", file: automaticImage } }),
      404,
      "PROJECT_NOT_FOUND",
    );
    await denied(await owner.delete(route), 404, "PROJECT_NOT_FOUND");
    expect(await sharedProject(owner, project.shareToken)).toMatchObject({
      canManage: false,
      project: { cover: null },
    });
    expect(await jpeg(guest, route, [26, 148, 82])).toEqual(originalBytes);
    expect(await listedProject(guest, guestWorkspace.id, project.id)).toMatchObject({
      cover: restoredByMember,
    });
  } finally {
    await Promise.all([owner.dispose(), guest.dispose(), anonymous.dispose()]);
  }
});
