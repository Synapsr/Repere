import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { database } from "@/db";
import { projects } from "@/db/schema";
import type { PreviewSession } from "../../../shared/preview";
import type { User } from "../../../shared/types";
import type { Locale } from "../../../shared/locale";
import { ApiError } from "./errors";
import { projectByToken } from "./projects";
import { rateLimit } from "./rate-limit";
import { appOrigin, secret } from "./security";
import { boundedBody, websiteUrlSchema } from "./validation";

const previewSessionSchema = z
  .object({
    url: websiteUrlSchema,
    origin: websiteUrlSchema,
    targetUrl: websiteUrlSchema,
    channel: z.string().regex(/^[a-f0-9]{32}$/),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();

/** Treat even the internal service response as data; never return an arbitrary iframe origin. */
export function validatePreviewSession(
  input: unknown,
  baseURL: string,
  now = Date.now(),
): PreviewSession {
  const parsed = previewSessionSchema.parse(input);
  const base = new URL(baseURL);
  const preview = new URL(parsed.url);
  const target = new URL(parsed.targetUrl);
  const origin = new URL(parsed.origin);
  const expectedSuffix = `.${base.hostname}`;
  const label = preview.hostname.endsWith(expectedSuffix)
    ? preview.hostname.slice(0, -expectedSuffix.length)
    : "";
  const expiresAt = Date.parse(parsed.expiresAt);

  if (
    !["http:", "https:"].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.pathname !== "/" ||
    base.search ||
    base.hash ||
    !/^[a-f0-9]{48}$/.test(label) ||
    preview.protocol !== base.protocol ||
    preview.port !== base.port ||
    origin.origin !== preview.origin ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    preview.pathname !== target.pathname ||
    preview.search !== target.search ||
    preview.hash !== target.hash ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt > now + 61 * 60 * 1000
  )
    throw new Error("Invalid preview session response.");

  return {
    ...parsed,
    url: preview.toString(),
    origin: preview.origin,
    targetUrl: target.toString(),
  };
}

export async function requestPreviewSession(
  input: {
    url: string;
    projectId: string;
    userId: string;
  },
  locale: Locale = "en",
) {
  const endpoint = new URL(
    "/__repere/sessions",
    process.env.PROXY_INTERNAL_URL || "http://127.0.0.1:3001",
  );
  if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password)
    throw new Error("PROXY_INTERNAL_URL must be an HTTP(S) origin without credentials.");
  const proxySecret = secret("PROXY_SECRET");
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      // Deliberately construct new headers: application cookies and incoming Authorization never leave the app.
      headers: {
        Authorization: `Bearer ${proxySecret}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Accept-Language": locale,
      },
      body: JSON.stringify(input),
    });
  } catch {
    throw new ApiError(503, "PREVIEW_UNAVAILABLE");
  }

  if (!response.ok) {
    await response.body?.cancel();
    if (response.status === 400 || response.status === 422)
      throw new ApiError(400, "PREVIEW_TARGET_UNAVAILABLE");
    if (response.status === 429) throw new ApiError(429, "PREVIEW_LIMIT_REACHED");
    throw new ApiError(503, "PREVIEW_UNAVAILABLE");
  }
  try {
    const data: unknown = JSON.parse((await boundedBody(response, 16 * 1024)).toString("utf8"));
    const session = validatePreviewSession(
      data,
      process.env.PREVIEW_BASE_URL || "http://localhost:3001",
    );
    if (appOrigin().startsWith("https:") && !session.origin.startsWith("https:"))
      throw new Error("HTTPS application requires HTTPS previews.");
    return session;
  } catch {
    throw new ApiError(503, "PREVIEW_RESPONSE_INVALID");
  }
}

export async function createPreviewSession(
  token: string,
  user: User,
  locale: Locale = "en",
): Promise<PreviewSession> {
  const project = await projectByToken(token, user);
  if (project.type !== "website" || !project.url)
    throw new ApiError(400, "WEBSITE_PROJECT_REQUIRED");
  if (project.archived) throw new ApiError(409, "PROJECT_ARCHIVED");
  await rateLimit("preview-session", user.id, 20, 60 * 1000);
  const session = await requestPreviewSession(
    {
      url: project.url,
      projectId: project.id,
      userId: user.id,
    },
    locale,
  );

  // The trusted service validates and pins DNS for every initial redirect. Persist its final URL
  // so later anchors use the canonical origin, then recheck access after the external request.
  await database().transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(projects)
      .where(and(eq(projects.id, project.id), eq(projects.shareToken, token)))
      .for("update");
    if (!current) throw new ApiError(404, "REVIEW_LINK_UNAVAILABLE");
    if (current.archived) throw new ApiError(409, "PROJECT_ARCHIVED");
    if (current.url !== project.url && current.url !== session.targetUrl)
      throw new ApiError(409, "PROJECT_CHANGED");
    if (current.url !== session.targetUrl)
      await tx
        .update(projects)
        .set({ url: session.targetUrl, updatedAt: new Date() })
        .where(eq(projects.id, project.id));
  });
  return session;
}
