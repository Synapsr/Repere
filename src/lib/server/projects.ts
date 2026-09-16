import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { database, type Transaction } from "@/db";
import { commentScreenshots, comments, projects, replies, users } from "@/db/schema";
import type { Anchor, CaptureInput, Feedback, Project, Reply, User } from "../../../shared/types";
import type { Locale } from "../../../shared/locale";
import { feedbackPrompt } from "../feedback-prompt";
import { ApiError } from "./errors";
import { appOrigin, ownerEmailAllowed, randomToken } from "./security";
import { parsePdfUpload, removePdf, storePdf } from "./uploads";
import { assertAnchorMatchesProject, websiteProjectSchema, readJson } from "./validation";
import { rateLimit } from "./rate-limit";
import { requireWorkspaceMembership, resolveWorkspace, workspaceMembership } from "./workspaces";
import { prepareCapture, readCapture, removeCapture, storeCapture } from "./captures";

type ProjectRow = typeof projects.$inferSelect;
export function publicProject(row: ProjectRow): Project {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    url: row.url,
    fileName: row.fileName,
    shareToken: row.shareToken,
    workspaceId: row.workspaceId,
    archived: row.archived,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    commentCount: row.commentCount,
    resolvedCount: row.resolvedCount,
  };
}

function assertToken(token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(404, "PROJECT_NOT_FOUND");
}
export async function projectByToken(token: string, user: User | null) {
  assertToken(token);
  const [project] = await database()
    .select()
    .from(projects)
    .where(eq(projects.shareToken, token))
    .limit(1);
  if (!project) throw new ApiError(404, "REVIEW_LINK_UNAVAILABLE");
  if (project.archived && !(await canManageProject(project, user)))
    throw new ApiError(410, "PROJECT_ARCHIVED");
  return project;
}

export async function canManageProject(
  project: Pick<ProjectRow, "workspaceId">,
  user: User | null,
) {
  return !!user && !!(await workspaceMembership(project.workspaceId, user.id));
}

/** Lock project before child rows everywhere, serializing counters and avoiding lock-order deadlocks. */
async function writableProject(tx: Transaction, token: string) {
  assertToken(token);
  const [project] = await tx
    .select()
    .from(projects)
    .where(eq(projects.shareToken, token))
    .for("update");
  if (!project) throw new ApiError(404, "REVIEW_LINK_UNAVAILABLE");
  if (project.archived) throw new ApiError(409, "PROJECT_READ_ONLY");
  return project;
}

export async function listProjects(user: User, requestedWorkspaceId?: string) {
  const workspaceId = await resolveWorkspace(user, requestedWorkspaceId);
  const rows = await database()
    .select()
    .from(projects)
    .where(eq(projects.workspaceId, workspaceId))
    .orderBy(desc(projects.updatedAt));
  return rows.map(publicProject);
}

export async function createProject(request: Request, user: User, requestedWorkspaceId?: string) {
  if (!ownerEmailAllowed(user.email)) throw new ApiError(403, "OWNER_EMAIL_NOT_ALLOWED");
  await rateLimit("project-create", user.id, 30, 60 * 60 * 1000);
  const workspaceId = await resolveWorkspace(user, requestedWorkspaceId);
  const common = { id: randomUUID(), workspaceId, createdBy: user.id, shareToken: randomToken() };
  const insert = (values: typeof projects.$inferInsert) =>
    database().transaction(async (tx) => {
      // Upload parsing/storage happens first. A member removed meanwhile cannot create a project.
      // The shared lock also serializes commit with member removal's exclusive lock.
      await requireWorkspaceMembership(workspaceId, user.id, tx, "share");
      await tx.insert(projects).values(values);
    });
  let storageKey: string | undefined;
  try {
    if (request.headers.get("content-type")?.startsWith("multipart/form-data")) {
      const input = await parsePdfUpload(request);
      storageKey = await storePdf(input.bytes);
      await insert({
        ...common,
        type: "pdf",
        name: input.name,
        description: input.description || null,
        storageKey,
        fileName: input.fileName,
        fileSize: input.fileSize,
      });
    } else {
      const input = websiteProjectSchema.parse(await readJson(request));
      // Local Docker demo URLs must resolve from the isolated preview service container.
      const source = new URL(input.url);
      if (
        process.env.DEMO_SITE_URL &&
        source.origin === appOrigin() &&
        (source.pathname === "/demo-site" || source.pathname.startsWith("/demo-site/"))
      ) {
        const destination = new URL(process.env.DEMO_SITE_URL);
        destination.pathname =
          destination.pathname.replace(/\/$/, "") + source.pathname.slice("/demo-site".length);
        destination.search = source.search;
        destination.hash = source.hash;
        input.url = websiteProjectSchema.shape.url.parse(destination.toString());
      }
      await insert({ ...common, ...input, description: input.description || null });
    }
  } catch (error) {
    if (storageKey) await removePdf(storageKey);
    throw error;
  }
  const [project] = await database().select().from(projects).where(eq(projects.id, common.id));
  return publicProject(project);
}

