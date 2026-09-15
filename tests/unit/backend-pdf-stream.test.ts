import { mkdtemp, open, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_PDF_BYTES, readPdf, storePdf, uploadPath } from "../../src/lib/server/uploads";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "repere-pdf-stream-"));
  vi.stubEnv("UPLOAD_DIR", directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

describe("private PDF streaming", () => {
  it("streams exact stored bytes with the correct content length", async () => {
    const bytes = Buffer.from("%PDF-1.7\nExample document\n%%EOF");
    const key = await storePdf(bytes);
    const result = await readPdf(key);
    expect(result.size).toBe(bytes.length);
    expect(Buffer.from(await new Response(result.body).arrayBuffer())).toEqual(bytes);
  });

  it("bounds chunks for large documents and supports cancelled downloads", async () => {
    const bytes = Buffer.alloc(512 * 1024, "x");
    bytes.write("%PDF-1.7\n");
    const result = await readPdf(await storePdf(bytes));
    const reader = result.body.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(first.value?.byteLength).toBeGreaterThan(0);
    expect(first.value?.byteLength).toBeLessThanOrEqual(64 * 1024);
    await expect(reader.cancel()).resolves.toBeUndefined();
    reader.releaseLock();
  });

  it("rejects absent or oversized stored files before opening a response stream", async () => {
    await expect(readPdf("00000000-0000-0000-0000-000000000000.pdf")).rejects.toMatchObject({
      status: 404,
    });
    const key = await storePdf(Buffer.from("%PDF-1.7\n"));
    const file = await open(uploadPath(key), "r+");
    try {
      await file.truncate(MAX_PDF_BYTES + 1);
    } finally {
      await file.close();
    }
    await expect(readPdf(key)).rejects.toMatchObject({ status: 404 });
  });
});
