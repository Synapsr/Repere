import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { database, type Transaction } from "@/db";
import { users, workspaceInvitations, workspaceMembers, workspaces } from "@/db/schema";
import type {
  InvitationData,
  User,
  Workspace,
  WorkspaceInvitation,
  WorkspaceMember,
} from "../../../shared/types";
import type { Locale } from "../../../shared/locale";
import { ApiError } from "./errors";
import { renderInvitationEmail } from "./emails";
import { sendEmail } from "./mail";
import { rateLimit } from "./rate-limit";
import { appOrigin, randomToken, tokenHash } from "./security";
import {
  lockWorkspaceUser,
  requireWorkspaceMembership,
  requireWorkspaceOwner,
  workspaceMembership,
} from "./workspaces";

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const INVITATION_SEND_LEASE_MS = 60 * 1000;
type InvitationRow = typeof workspaceInvitations.$inferSelect;

export function publicInvitation(row: InvitationRow): WorkspaceInvitation {
  return {
    id: row.id,
    email: row.email,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

export function invitationEmailHint(email: string) {
  const separator = email.lastIndexOf("@");
  return `${email.slice(0, 1)}•••@${email.slice(separator + 1)}`;
}

export function invitationUnavailable(
  row: Pick<InvitationRow, "expiresAt" | "revokedAt">,
  now = new Date(),
) {
  return !!row.revokedAt || row.expiresAt <= now;
}

export function invitationSendInProgress(
  row: Pick<InvitationRow, "pendingTokenHash" | "pendingStartedAt">,
  now = new Date(),
) {
  return (
    !!row.pendingTokenHash &&
    !!row.pendingStartedAt &&
    now.getTime() - row.pendingStartedAt.getTime() < INVITATION_SEND_LEASE_MS
  );
}

function assertInvitationToken(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(404, "INVITATION_NOT_FOUND");
}

async function emailIsMember(tx: Transaction, workspaceId: string, email: string) {
  // Do not lock the joined user row after the invitation: acceptance locks user first.
  // Only the membership needs a current locking read to serialize member removal.
  const [recipient] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  return !!recipient && !!(await workspaceMembership(workspaceId, recipient.id, tx, "share"));
}

export async function listWorkspaceMembers(
  workspaceId: string,
  user: User,
): Promise<{ members: WorkspaceMember[]; invitations: WorkspaceInvitation[] }> {
  return database().transaction(async (tx) => {
    const membership = await requireWorkspaceMembership(workspaceId, user.id, tx, "share");
    const members = await tx
      .select({
        user: { id: users.id, name: users.name, email: users.email },
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(asc(workspaceMembers.createdAt), asc(users.id));
    const invitations =
      membership.role === "owner"
        ? await tx
            .select()
            .from(workspaceInvitations)
            .where(
              and(
                eq(workspaceInvitations.workspaceId, workspaceId),
                isNotNull(workspaceInvitations.tokenHash),
                isNull(workspaceInvitations.acceptedAt),
                isNull(workspaceInvitations.revokedAt),
                gt(workspaceInvitations.expiresAt, new Date()),
              ),
            )
            .orderBy(asc(workspaceInvitations.createdAt), asc(workspaceInvitations.id))
        : [];
    return { members, invitations: invitations.map(publicInvitation) };
  });
}

/** Delivery failure must not consume the prior working invitation or activate an unsent token. */
export async function deliverInvitation<T>(
  send: () => Promise<void>,
  activate: () => Promise<T>,
  discard: () => Promise<void>,
): Promise<T> {
  try {
    await send();
  } catch {
    await discard();
    throw new ApiError(503, "EMAIL_DELIVERY_FAILED");
  }
  return activate();
}

export async function inviteWorkspaceMember(
  workspaceId: string,
  user: User,
  email: string,
  locale: Locale,
): Promise<WorkspaceInvitation> {
  await requireWorkspaceOwner(workspaceId, user.id);
  await rateLimit("invitation-send-user", user.id, 30, 60 * 60 * 1000);
  await rateLimit("invitation-send-workspace", workspaceId, 50, 60 * 60 * 1000);
  await rateLimit("invitation-send-email", `${workspaceId}:${email}`, 5, 60 * 60 * 1000);
  const rawToken = randomToken();
  const candidate = tokenHash(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  const prepared = await database().transaction(async (tx) => {
    await requireWorkspaceOwner(workspaceId, user.id, tx, "share");
    // The unique workspace/email row serializes resends without holding a DB lock during SMTP.
    await tx
      .insert(workspaceInvitations)
      .values({ id: randomUUID(), workspaceId, email, expiresAt, createdAt: now, updatedAt: now })
      .onDuplicateKeyUpdate({ set: { id: sql`${workspaceInvitations.id}` } });
    const [row] = await tx
      .select()
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, workspaceId),
          eq(workspaceInvitations.email, email),
        ),
      )
      .for("update");
    if (invitationSendInProgress(row, now)) throw new ApiError(409, "INVITATION_SEND_IN_PROGRESS");
    if (await emailIsMember(tx, workspaceId, email))
      throw new ApiError(409, "WORKSPACE_ALREADY_MEMBER");
    await tx
      .update(workspaceInvitations)
      .set({ pendingTokenHash: candidate, pendingStartedAt: now })
      .where(eq(workspaceInvitations.id, row.id));
    const [workspace] = await tx
      .select({ name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId));
    return { id: row.id, workspaceName: workspace.name };
  });
  const currentCandidate = and(
    eq(workspaceInvitations.id, prepared.id),
    eq(workspaceInvitations.pendingTokenHash, candidate),
  );
  return deliverInvitation(
    () =>
      sendEmail(
        email,
        renderInvitationEmail(locale, {
          workspaceName: prepared.workspaceName,
          inviterName: user.name,
          url: `${appOrigin()}/invite/${rawToken}`,
        }),
      ),
    () =>
      database()
        .transaction(async (tx) => {
          await requireWorkspaceOwner(workspaceId, user.id, tx, "share");
          const [row] = await tx
            .select()
            .from(workspaceInvitations)
            .where(currentCandidate)
            .for("update");
          if (!row) throw new ApiError(409, "INVITATION_CHANGED");
          if (await emailIsMember(tx, workspaceId, email)) {
            // The old link may have been accepted during delivery; never make a second reusable grant.
            await tx
              .update(workspaceInvitations)
              .set({ pendingTokenHash: null, pendingStartedAt: null })
              .where(currentCandidate);
            return null;
          }
          const patch = {
            tokenHash: candidate,
            pendingTokenHash: null,
            pendingStartedAt: null,
            inviterId: user.id,
            expiresAt,
            acceptedAt: null,
            revokedAt: null,
            updatedAt: new Date(),
          };
          await tx.update(workspaceInvitations).set(patch).where(currentCandidate);
          return publicInvitation({ ...row, ...patch });
        })
        .then((invitation) => {
          if (!invitation) throw new ApiError(409, "WORKSPACE_ALREADY_MEMBER");
          return invitation;
        }),
    () =>
      database().transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(workspaceInvitations)
          .where(currentCandidate)
          .for("update");
        if (!row) return; // A newer send or cancellation owns the row; do not undo it.
        if (row.tokenHash === null) await tx.delete(workspaceInvitations).where(currentCandidate);
        else
          await tx
            .update(workspaceInvitations)
            .set({ pendingTokenHash: null, pendingStartedAt: null })
            .where(currentCandidate);
      }),
  );
}

