import { expect, request, type APIRequestContext } from "@playwright/test";
import type { WorkspaceInvitation, WorkspaceMember } from "../../shared/types";
import { assertLocalWorkspaceEnvironment, baseURL } from "./helpers";

export type PendingInvitation = WorkspaceInvitation;

export type WorkspacePeople = {
  members: WorkspaceMember[];
  invitations: PendingInvitation[];
};

export async function workspacePeople(api: APIRequestContext, workspaceId: string) {
  const response = await api.get(`/api/workspaces/${workspaceId}/members`);
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as WorkspacePeople;
}

export async function sendInvitation(api: APIRequestContext, workspaceId: string, email: string) {
  const response = await api.post(`/api/workspaces/${workspaceId}/invitations`, {
    data: { email },
  });
  expect(response.status(), await response.text()).toBe(201);
  const payload = (await response.json()) as { invitation: PendingInvitation };
  // Only the mailbox receives the capability; administrator API responses must not leak it.
  expect(Object.keys(payload.invitation).sort()).toEqual(["createdAt", "email", "expiresAt", "id"]);
  return payload.invitation;
}

/** Read real invitation delivery separately from OTP messages sent to the same mailbox. */
export async function invitationEmail(email: string, excludedTokens: string[] = []) {
  assertLocalWorkspaceEnvironment();
  const mailpit = await request.newContext({
    baseURL: process.env.MAILPIT_URL ?? "http://127.0.0.1:8026",
  });
  let invitation: { token: string; url: string; text: string; subject: string } | undefined;
  try {
    await expect(async () => {
      const response = await mailpit.get("/api/v1/messages", { params: { limit: 200 } });
      expect(response.ok(), "Local Mailpit must receive the actual invitation email").toBeTruthy();
      const data = (await response.json()) as {
        messages: { ID: string; To: { Address: string }[] }[];
      };
      for (const summary of data.messages.filter((message) =>
        message.To.some((recipient) => recipient.Address.toLowerCase() === email.toLowerCase()),
      )) {
        const detail = (await (await mailpit.get(`/api/v1/message/${summary.ID}`)).json()) as {
          Text: string;
          Subject: string;
        };
        const match = detail.Text.match(
          /https?:\/\/[^\s<>]+\/invite\/([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/,
        );
        if (!match || excludedTokens.includes(match[1])) continue;
        const url = new URL(match[0]);
        expect(url.origin).toBe(new URL(baseURL()).origin);
        expect(url.pathname).toBe(`/invite/${match[1]}`);
        invitation = {
          token: match[1],
          url: url.toString(),
          text: detail.Text,
          subject: detail.Subject,
        };
        break;
      }
      expect(invitation, "Waiting for an invitation link in the local test mailbox").toBeTruthy();
    }).toPass({ timeout: 20_000, intervals: [100, 300, 700] });
    return invitation!;
  } finally {
    await mailpit.dispose();
  }
}

async function invitationDatabase() {
  assertLocalWorkspaceEnvironment();
  const databaseUrl = process.env.DATABASE_URL;
  if (
    !databaseUrl ||
    !["localhost", "127.0.0.1", "[::1]"].includes(new URL(databaseUrl).hostname)
  ) {
    throw new Error("Invitation fixtures require a loopback MySQL DATABASE_URL.");
  }
  const { createConnection } = await import("mysql2/promise");
  return createConnection({ uri: databaseUrl, timezone: "Z" });
}

export async function assertHashedInvitation(
  workspaceId: string,
  invitation: PendingInvitation,
  token: string,
) {
  const db = await invitationDatabase();
  try {
    const [rows] = await db.execute(
      "SELECT tokenHash, pendingTokenHash FROM workspace_invitations WHERE id = ? AND workspaceId = ? AND email = ?",
      [invitation.id, workspaceId, invitation.email],
    );
    const stored = (rows as { tokenHash: string; pendingTokenHash: string | null }[])[0];
    expect(stored).toBeTruthy();
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.pendingTokenHash).toBeNull();
    expect(JSON.stringify(stored)).not.toContain(token);
  } finally {
    await db.end();
  }
}

/** Expire only the test-created invitation; leave users, sessions and rate limits untouched. */
export async function expireInvitation(workspaceId: string, invitation: PendingInvitation) {
  if (!/^e2e-[^@]+@example\.test$/.test(invitation.email)) {
    throw new Error("Invitation expiry fixtures require a synthetic integration-test recipient.");
  }
  const db = await invitationDatabase();
  try {
    const [result] = await db.execute(
      "UPDATE workspace_invitations SET expiresAt = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ? AND workspaceId = ? AND email = ? AND acceptedAt IS NULL AND revokedAt IS NULL",
      [invitation.id, workspaceId, invitation.email],
    );
    expect((result as { affectedRows: number }).affectedRows).toBe(1);
  } finally {
    await db.end();
  }
}
