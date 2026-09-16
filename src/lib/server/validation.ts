import { z } from "zod";
import type { Anchor } from "../../../shared/types";
import { anchorSchema, websiteUrlSchema } from "../../../shared/validation";
import { ApiError } from "./errors";
import { captureSchema } from "../../../shared/capture";

export { anchorSchema, websiteUrlSchema } from "../../../shared/validation";

export const emailSchema = z
  .string()
  .trim()
  .email("INVALID_EMAIL")
  .max(254, "INVALID_EMAIL")
  .transform((v) => v.toLowerCase());
export const authRequestSchema = z
  .object({
    email: emailSchema,
    name: z.string().trim().min(1, "NAME_REQUIRED").max(80, "NAME_TOO_LONG").optional(),
  })
  .strict();
export const authVerifySchema = z
  .object({
    email: emailSchema,
    code: z.string().regex(/^\d{6}$/, "OTP_FORMAT"),
  })
  .strict();
export const workspaceIdSchema = z.uuid("WORKSPACE_ID_INVALID");
export const workspaceInvitationSchema = z.object({ email: emailSchema }).strict();
export const workspaceCreateSchema = z
  .object({
    name: z.string().trim().min(1, "WORKSPACE_NAME_REQUIRED").max(80, "WORKSPACE_NAME_TOO_LONG"),
  })
  .strict();
export function requestedWorkspaceId(request: Pick<Request, "url">) {
  const values = new URL(request.url).searchParams.getAll("workspaceId");
  if (values.length > 1) throw new ApiError(400, "WORKSPACE_ID_INVALID");
  return values.length ? workspaceIdSchema.parse(values[0]) : undefined;
}
export const projectFieldsSchema = z.object({
  name: z.string().trim().min(1, "PROJECT_NAME_REQUIRED").max(160, "PROJECT_NAME_TOO_LONG"),
  description: z.string().trim().max(2000, "DESCRIPTION_TOO_LONG").optional(),
});
export const websiteProjectSchema = projectFieldsSchema
  .extend({ type: z.literal("website"), url: websiteUrlSchema })
  .strict();
export const projectUpdateSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "PROJECT_NAME_REQUIRED")
      .max(160, "PROJECT_NAME_TOO_LONG")
      .optional(),
    description: z.string().trim().max(2000, "DESCRIPTION_TOO_LONG").nullable().optional(),
    archived: z.boolean().optional(),
    rotateShareToken: z.literal(true).optional(),
    workspaceId: workspaceIdSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "NO_CHANGES");
export const replySchema = z
  .object({ body: z.string().trim().min(1, "COMMENT_REQUIRED").max(10000, "COMMENT_TOO_LONG") })
  .strict();
export const MAX_COMMENT_BODY_BYTES = 3 * 1024 * 1024;
export const commentSchema = replySchema
  .extend({ anchor: anchorSchema, capture: captureSchema.optional() })
  .strict();
export const statusSchema = z.object({ status: z.enum(["open", "resolved"]) }).strict();

export function assertAnchorMatchesProject(
  anchor: Anchor,
  project: { type: "website" | "pdf"; url: string | null },
) {
  if (project.type !== anchor.type) throw new ApiError(400, "ANCHOR_TYPE_MISMATCH");
  if (anchor.type === "website") {
    let matches = false;
    try {
      matches = !!project.url && new URL(anchor.url).origin === new URL(project.url).origin;
    } catch {
      /* Invalid URLs cannot describe a page belonging to this project. */
    }
    if (!matches) throw new ApiError(400, "ANCHOR_ORIGIN_MISMATCH");
  }
}

export async function boundedBody(
  request: Pick<Request, "headers" | "body">,
  maxBytes: number,
): Promise<Buffer> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > maxBytes))
    throw new ApiError(413, "PAYLOAD_TOO_LARGE");
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new ApiError(413, "PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, length);
}
export async function readJson(request: Request, maxBytes = 64 * 1024) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json")
    throw new ApiError(415, "JSON_REQUIRED");
  try {
    return JSON.parse((await boundedBody(request, maxBytes)).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "JSON_INVALID");
  }
}
