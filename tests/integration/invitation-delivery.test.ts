import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import mysql, { type Connection, type Pool, type RowDataPacket } from "mysql2/promise";
import type { User } from "../../shared/types";
import {
  acceptInvitation,
  getInvitation,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  revokeWorkspaceInvitation,
} from "../../src/lib/server/invitations";
import { tokenHash } from "../../src/lib/server/security";

type Email = { subject: string; text: string; html: string };
const smtp = vi.hoisted(() => vi.fn<(to: string, content: Email) => Promise<void>>());
vi.mock("../../src/lib/server/mail", () => ({ sendEmail: smtp }));

let connection: Connection;
let owner: User;
let invited: User;
let workspaceId: string;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function emailToken(call = -1) {
  const content = smtp.mock.calls.at(call)?.[1];
  const match = content?.text.match(/http:\/\/localhost:3999\/invite\/([A-Za-z0-9_-]{43})/);
  expect(!!match, "A link must be present in the mocked outbound email").toBe(true);
  return match![1];
}

async function invitationRows() {
  const [rows] = await connection.execute<RowDataPacket[]>(
    "SELECT * FROM workspace_invitations WHERE workspaceId=? AND email=?",
    [workspaceId, invited.email],
  );
  return rows;
}

async function memberCount() {
  const [[row]] = await connection.execute<RowDataPacket[]>(
    "SELECT COUNT(*) AS count FROM workspace_members WHERE workspaceId=? AND userId=?",
    [workspaceId, invited.id],
  );
  return row.count as number;
}

