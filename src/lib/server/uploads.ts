import { randomUUID } from "node:crypto";
import { mkdir, open, unlink, writeFile, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { ApiError } from "./errors";
import { boundedBody, projectFieldsSchema } from "./validation";

export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export function validPdfSignature(bytes: Uint8Array) {
  return Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
}
// Runtime user uploads live in a mounted volume, never in the Next.js build output.
function uploadDirectory() {
  return path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR || "./data/uploads");
}
export function uploadPath(key: string) {
  if (!/^[0-9a-f-]{36}\.pdf$/.test(key)) throw new ApiError(404, "PDF_NOT_FOUND");
  return path.join(/* turbopackIgnore: true */ uploadDirectory(), key);
}

export async function parsePdfUpload(request: Request) {
  const bytes = await boundedBody(request, MAX_PDF_BYTES + 64 * 1024);
  let form: FormData;
  try {
    // The raw stream has already been size-limited, including requests without Content-Length.
    form = await new Request("http://upload.local", {
      method: "POST",
      headers: { "content-type": request.headers.get("content-type") || "" },
      body: new Uint8Array(bytes),
    }).formData();
  } catch {
    throw new ApiError(400, "UPLOAD_INVALID");
  }
  if (form.getAll("file").length !== 1 || form.get("type") !== "pdf")
    throw new ApiError(400, "PDF_REQUIRED");
  const fields = projectFieldsSchema.parse({
    name: form.get("name"),
    description: form.get("description") || undefined,
  });
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0 || file.size > MAX_PDF_BYTES)
    throw new ApiError(400, "PDF_SIZE_INVALID");
  const fileBytes = Buffer.from(await file.arrayBuffer());
  if (!validPdfSignature(fileBytes) || !file.name.toLowerCase().endsWith(".pdf"))
    throw new ApiError(400, "PDF_INVALID");
  const fileName = file.name.replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 255);
  return { ...fields, fileName, fileSize: file.size, bytes: fileBytes };
}
export async function storePdf(bytes: Buffer) {
  const storageKey = `${randomUUID()}.pdf`;
  await mkdir(/* turbopackIgnore: true */ uploadDirectory(), { recursive: true, mode: 0o700 });
  await writeFile(/* turbopackIgnore: true */ uploadPath(storageKey), bytes, {
    flag: "wx",
    mode: 0o600,
  });
  return storageKey;
}
export async function removePdf(key: string) {
  await unlink(/* turbopackIgnore: true */ uploadPath(key)).catch(() => undefined);
}
export async function readPdf(key: string) {
  let file: FileHandle | undefined;
  try {
    file = await open(/* turbopackIgnore: true */ uploadPath(key), "r");
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size <= 0 || metadata.size > MAX_PDF_BYTES)
      throw new ApiError(404, "PDF_NOT_FOUND");
    // Stream ownership transfers to the response. autoClose also closes the descriptor when
    // Readable.toWeb propagates a cancelled download, without buffering the whole PDF in memory.
    const body = Readable.toWeb(
      file.createReadStream({ autoClose: true, highWaterMark: 64 * 1024 }),
      { strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength } },
    ) as ReadableStream<Uint8Array>;
    return { body, size: metadata.size };
  } catch (error) {
    await file?.close().catch(() => undefined);
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new ApiError(404, "PDF_NOT_FOUND");
    throw error;
  }
}