export async function updateProject(
  id: string,
  user: User,
  input: {
    name?: string;
    description?: string | null;
    archived?: boolean;
    rotateShareToken?: true;
    workspaceId?: string;
  },
) {
  const project = await database().transaction(async (tx) => {
    const [row] = await tx.select().from(projects).where(eq(projects.id, id)).for("update");
    if (!row) throw new ApiError(404, "PROJECT_NOT_FOUND");
    if (!(await workspaceMembership(row.workspaceId, user.id, tx, "share")))
      throw new ApiError(404, "PROJECT_NOT_FOUND");
    if (input.workspaceId !== undefined)
      await requireWorkspaceMembership(input.workspaceId, user.id, tx, "share");
    const { rotateShareToken, ...changes } = input;
    const patch = {
      ...changes,
      ...(rotateShareToken ? { shareToken: randomToken() } : {}),
      updatedAt: new Date(),
    };
    await tx.update(projects).set(patch).where(eq(projects.id, id));
    return { ...row, ...patch };
  });
  return publicProject(project);
}

const authorFields = { id: users.id, email: users.email, name: users.name };
export async function projectComments(
  projectId: string,
  commentId?: string,
  options: { reader?: Pick<Transaction, "select">; onlyOpen?: boolean } = {},
): Promise<Feedback[]> {
  const reader = options.reader ?? database();
  const rows = await reader
    .select({
      comment: comments,
      author: authorFields,
      screenshot: {
        width: commentScreenshots.width,
        height: commentScreenshots.height,
        pointX: commentScreenshots.pointX,
        pointY: commentScreenshots.pointY,
        capturedAt: commentScreenshots.capturedAt,
      },
    })
    .from(comments)
    .innerJoin(users, eq(comments.authorId, users.id))
    .leftJoin(commentScreenshots, eq(commentScreenshots.commentId, comments.id))
    .where(
      and(
        eq(comments.projectId, projectId),
        commentId ? eq(comments.id, commentId) : undefined,
        options.onlyOpen ? eq(comments.status, "open") : undefined,
      ),
    )
    .orderBy(asc(comments.number));
  if (rows.length === 0) return [];
  const responseRows = await reader
    .select({ reply: replies, author: authorFields })
    .from(replies)
    .innerJoin(users, eq(replies.authorId, users.id))
    .where(
      inArray(
        replies.commentId,
        rows.map((row) => row.comment.id),
      ),
    )
    .orderBy(asc(replies.createdAt));
  const grouped = new Map<string, Reply[]>();
  for (const { reply, author } of responseRows) {
    const group = grouped.get(reply.commentId) ?? [];
    group.push({
      id: reply.id,
      body: reply.body,
      author,
      createdAt: reply.createdAt.toISOString(),
    });
    grouped.set(reply.commentId, group);
  }
  return rows.map(({ comment, author, screenshot }) => ({
    id: comment.id,
    number: comment.number,
    projectId: comment.projectId,
    body: comment.body,
    status: comment.status,
    kind: comment.kind,
    anchor: comment.anchor,
    screenshot: screenshot
      ? { ...screenshot, capturedAt: screenshot.capturedAt.toISOString() }
      : null,
    author,
    replies: grouped.get(comment.id) ?? [],
    createdAt: comment.createdAt.toISOString(),
    updatedAt: comment.updatedAt.toISOString(),
  }));
}

/** Export follows workspace management rights, never review-link guest access. */
export async function getProjectPrompt(id: string, user: User, locale: Locale, commentId?: string) {
  return database().transaction(async (tx) => {
    // Keep the project and membership stable while reading feedback. Project moves
    // and member removal cannot switch the authorization scope halfway through.
    const [project] = await tx.select().from(projects).where(eq(projects.id, id)).for("share");
    if (!project || !(await workspaceMembership(project.workspaceId, user.id, tx, "share")))
      throw new ApiError(404, "PROJECT_NOT_FOUND");
    const feedback = await projectComments(id, commentId, { reader: tx, onlyOpen: !commentId });
    if (commentId && !feedback.length) throw new ApiError(404, "COMMENT_NOT_FOUND");
    if (!feedback.length || feedback.some((comment) => comment.status !== "open"))
      throw new ApiError(409, "PROMPT_EMPTY");
    return {
      prompt: feedbackPrompt(publicProject(project), feedback, locale),
      count: feedback.length,
    };
  });
}

