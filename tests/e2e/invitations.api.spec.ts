import { test, expect, type APIResponse } from "@playwright/test";
import { randomBytes } from "node:crypto";
import type { Feedback, ReviewData, Workspace } from "../../shared/types";
import {
  apiContext,
  assertLocalWorkspaceEnvironment,
  createWebsite,
  listWorkspaces,
  signIn,
  websiteAnchor,
} from "./helpers";
import {
  assertHashedInvitation,
  expireInvitation,
  invitationEmail,
  sendInvitation,
  workspacePeople,
} from "./invitations-helpers";

async function denied(response: APIResponse, status: number, code?: string) {
  expect(response.status(), await response.text()).toBe(status);
  if (code) expect(await response.json()).toMatchObject({ code });
}

test("emailed workspace invitations bind identity, rotate, expire and cannot restore revoked membership", async () => {
  test.setTimeout(120_000);
  assertLocalWorkspaceEnvironment();
  // Three real OTP identities for this complete lifecycle; all mail stays in local Mailpit.
  const owner = await apiContext("fr");
  const invitee = await apiContext("en");
  const outsider = await apiContext("en");
  const anonymous = await apiContext("en");
  try {
    const ownerIdentity = await signIn(owner, "invitation-owner");
    const invitedIdentity = await signIn(invitee, "invitation-member");
    const otherIdentity = await signIn(outsider, "invitation-other");
    const workspace = (await listWorkspaces(owner))[0];
    const project = await createWebsite(owner, "Invitation access", workspace.id);
    const route = `/api/workspaces/${workspace.id}`;
    const reviewRoute = `/api/reviews/${project.shareToken}`;
    const invitationRoute = `${route}/invitations`;
    const ownerMember = { user: ownerIdentity.user, role: "owner" };
    expect(await workspacePeople(owner, workspace.id)).toEqual({
      members: [ownerMember],
      invitations: [],
    });
    await denied(await anonymous.get(`${route}/members`), 401);
    await denied(await outsider.get(`${route}/members`), 404, "WORKSPACE_NOT_FOUND");
    await denied(
      await anonymous.post(invitationRoute, { data: { email: invitedIdentity.email } }),
      401,
    );
    await denied(
      await outsider.post(invitationRoute, { data: { email: invitedIdentity.email } }),
      404,
      "WORKSPACE_NOT_FOUND",
    );
    await denied(await owner.post(invitationRoute, { data: { email: "invalid" } }), 400);
    await denied(
      await owner.post(invitationRoute, {
        headers: { Origin: "https://untrusted.example" },
        data: { email: invitedIdentity.email },
      }),
      403,
    );
    await denied(
      await owner.post(invitationRoute, { data: { email: ownerIdentity.email } }),
      409,
      "WORKSPACE_ALREADY_MEMBER",
    );

    const first = await sendInvitation(owner, workspace.id, invitedIdentity.email.toUpperCase());
    expect(first.email).toBe(invitedIdentity.email);
    expect(Date.parse(first.expiresAt) - Date.now()).toBeGreaterThan(6.99 * 24 * 60 * 60 * 1000);
    expect(Date.parse(first.expiresAt) - Date.now()).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);
    const initialEmail = await invitationEmail(invitedIdentity.email);
    expect(initialEmail.text).toContain(workspace.name);
    expect(initialEmail.text).toContain(ownerIdentity.name);
    await assertHashedInvitation(workspace.id, first, initialEmail.token);
    const publicResponse = await anonymous.get(`/api/invitations/${initialEmail.token}`);
    expect(publicResponse.status()).toBe(200);
    const metadata = await publicResponse.json();
    expect(metadata).toMatchObject({
      invitation: {
        workspaceName: workspace.name,
        inviterName: ownerIdentity.name,
        expiresAt: first.expiresAt,
      },
      user: null,
      canAccept: false,
    });
    expect(metadata.invitation.emailHint).toContain("@");
    expect(JSON.stringify(metadata)).not.toContain(invitedIdentity.email);
    expect((await workspacePeople(owner, workspace.id)).members).toEqual([ownerMember]);
    expect((await listWorkspaces(invitee)).map((item) => item.id)).not.toContain(workspace.id);
    await denied(await invitee.get(`/api/projects?workspaceId=${workspace.id}`), 404);
    await denied(await anonymous.post(`/api/invitations/${initialEmail.token}`), 401);
    await denied(
      await outsider.post(`/api/invitations/${initialEmail.token}`),
      403,
      "INVITATION_EMAIL_MISMATCH",
    );
    expect(
      (await (await outsider.get(`/api/invitations/${initialEmail.token}`)).json()).canAccept,
    ).toBe(false);
    await denied(
      await anonymous.get(`/api/invitations/${randomBytes(32).toString("base64url")}`),
      404,
      "INVITATION_NOT_FOUND",
    );

    const rotated = await sendInvitation(owner, workspace.id, invitedIdentity.email);
    expect(rotated.id).toBe(first.id);
    const rotatedEmail = await invitationEmail(invitedIdentity.email, [initialEmail.token]);
    expect(rotatedEmail.token).not.toBe(initialEmail.token);
    await denied(
      await invitee.post(`/api/invitations/${initialEmail.token}`),
      404,
      "INVITATION_NOT_FOUND",
    );
    expect((await workspacePeople(owner, workspace.id)).invitations).toEqual([rotated]);
    expect((await owner.delete(`${invitationRoute}/${rotated.id}`)).status()).toBe(200);
    await denied(
      await anonymous.get(`/api/invitations/${rotatedEmail.token}`),
      410,
      "INVITATION_UNAVAILABLE",
    );
    await denied(
      await invitee.post(`/api/invitations/${rotatedEmail.token}`),
      410,
      "INVITATION_UNAVAILABLE",
    );
    expect((await workspacePeople(owner, workspace.id)).invitations).toEqual([]);

    const expiring = await sendInvitation(owner, workspace.id, invitedIdentity.email);
    const expiringEmail = await invitationEmail(invitedIdentity.email, [
      initialEmail.token,
      rotatedEmail.token,
    ]);
    await expireInvitation(workspace.id, expiring);
    await denied(
      await anonymous.get(`/api/invitations/${expiringEmail.token}`),
      410,
      "INVITATION_UNAVAILABLE",
    );
    await denied(
      await invitee.post(`/api/invitations/${expiringEmail.token}`),
      410,
      "INVITATION_UNAVAILABLE",
    );
    expect((await workspacePeople(owner, workspace.id)).invitations).toEqual([]);

    const accepting = await sendInvitation(owner, workspace.id, invitedIdentity.email);
    const acceptingEmail = await invitationEmail(invitedIdentity.email, [
      initialEmail.token,
      rotatedEmail.token,
      expiringEmail.token,
    ]);
    await assertHashedInvitation(workspace.id, accepting, acceptingEmail.token);
    expect(
      (await (await invitee.get(`/api/invitations/${acceptingEmail.token}`)).json()).canAccept,
    ).toBe(true);
    await denied(
      await invitee.post(`/api/invitations/${acceptingEmail.token}`, {
        headers: { Origin: "https://untrusted.example" },
      }),
      403,
    );
    // The link allows review feedback before workspace membership, but never project management.
    const guestFeedback = await invitee.post(`${reviewRoute}/comments`, {
      data: { body: "Feedback before accepting membership", anchor: websiteAnchor(project.url!) },
    });
    expect(guestFeedback.status()).toBe(201);
    expect(((await (await invitee.get(reviewRoute)).json()) as ReviewData).canManage).toBe(false);
    const accepted = await invitee.post(`/api/invitations/${acceptingEmail.token}`);
    expect(accepted.status(), await accepted.text()).toBe(200);
    expect((await accepted.json()).workspace).toEqual({
      ...workspace,
      role: "member",
    } satisfies Workspace);
    expect((await invitee.post(`/api/invitations/${acceptingEmail.token}`)).status()).toBe(200);
    const people = await workspacePeople(owner, workspace.id);
    expect(people.members).toHaveLength(2);
    expect(people.members).toContainEqual({ user: invitedIdentity.user, role: "member" });
    expect(people.invitations).toEqual([]);
    expect(((await (await invitee.get(reviewRoute)).json()) as ReviewData).canManage).toBe(true);
    expect(
      (await (await invitee.get(`/api/projects?workspaceId=${workspace.id}`)).json()).projects,
    ).toContainEqual(expect.objectContaining({ id: project.id }));
    await denied(
      await owner.post(invitationRoute, { data: { email: invitedIdentity.email } }),
      409,
      "WORKSPACE_ALREADY_MEMBER",
    );

    const pendingOther = await sendInvitation(owner, workspace.id, otherIdentity.email);
    expect((await workspacePeople(owner, workspace.id)).invitations).toContainEqual(pendingOther);
    expect((await workspacePeople(invitee, workspace.id)).invitations).toEqual([]);
    await denied(
      await invitee.post(invitationRoute, { data: { email: otherIdentity.email } }),
      403,
      "WORKSPACE_OWNER_REQUIRED",
    );
    await denied(
      await invitee.delete(`${invitationRoute}/${pendingOther.id}`),
      403,
      "WORKSPACE_OWNER_REQUIRED",
    );
    await denied(
      await invitee.delete(`${route}/members/${ownerIdentity.user.id}`),
      403,
      "WORKSPACE_OWNER_REQUIRED",
    );
    await denied(
      await invitee.delete(`${route}/members/${invitedIdentity.user.id}`),
      403,
      "WORKSPACE_OWNER_REQUIRED",
    );
    await denied(
      await owner.delete(`${route}/members/${ownerIdentity.user.id}`),
      403,
      "WORKSPACE_MEMBER_PROTECTED",
    );
    const otherWorkspace = (await listWorkspaces(outsider))[0];
    await denied(
      await outsider.delete(`/api/workspaces/${otherWorkspace.id}/invitations/${pendingOther.id}`),
      404,
    );
    await denied(await outsider.delete(`${route}/members/${invitedIdentity.user.id}`), 404);
    expect((await workspacePeople(owner, workspace.id)).members).toContainEqual(ownerMember);
    const ownerCommentResponse = await owner.post(`${reviewRoute}/comments`, {
      data: { body: "Managed while a workspace member", anchor: websiteAnchor(project.url!) },
    });
    expect(ownerCommentResponse.status()).toBe(201);
    const ownerComment = ((await ownerCommentResponse.json()) as { comment: Feedback }).comment;
    expect(
      (
        await invitee.patch(`${reviewRoute}/comments/${ownerComment.id}`, {
          data: { status: "resolved" },
        })
      ).status(),
    ).toBe(200);

    expect((await owner.delete(`${route}/members/${invitedIdentity.user.id}`)).status()).toBe(200);
    expect((await workspacePeople(owner, workspace.id)).members).toEqual([ownerMember]);
    expect((await listWorkspaces(invitee)).map((item) => item.id)).not.toContain(workspace.id);
    await denied(await invitee.get(`/api/projects?workspaceId=${workspace.id}`), 404);
    await denied(
      await invitee.patch(`/api/projects/${project.id}`, { data: { name: "After removal" } }),
      404,
    );
    await denied(
      await invitee.post(`/api/invitations/${acceptingEmail.token}`),
      410,
      "INVITATION_UNAVAILABLE",
    );
    await denied(
      await invitee.get(`/api/invitations/${acceptingEmail.token}`),
      410,
      "INVITATION_UNAVAILABLE",
    );
    expect((await workspacePeople(owner, workspace.id)).members).toEqual([ownerMember]);
    const afterRemoval = (await (await invitee.get(reviewRoute)).json()) as ReviewData;
    expect(afterRemoval.canManage).toBe(false);
    expect(afterRemoval.comments).toHaveLength(2);
    await denied(
      await invitee.patch(`${reviewRoute}/comments/${ownerComment.id}`, {
        data: { status: "open" },
      }),
      403,
    );
    const stillGuest = await invitee.post(`${reviewRoute}/comments`, {
      data: {
        body: "Shared links still allow guest feedback",
        anchor: websiteAnchor(project.url!),
      },
    });
    expect(stillGuest.status()).toBe(201);
    expect((await stillGuest.json()).comment.author).toEqual(invitedIdentity.user);
    expect((await owner.delete(`${invitationRoute}/${pendingOther.id}`)).status()).toBe(200);
  } finally {
    await Promise.all([
      owner.dispose(),
      invitee.dispose(),
      outsider.dispose(),
      anonymous.dispose(),
    ]);
  }
});
