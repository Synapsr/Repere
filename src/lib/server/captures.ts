import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import sharp from "sharp";
import {
  CAPTURE_MAX_BYTES,
  CAPTURE_MAX_DATA_URL_LENGTH,
  CAPTURE_MAX_EDGE,
  CAPTURE_MAX_PIXELS,
  captureSchema,
} from "../../../shared/capture";
import type { CaptureInput } from "../../../shared/types";
import { ApiError } from "./errors";

export type PreparedCapture = {
  bytes: Buffer;
  width: number;
  height: number;
  pointX: number;
  pointY: number;
  capturedAt: Date;
};

/** Decode every pixel and re-encode to JPEG; EXIF, profiles and appended data are never retained. */
export async function prepareCapture(input: CaptureInput): Promise<PreparedCapture> {
  if (typeof input.dataUrl === "string" && input.dataUrl.length > CAPTURE_MAX_DATA_URL_LENGTH)
    throw new ApiError(413, "CAPTURE_TOO_LARGE");
  const capture = captureSchema.parse(input);
  const encoded = capture.dataUrl.slice("data:image/jpeg;base64,".length);
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > CAPTURE_MAX_BYTES) throw new ApiError(413, "CAPTURE_TOO_LARGE");
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes[2] !== 0xff ||
    bytes.toString("base64") !== encoded
  )
    throw new ApiError(400, "CAPTURE_INVALID");
  try {
    // metadata reads the header only. Bound its dimensions before allocating decoded pixels.
    const metadata = await sharp(bytes, { limitInputPixels: false, failOn: "warning" }).metadata();
    if (metadata.format !== "jpeg") throw new ApiError(400, "CAPTURE_INVALID");
    const { width, height } = metadata;
    if (
      !width ||
      !height ||
      width > CAPTURE_MAX_EDGE ||
      height > CAPTURE_MAX_EDGE ||
      width * height > CAPTURE_MAX_PIXELS
    )
      throw new ApiError(400, "CAPTURE_DIMENSIONS_INVALID");
    const result = await sharp(bytes, { limitInputPixels: CAPTURE_MAX_PIXELS, failOn: "warning" })
      .autoOrient()
      .jpeg({ quality: 85 })
      .timeout({ seconds: 5 })
      .toBuffer({ resolveWithObject: true });
    if (result.data.length > CAPTURE_MAX_BYTES) throw new ApiError(413, "CAPTURE_TOO_LARGE");
    return {
      bytes: result.data,
      width: result.info.width,
      height: result.info.height,
      pointX: capture.pointX,
      pointY: capture.pointY,
      capturedAt: new Date(capture.capturedAt),
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "CAPTURE_INVALID");
  }
}

function captureDirectory() {
  const uploads = path.resolve(
    /* turbopackIgnore: true */ process.env.UPLOAD_DIR || "./data/uploads",
  );
  return path.join(/* turbopackIgnore: true */ uploads, "captures");
}

export function capturePath(key: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.jpg$/.test(key))
    throw new ApiError(404, "SCREENSHOT_NOT_FOUND");
  return path.join(/* turbopackIgnore: true */ captureDirectory(), key);
}

export async function storeCapture(capture: PreparedCapture) {
  const storageKey = `${randomUUID()}.jpg`;
  await mkdir(/* turbopackIgnore: true */ captureDirectory(), { recursive: true, mode: 0o700 });
  if (!(await lstat(/* turbopackIgnore: true */ captureDirectory())).isDirectory())
    throw new Error("Capture storage is not a directory.");
  await chmod(/* turbopackIgnore: true */ captureDirectory(), 0o700);
  let file: FileHandle | undefined;
  let created = false;
  try {
    file = await open(/* turbopackIgnore: true */ capturePath(storageKey), "wx", 0o600);
    created = true;
    await file.writeFile(capture.bytes);
    await file.close();
    file = undefined;
    return storageKey;
  } catch (error) {
    await file?.close().catch(() => undefined);
    if (created)
      await unlink(/* turbopackIgnore: true */ capturePath(storageKey)).catch(() => undefined);
    throw error;
  }
}

export async function removeCapture(key: string) {
  await unlink(/* turbopackIgnore: true */ capturePath(key)).catch(() => undefined);
}

export async function readCapture(key: string) {
  let file: FileHandle | undefined;
  try {
    file = await open(
      /* turbopackIgnore: true */ capturePath(key),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > CAPTURE_MAX_BYTES)
      throw new ApiError(404, "SCREENSHOT_NOT_FOUND");
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
      throw new ApiError(404, "SCREENSHOT_NOT_FOUND");
    throw error;
  }
}