export async function createComment(
  token: string,
  user: User,
  input: { body: string; anchor: Anchor; capture?: CaptureInput },
) {
  await rateLimit("comment-create", user.id, 60, 60 * 1000);
  const id = randomUUID();
  let storageKey: string | undefined;
  let projectId: string;
  try {
    if (input.capture) {
      // Refuse an invalid/revoked/read-only link before doing image work; release the lock
      // before decoding so no project transaction waits on image processing or filesystem I/O.
      await database().transaction(async (tx) =>
        assertAnchorMatchesProject(input.anchor, await writableProject(tx, token)),
      );
    }
    const capture = input.capture ? await prepareCapture(input.capture) : undefined;
    if (capture) storageKey = await storeCapture(capture);
    projectId = await database().transaction(async (tx) => {
      const project = await writableProject(tx, token);
      assertAnchorMatchesProject(input.anchor, project);
      await tx.insert(comments).values({
        id,
        projectId: project.id,
        authorId: user.id,
        number: project.nextCommentNumber,
        body: input.body,
        anchor: input.anchor,
        kind: "text",
      });
      if (capture && storageKey)
        await tx.insert(commentScreenshots).values({
          commentId: id,
          storageKey,
          byteSize: capture.bytes.length,
          width: capture.width,
          height: capture.height,
          pointX: capture.pointX,
          pointY: capture.pointY,
          capturedAt: capture.capturedAt,
        });
      await tx
        .update(projects)
        .set({
          nextCommentNumber: project.nextCommentNumber + 1,
          commentCount: project.commentCount + 1,
          updatedAt: new Date(),
        })
        .where(eq(projects.id, project.id));
      return project.id;
    });
  } catch (error) {
    if (storageKey) await removeCapture(storageKey);
    throw error;
  }
  return (await projectComments(projectId, id))[0];
}

export async function getCommentScreenshot(token: string, commentId: string, user: User) {
  const project = await projectByToken(token, user);
  const [capture] = await database()
    .select({ storageKey: commentScreenshots.storageKey })
    .from(commentScreenshots)
    .innerJoin(comments, eq(comments.id, commentScreenshots.commentId))
    .where(and(eq(comments.id, commentId), eq(comments.projectId, project.id)))
    .limit(1);
  if (!capture) throw new ApiError(404, "SCREENSHOT_NOT_FOUND");
  return readCapture(capture.storageKey);
}

export async function updateComment(
  token: string,
  id: string,
  user: User,
  status: "open" | "resolved",
) {
  await rateLimit("comment-update", user.id, 120, 60 * 1000);
  const projectId = await database().transaction(async (tx) => {
    const project = await writableProject(tx, token);
    const [comment] = await tx
      .select()
      .from(comments)
      .where(and(eq(comments.id, id), eq(comments.projectId, project.id)))
      .for("update");
    if (!comment) throw new ApiError(404, "COMMENT_NOT_FOUND");
    if (
      comment.authorId !== user.id &&
      !(await workspaceMembership(project.workspaceId, user.id, tx, "share"))
    )
      throw new ApiError(403, "COMMENT_STATUS_FORBIDDEN");
    if (comment.status !== status) {
      await tx.update(comments).set({ status, updatedAt: new Date() }).where(eq(comments.id, id));
      await tx
        .update(projects)
        .set({
          resolvedCount: project.resolvedCount + (status === "resolved" ? 1 : -1),
          updatedAt: new Date(),
        })
        .where(eq(projects.id, project.id));
    }
    return project.id;
  });
  return (await projectComments(projectId, id))[0];
}

export async function createReply(
  token: string,
  commentId: string,
  user: User,
  body: string,
): Promise<Reply> {
  await rateLimit("reply-create", user.id, 60, 60 * 1000);
  const id = randomUUID();
  const createdAt = new Date();
  await database().transaction(async (tx) => {
    const project = await writableProject(tx, token);
    const [comment] = await tx
      .select({ id: comments.id })
      .from(comments)
      .where(and(eq(comments.id, commentId), eq(comments.projectId, project.id)));
    if (!comment) throw new ApiError(404, "COMMENT_NOT_FOUND");
    await tx.insert(replies).values({ id, commentId, authorId: user.id, body, createdAt });
    await tx.update(comments).set({ updatedAt: createdAt }).where(eq(comments.id, commentId));
    await tx.update(projects).set({ updatedAt: createdAt }).where(eq(projects.id, project.id));
  });
  return { id, body, author: user, createdAt: createdAt.toISOString() };
}