export async function revokeWorkspaceInvitation(
  workspaceId: string,
  invitationId: string,
  user: User,
) {
  await rateLimit("invitation-revoke", user.id, 60, 60 * 60 * 1000);
  await database().transaction(async (tx) => {
    await requireWorkspaceOwner(workspaceId, user.id, tx, "share");
    const [row] = await tx
      .select()
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.id, invitationId),
          eq(workspaceInvitations.workspaceId, workspaceId),
        ),
      )
      .for("update");
    if (!row) throw new ApiError(404, "INVITATION_NOT_FOUND");
    if (row.acceptedAt) throw new ApiError(410, "INVITATION_UNAVAILABLE");
    await tx
      .update(workspaceInvitations)
      .set({
        revokedAt: new Date(),
        pendingTokenHash: null,
        pendingStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(workspaceInvitations.id, row.id));
  });
}

export async function removeWorkspaceMember(workspaceId: string, memberId: string, user: User) {
  await rateLimit("workspace-member-remove", user.id, 60, 60 * 60 * 1000);
  await database().transaction(async (tx) => {
    await requireWorkspaceOwner(workspaceId, user.id, tx, "share");
    if (memberId === user.id) throw new ApiError(403, "WORKSPACE_MEMBER_PROTECTED");
    const target = await workspaceMembership(workspaceId, memberId, tx, "update");
    if (!target) throw new ApiError(404, "WORKSPACE_MEMBER_NOT_FOUND");
    if (target.role === "owner") throw new ApiError(403, "WORKSPACE_MEMBER_PROTECTED");
    await tx
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, memberId)),
      );
  });
}

