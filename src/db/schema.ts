import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import type { Anchor } from "../../shared/types";

const id = () => varchar({ length: 36 });
const createdAt = () => timestamp({ mode: "date", fsp: 3 }).defaultNow().notNull();
// Services explicitly write updatedAt inside their mutation transaction. Drizzle's onUpdateNow()
// currently emits CURRENT_TIMESTAMP without matching fractional precision, rejected by MySQL 8.4.
const updatedAt = () => timestamp({ mode: "date", fsp: 3 }).defaultNow().notNull();

export const users = mysqlTable(
  "users",
  {
    id: id().primaryKey(),
    email: varchar({ length: 254 }).notNull(),
    name: varchar({ length: 80 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const otpChallenges = mysqlTable(
  "otp_challenges",
  {
    email: varchar({ length: 254 }).primaryKey(),
    codeHash: varchar({ length: 64 }).notNull(),
    name: varchar({ length: 80 }),
    attempts: int({ unsigned: true }).default(0).notNull(),
    expiresAt: timestamp({ mode: "date", fsp: 3 }).notNull(),
    consumedAt: timestamp({ mode: "date", fsp: 3 }),
    createdAt: createdAt(),
  },
  (t) => [index("otp_expiry_idx").on(t.expiresAt)],
);

export const sessions = mysqlTable(
  "sessions",
  {
    tokenHash: varchar({ length: 64 }).primaryKey(),
    userId: id()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp({ mode: "date", fsp: 3 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expiry_idx").on(t.expiresAt)],
);

export const rateLimits = mysqlTable(
  "rate_limits",
  {
    key: varchar({ length: 64 }).primaryKey(),
    count: int({ unsigned: true }).notNull().default(0),
    expiresAt: timestamp({ mode: "date", fsp: 3 }).notNull(),
  },
  (t) => [index("rate_limits_expiry_idx").on(t.expiresAt)],
);

export const workspaces = mysqlTable("workspaces", {
  id: id().primaryKey(),
  name: varchar({ length: 80 }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workspaceMembers = mysqlTable(
  "workspace_members",
  {
    workspaceId: id()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: id()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: mysqlEnum(["owner", "member"]).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("workspace_members_user_idx").on(t.userId),
  ],
);

export const workspaceInvitations = mysqlTable(
  "workspace_invitations",
  {
    id: id().primaryKey(),
    workspaceId: id()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: varchar({ length: 254 }).notNull(),
    inviterId: id().references(() => users.id, { onDelete: "set null" }),
    tokenHash: varchar({ length: 64 }),
    // A resend cannot replace the working link until SMTP has accepted its replacement.
    pendingTokenHash: varchar({ length: 64 }),
    pendingStartedAt: timestamp({ mode: "date", fsp: 3 }),
    expiresAt: timestamp({ mode: "date", fsp: 3 }).notNull(),
    acceptedAt: timestamp({ mode: "date", fsp: 3 }),
    revokedAt: timestamp({ mode: "date", fsp: 3 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("workspace_invitations_workspace_email_unique").on(t.workspaceId, t.email),
    uniqueIndex("workspace_invitations_token_unique").on(t.tokenHash),
    uniqueIndex("workspace_invitations_pending_token_unique").on(t.pendingTokenHash),
    index("workspace_invitations_expiry_idx").on(t.expiresAt),
  ],
);

export const projects = mysqlTable(
  "projects",
  {
    id: id().primaryKey(),
    workspaceId: id()
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // Audit only: permissions always come from workspace membership.
    createdBy: id().references(() => users.id, { onDelete: "set null" }),
    name: varchar({ length: 160 }).notNull(),
    description: text(),
    type: mysqlEnum(["website", "pdf"]).notNull(),
    url: text(),
    fileName: varchar({ length: 255 }),
    storageKey: varchar({ length: 80 }),
    fileSize: int({ unsigned: true }),
    shareToken: varchar({ length: 64 }).notNull(),
    archived: boolean().default(false).notNull(),
    nextCommentNumber: int({ unsigned: true }).default(1).notNull(),
    commentCount: int({ unsigned: true }).default(0).notNull(),
    resolvedCount: int({ unsigned: true }).default(0).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("projects_share_token_unique").on(t.shareToken),
    index("projects_workspace_idx").on(t.workspaceId),
  ],
);

export const comments = mysqlTable(
  "comments",
  {
    id: id().primaryKey(),
    projectId: id()
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    authorId: id()
      .notNull()
      .references(() => users.id),
    number: int({ unsigned: true }).notNull(),
    body: text().notNull(),
    status: mysqlEnum(["open", "resolved"]).default("open").notNull(),
    kind: mysqlEnum(["text", "audio", "text-suggestion"]).default("text").notNull(),
    anchor: json().$type<Anchor>().notNull(),
    originalText: text(),
    suggestedText: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("comments_project_number_unique").on(t.projectId, t.number),
    index("comments_author_idx").on(t.authorId),
  ],
);

export const replies = mysqlTable(
  "replies",
  {
    id: id().primaryKey(),
    commentId: id()
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    authorId: id()
      .notNull()
      .references(() => users.id),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("replies_comment_idx").on(t.commentId)],
);

// Reserved for future audio / transcription support; v1 exposes no attachment upload endpoint.
export const attachments = mysqlTable(
  "attachments",
  {
    id: id().primaryKey(),
    commentId: id()
      .notNull()
      .references(() => comments.id, { onDelete: "cascade" }),
    storageKey: varchar({ length: 255 }).notNull(),
    mimeType: varchar({ length: 100 }).notNull(),
    fileName: varchar({ length: 255 }).notNull(),
    byteSize: int({ unsigned: true }).notNull(),
    durationMs: int({ unsigned: true }),
    transcription: text(),
    transcriptionStatus: mysqlEnum(["pending", "processing", "completed", "failed"]),
    transcriptionProvider: varchar({ length: 80 }),
    createdAt: createdAt(),
  },
  (t) => [index("attachments_comment_idx").on(t.commentId)],
);