beforeAll(async () => {
  const value = process.env.INVITATION_TEST_DATABASE_URL;
  if (!value)
    throw new Error(
      "Run this suite through npm run test:invitations with its disposable MySQL database.",
    );
  const url = new URL(value);
  if (
    url.protocol !== "mysql:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    !/^\/repere_invitation_test_[a-f0-9]{12}$/.test(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error("Invitation tests require an explicit disposable loopback MySQL database.");
  vi.stubEnv("DATABASE_URL", value);
  vi.stubEnv("SESSION_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("APP_URL", "http://localhost:3999");
  connection = await mysql.createConnection({ uri: value, timezone: "Z" });
  await connection.query("SET time_zone = '+00:00'");
});

beforeEach(async () => {
  smtp.mockReset().mockResolvedValue(undefined);
  owner = {
    id: randomUUID(),
    email: `integration-${randomUUID()}@example.test`,
    name: "Test owner",
  };
  invited = {
    id: randomUUID(),
    email: `integration-${randomUUID()}@example.test`,
    name: "Test member",
  };
  workspaceId = randomUUID();
  for (const user of [owner, invited]) {
    if (!/^integration-[a-f0-9-]+@example\.test$/.test(user.email))
      throw new Error("Only disposable identities are allowed.");
    await connection.execute("INSERT INTO users (id,email,name) VALUES (?,?,?)", [
      user.id,
      user.email,
      user.name,
    ]);
  }
  await connection.execute("INSERT INTO workspaces (id,name) VALUES (?,?)", [
    workspaceId,
    "Invitation test",
  ]);
  await connection.execute(
    "INSERT INTO workspace_members (workspaceId,userId,role) VALUES (?,?,'owner')",
    [workspaceId, owner.id],
  );
});

afterEach(async () => {
  if (workspaceId) await connection.execute("DELETE FROM workspaces WHERE id=?", [workspaceId]);
  for (const user of [owner, invited].filter(Boolean))
    await connection.execute("DELETE FROM users WHERE id=? AND email=?", [user.id, user.email]);
});

afterAll(async () => {
  await connection?.end();
  const globalDb = globalThis as typeof globalThis & { repereDatabase?: { pool: Pool } };
  await globalDb.repereDatabase?.pool.end();
  delete globalDb.repereDatabase;
  vi.unstubAllEnvs();
});

describe("MySQL invitation delivery and concurrent cancellation", () => {
  it("deletes a newly failed invitation and never makes its unsent token usable", async () => {
    smtp.mockRejectedValueOnce(new Error("Synthetic SMTP outage"));
    await expect(
      inviteWorkspaceMember(workspaceId, owner, invited.email, "en"),
    ).rejects.toMatchObject({ status: 503, code: "EMAIL_DELIVERY_FAILED" });
    const failed = emailToken();
    expect((await invitationRows()).length).toBe(0);
    await expect(getInvitation(failed, null)).rejects.toMatchObject({ status: 404 });
    expect(await memberCount()).toBe(0);
  });

  it("keeps the old delivered token on SMTP failure and rotates it only after a successful resend", async () => {
    await inviteWorkspaceMember(workspaceId, owner, invited.email, "fr");
    const oldToken = emailToken();
    smtp.mockRejectedValueOnce(new Error("Synthetic SMTP outage"));
    await expect(
      inviteWorkspaceMember(workspaceId, owner, invited.email, "fr"),
    ).rejects.toMatchObject({ status: 503 });
    const failedToken = emailToken();
    const [row] = await invitationRows();
    expect(row.tokenHash === tokenHash(oldToken)).toBe(true);
    expect(row.pendingTokenHash).toBeNull();
    expect(row.pendingStartedAt).toBeNull();
    expect((await getInvitation(oldToken, invited)).canAccept).toBe(true);
    await expect(getInvitation(failedToken, null)).rejects.toMatchObject({ status: 404 });
    await inviteWorkspaceMember(workspaceId, owner, invited.email, "fr");
    const newToken = emailToken();
    expect(newToken !== oldToken).toBe(true);
    expect((await getInvitation(newToken, invited)).canAccept).toBe(true);
    await expect(getInvitation(oldToken, null)).rejects.toMatchObject({ status: 404 });
  });

  it("cannot undo cancellation when SMTP succeeds after the owner revoked the invitation", async () => {
    const invitation = await inviteWorkspaceMember(workspaceId, owner, invited.email, "en");
    const oldToken = emailToken();
    const started = deferred();
    const finish = deferred();
    smtp.mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
    });
    const pending = inviteWorkspaceMember(workspaceId, owner, invited.email, "en");
    await started.promise;
    const replacement = emailToken();
    await revokeWorkspaceInvitation(workspaceId, invitation.id, owner);
    finish.resolve();
    await expect(pending).rejects.toMatchObject({ status: 409, code: "INVITATION_CHANGED" });
    const [row] = await invitationRows();
    expect(row.revokedAt).toBeInstanceOf(Date);
    expect(row.pendingTokenHash).toBeNull();
    await expect(getInvitation(oldToken, null)).rejects.toMatchObject({ status: 410 });
    await expect(getInvitation(replacement, null)).rejects.toMatchObject({ status: 404 });
    expect(await memberCount()).toBe(0);
  });

  it("cannot reactivate a resend accepted through the old link, even when the member is removed before SMTP finishes", async () => {
    await inviteWorkspaceMember(workspaceId, owner, invited.email, "en");
    const oldToken = emailToken();
    const started = deferred();
    const finish = deferred();
    smtp.mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
    });
    const pending = inviteWorkspaceMember(workspaceId, owner, invited.email, "en");
    await started.promise;
    const replacement = emailToken();
    const accepted = await acceptInvitation(oldToken, invited);
    expect(accepted).toMatchObject({ id: workspaceId, role: "member" });
    await expect(acceptInvitation(oldToken, invited)).resolves.toEqual(accepted);
    expect(await memberCount()).toBe(1);
    await removeWorkspaceMember(workspaceId, invited.id, owner);
    finish.resolve();
    await expect(pending).rejects.toMatchObject({ status: 409, code: "INVITATION_CHANGED" });
    await expect(getInvitation(replacement, null)).rejects.toMatchObject({ status: 404 });
    await expect(acceptInvitation(oldToken, invited)).rejects.toMatchObject({ status: 410 });
    expect(await memberCount()).toBe(0);
  });
});