export async function getInvitation(token: string, user: User | null): Promise<InvitationData> {
  assertInvitationToken(token);
  const [result] = await database()
    .select({
      invitation: workspaceInvitations,
      workspaceName: workspaces.name,
      inviterName: users.name,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
    .leftJoin(users, eq(users.id, workspaceInvitations.inviterId))
    .where(eq(workspaceInvitations.tokenHash, tokenHash(token)))
    .limit(1);
  if (!result) throw new ApiError(404, "INVITATION_NOT_FOUND");
  const row = result.invitation;
  if (invitationUnavailable(row)) throw new ApiError(410, "INVITATION_UNAVAILABLE");
  const matches = user?.email === row.email;
  if (row.acceptedAt && (!matches || !(await workspaceMembership(row.workspaceId, user!.id))))
    throw new ApiError(410, "INVITATION_UNAVAILABLE");
  return {
    invitation: {
      workspaceName: result.workspaceName,
      inviterName: result.inviterName,
      emailHint: invitationEmailHint(row.email),
      expiresAt: row.expiresAt.toISOString(),
    },
    user,
    canAccept: matches,
  };
}

export async function acceptInvitation(token: string, user: User): Promise<Workspace> {
  assertInvitationToken(token);
  await rateLimit("invitation-accept", user.id, 60, 60 * 60 * 1000);
  return database().transaction(async (tx) => {
    // Shared with first-workspace bootstrap so accepting and opening the dashboard cannot race.
    await lockWorkspaceUser(tx, user.id);
    const [row] = await tx
      .select()
      .from(workspaceInvitations)
      .where(eq(workspaceInvitations.tokenHash, tokenHash(token)))
      .for("update");
    if (!row) throw new ApiError(404, "INVITATION_NOT_FOUND");
    if (invitationUnavailable(row)) throw new ApiError(410, "INVITATION_UNAVAILABLE");
    if (row.email !== user.email) throw new ApiError(403, "INVITATION_EMAIL_MISMATCH");
    const membership = await workspaceMembership(row.workspaceId, user.id, tx, "share");
    if (row.acceptedAt && !membership) throw new ApiError(410, "INVITATION_UNAVAILABLE");
    if (!membership)
      await tx.insert(workspaceMembers).values({
        workspaceId: row.workspaceId,
        userId: user.id,
        role: "member",
        createdAt: new Date(),
      });
    if (!row.acceptedAt)
      await tx
        .update(workspaceInvitations)
        // Invalidate a resend that was in flight when the prior link was accepted.
        // It must not become a fresh grant after this membership is later removed.
        .set({
          acceptedAt: new Date(),
          pendingTokenHash: null,
          pendingStartedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(workspaceInvitations.id, row.id));
    const [workspace] = await tx
      .select({ id: workspaces.id, name: workspaces.name })
      .from(workspaces)
      .where(eq(workspaces.id, row.workspaceId));
    return { ...workspace, role: membership?.role ?? "member" };
  });
}
