import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { database, type Transaction } from "@/db";
import { projectCovers, projects, workspaceMembers } from "@/db/schema";
import {
  COVER_HEIGHT,
  COVER_MAX_EDGE,
  COVER_MAX_PIXELS,
  COVER_MAX_UPLOAD_BYTES,
  COVER_MIME_TYPES,
  COVER_WIDTH,
  type CoverSource,
  type ProjectCover,
} from "../../../shared/cover";
import type { User } from "../../../shared/types";
import { ApiError } from "./errors";
import { rateLimit } from "./rate-limit";
import { boundedBody } from "./validation";
import { workspaceMembership } from "./workspaces";

type CoverRow = typeof projectCovers.$inferSelect;
type CoverFields = Pick<CoverRow, "automaticStorageKey" | "customStorageKey" | "version">;

export function coverMetadata(row: CoverFields | null | undefined): ProjectCover | null {
  if (!row) return null;
  if (row.customStorageKey) return { source: "custom", version: row.version };
  if (row.automaticStorageKey) return { source: "automatic", version: row.version };
  return null;
}

// Call only after checking membership; share-link guests must never receive cover metadata.
export async function projectCoverMetadata(projectId: string) {
  const [row] = await database()
    .select()
    .from(projectCovers)
    .where(eq(projectCovers.projectId, projectId));
  return coverMetadata(row);
}

export async function parseCoverUpload(request: Request): Promise<{
  source: CoverSource;
  mimeType: string;
  bytes: Buffer;
}> {
  const body = await boundedBody(request, COVER_MAX_UPLOAD_BYTES + 64 * 1024);
  let form: FormData;
  try {
    form = await new Request("http://upload.local", {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") || "" },
      body: new Uint8Array(body),
    }).formData();
  } catch {
    throw new ApiError(400, "COVER_INVALID");
  }
  if (
    form.getAll("file").length !== 1 ||
    form.getAll("source").length !== 1 ||
    [...form.keys()].some((key) => !["file", "source"].includes(key))
  )
    throw new ApiError(400, "COVER_INVALID");
  const source = form.get("source");
  const file = form.get("file");
  if (file instanceof File && file.size > COVER_MAX_UPLOAD_BYTES)
    throw new ApiError(413, "PAYLOAD_TOO_LARGE");
  if (
    (source !== "automatic" && source !== "custom") ||
    !(file instanceof File) ||
    file.size === 0 ||
    !COVER_MIME_TYPES.some((mime) => mime === file.type)
  )
    throw new ApiError(400, "COVER_INVALID");
  return { source, mimeType: file.type, bytes: Buffer.from(await file.arrayBuffer()) };
}

export async function prepareCover(bytes: Buffer, mimeType: string, source: CoverSource) {
  if (bytes.length > COVER_MAX_UPLOAD_BYTES) throw new ApiError(413, "PAYLOAD_TOO_LARGE");
  const formats: Record<string, string> = {
    "image/jpeg": "jpeg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const signatures: Record<string, boolean> = {
    "image/jpeg": bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    "image/png": bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    "image/webp":
      bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP",
  };
  // Reject other image parsers (including SVG) before asking Sharp to inspect any metadata.
  if (!signatures[mimeType]) throw new ApiError(400, "COVER_INVALID");
  try {
    const metadata = await sharp(bytes, { limitInputPixels: false, failOn: "warning" }).metadata();
    if (metadata.format !== formats[mimeType] || (metadata.pages ?? 1) !== 1)
      throw new ApiError(400, "COVER_INVALID");
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > COVER_MAX_EDGE ||
      metadata.height > COVER_MAX_EDGE ||
      metadata.width * metadata.height > COVER_MAX_PIXELS
    )
      throw new ApiError(400, "COVER_DIMENSIONS_INVALID");
    // Re-encoding strips EXIF/ICC and validates pixel data. A site thumbnail keeps its header.
    return await sharp(bytes, { limitInputPixels: COVER_MAX_PIXELS, failOn: "warning" })
      .autoOrient()
      .resize({
        width: COVER_WIDTH,
        height: COVER_HEIGHT,
        fit: "cover",
        position: source === "automatic" ? "north" : "centre",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 85 })
      .timeout({ seconds: 5 })
      .toBuffer();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "COVER_INVALID");
  }
}

function coverDirectory() {
  const uploads = path.resolve(
    /* turbopackIgnore: true */ process.env.UPLOAD_DIR || "./data/uploads",
  );
  return path.join(/* turbopackIgnore: true */ uploads, "covers");
}

export function coverPath(key: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.jpg$/.test(key))
    throw new ApiError(404, "COVER_NOT_FOUND");
  return path.join(/* turbopackIgnore: true */ coverDirectory(), key);
}

