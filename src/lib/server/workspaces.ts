import { randomUUID } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import { database, type Transaction } from "@/db";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import type { User, Workspace } from "../../../shared/types";
import { ApiError } from "./errors";
import { ownerEmailAllowed } from "./security";
import { rateLimit } from "./rate-limit";

type Reader = Pick<Transaction, "select">;

export async function workspaceMembership(
  workspaceId: string,
  userId: string,
  db: Reader = database(),
) {
  const [member] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return member ?? null;
}

export async function requireWorkspaceMembership(
  workspaceId: string,
  userId: string,
  db: Reader = database(),
) {
  const membership = await workspaceMembership(workspaceId, userId, db);
  if (!membership) throw new ApiError(404, "WORKSPACE_NOT_FOUND");
  return membership;
}

export function defaultWorkspaceName(user: Pick<User, "name" | "email">) {
  return (user.name.trim() || user.email.split("@")[0].trim() || "Workspace").slice(0, 80);
}

async function lockUser(tx: Transaction, userId: string) {
  const [user] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  if (!user) throw new ApiError(401, "AUTH_REQUIRED");
}

async function insertWorkspace(tx: Transaction, userId: string, name: string): Promise<Workspace> {
  const id = randomUUID();
  const [latest] = await tx
    .select({ createdAt: workspaces.createdAt })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(desc(workspaces.createdAt))
    .limit(1);
  // The caller holds this user's lock. Explicit, increasing millisecond dates keep
  // the first workspace stable across rapid requests and app instances.
  const createdAt = new Date(Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1));
  await tx.insert(workspaces).values({ id, name, createdAt, updatedAt: createdAt });
  await tx.insert(workspaceMembers).values({ workspaceId: id, userId, role: "owner", createdAt });
  return { id, name, role: "owner" };
}

/** The user's row serializes first-space bootstrap and explicit creation across app instances. */
export async function listWorkspaces(user: User): Promise<Workspace[]> {
  return database().transaction(async (tx) => {
    await lockUser(tx, user.id);
    const rows = await tx
      .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, user.id))
      .orderBy(asc(workspaces.createdAt), asc(workspaces.id));
    return rows.length ? rows : [await insertWorkspace(tx, user.id, defaultWorkspaceName(user))];
  });
}

export async function resolveWorkspace(user: User, requestedId?: string): Promise<string> {
  if (requestedId !== undefined) {
    await requireWorkspaceMembership(requestedId, user.id);
    return requestedId;
  }
  return (await listWorkspaces(user))[0].id;
}

export async function createWorkspace(user: User, name: string): Promise<Workspace> {
  if (!ownerEmailAllowed(user.email)) throw new ApiError(403, "WORKSPACE_CREATE_FORBIDDEN");
  await rateLimit("workspace-create", user.id, 20, 60 * 60 * 1000);
  return database().transaction(async (tx) => {
    await lockUser(tx, user.id);
    return insertWorkspace(tx, user.id, name);
  });
}