export async function storeCover(bytes: Buffer) {
  const key = `${randomUUID()}.jpg`;
  await mkdir(/* turbopackIgnore: true */ coverDirectory(), { recursive: true, mode: 0o700 });
  if (!(await lstat(/* turbopackIgnore: true */ coverDirectory())).isDirectory())
    throw new Error("Cover storage is not a directory.");
  await chmod(/* turbopackIgnore: true */ coverDirectory(), 0o700);
  let file: FileHandle | undefined;
  let created = false;
  try {
    file = await open(/* turbopackIgnore: true */ coverPath(key), "wx", 0o600);
    created = true;
    await file.writeFile(bytes);
    await file.close();
    return key;
  } catch (error) {
    await file?.close().catch(() => undefined);
    if (created) await removeCoverFile(key);
    throw error;
  }
}

export async function removeCoverFile(key: string) {
  await unlink(/* turbopackIgnore: true */ coverPath(key)).catch(() => undefined);
}

export async function readCoverFile(key: string) {
  let file: FileHandle | undefined;
  try {
    file = await open(
      /* turbopackIgnore: true */ coverPath(key),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > COVER_MAX_UPLOAD_BYTES)
      throw new ApiError(404, "COVER_NOT_FOUND");
    const body = Readable.toWeb(
      file.createReadStream({ autoClose: true, highWaterMark: 64 * 1024 }),
      {
        strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength },
      },
    ) as ReadableStream<Uint8Array>;
    return { body, size: metadata.size };
  } catch (error) {
    await file?.close().catch(() => undefined);
    if (["ENOENT", "ELOOP"].includes((error as NodeJS.ErrnoException).code || ""))
      throw new ApiError(404, "COVER_NOT_FOUND");
    throw error;
  }
}

async function lockedCover(tx: Transaction, id: string, user: User) {
  const [project] = await tx.select().from(projects).where(eq(projects.id, id)).for("update");
  if (!project || !(await workspaceMembership(project.workspaceId, user.id, tx, "share")))
    throw new ApiError(404, "PROJECT_NOT_FOUND");
  const [cover] = await tx
    .select()
    .from(projectCovers)
    .where(eq(projectCovers.projectId, id))
    .for("update");
  return { project, cover };
}

export async function getProjectCover(id: string, user: User) {
  const [row] = await database()
    .select({ cover: projectCovers })
    .from(projects)
    .innerJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, projects.workspaceId),
        eq(workspaceMembers.userId, user.id),
      ),
    )
    .leftJoin(projectCovers, eq(projectCovers.projectId, projects.id))
    .where(eq(projects.id, id));
  if (!row) throw new ApiError(404, "PROJECT_NOT_FOUND");
  const key = row.cover?.customStorageKey || row.cover?.automaticStorageKey;
  if (!key) throw new ApiError(404, "COVER_NOT_FOUND");
  return readCoverFile(key);
}

export async function uploadProjectCover(id: string, user: User, request: Request) {
  await rateLimit("project-cover", user.id, 60, 10 * 60 * 1000);
  // Check access before reading a large body; do not hold locks while decoding/writing.
  const initial = await database().transaction((tx) => lockedCover(tx, id, user));
  const input = await parseCoverUpload(request);
  const ignored =
    input.source === "automatic" && (initial.project.archived || !!coverMetadata(initial.cover));
  let key: string | undefined;
  let result: { cover: ProjectCover | null; retained: boolean; obsolete: string | null };
  try {
    if (!ignored)
      key = await storeCover(await prepareCover(input.bytes, input.mimeType, input.source));
    result = await database().transaction(async (tx) => {
      const { project, cover } = await lockedCover(tx, id, user);
      if (input.source === "automatic" && (ignored || project.archived || !!coverMetadata(cover)))
        return { cover: coverMetadata(cover), retained: false, obsolete: null };
      if (!key) throw new Error("Prepared cover is missing.");
      const version = randomUUID();
      const automaticStorageKey =
        input.source === "automatic" ? key : (cover?.automaticStorageKey ?? null);
      const customStorageKey = input.source === "custom" ? key : null;
      const values = { projectId: id, automaticStorageKey, customStorageKey, version };
      await tx
        .insert(projectCovers)
        .values(values)
        .onDuplicateKeyUpdate({ set: { automaticStorageKey, customStorageKey, version } });
      return {
        cover: coverMetadata(values),
        retained: true,
        obsolete: input.source === "custom" ? (cover?.customStorageKey ?? null) : null,
      };
    });
  } catch (error) {
    if (key) await removeCoverFile(key);
    throw error;
  }
  // Commit succeeded. Cleanup must never delete the new file or the retained automatic image.
  if (!result.retained && key) await removeCoverFile(key);
  if (result.obsolete) await removeCoverFile(result.obsolete);
  return result.cover;
}

export async function deleteProjectCover(id: string, user: User) {
  await rateLimit("project-cover", user.id, 60, 10 * 60 * 1000);
  const result = await database().transaction(async (tx) => {
    const { cover } = await lockedCover(tx, id, user);
    if (!cover?.customStorageKey) return { cover: coverMetadata(cover), obsolete: null };
    const version = randomUUID();
    await tx
      .update(projectCovers)
      .set({ customStorageKey: null, version })
      .where(eq(projectCovers.projectId, id));
    return {
      cover: coverMetadata({ ...cover, customStorageKey: null, version }),
      obsolete: cover.customStorageKey,
    };
  });
  if (result.obsolete) await removeCoverFile(result.obsolete);
  return result.cover;
}
