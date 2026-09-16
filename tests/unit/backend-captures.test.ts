import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_MAX_BYTES, CAPTURE_MAX_EDGE, captureSchema } from "../../shared/capture";
import type { CaptureInput } from "../../shared/types";
import {
  prepareCapture,
  capturePath,
  readCapture,
  removeCapture,
  storeCapture,
} from "../../src/lib/server/captures";
import { handle } from "../../src/lib/server/errors";
import { MAX_COMMENT_BODY_BYTES, readJson } from "../../src/lib/server/validation";

const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function input(bytes: Buffer, patch: Partial<CaptureInput> = {}): CaptureInput {
  return {
    dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    capturedAt: "2026-09-16T14:30:00+02:00",
    pointX: 0.25,
    pointY: 0.75,
    ...patch,
  };
}

async function jpeg(width = 32, height = 24) {
  return sharp({ create: { width, height, channels: 3, background: "#4060a0" } })
    .jpeg()
    .toBuffer();
}

async function temporaryUploads() {
  const directory = await mkdtemp(path.join(tmpdir(), "repere-capture-test-"));
  directories.push(directory);
  vi.stubEnv("UPLOAD_DIR", directory);
  return directory;
}

describe("server-side screenshot decoding", () => {
  it("fully decodes, auto-orients and strips image metadata before storage", async () => {
    const bytes = await sharp({
      create: { width: 32, height: 24, channels: 3, background: "#4060a0" },
    })
      .jpeg()
      .withMetadata({
        orientation: 6,
        exif: { IFD0: { ImageDescription: "private source metadata" } },
      })
      .toBuffer();
    expect((await sharp(bytes).metadata()).exif).toBeDefined();
    const capture = await prepareCapture(input(bytes));
    expect(capture).toMatchObject({ width: 24, height: 32, pointX: 0.25, pointY: 0.75 });
    expect(capture.capturedAt.toISOString()).toBe("2026-09-16T12:30:00.000Z");
    const metadata = await sharp(capture.bytes).metadata();
    expect(metadata.format).toBe("jpeg");
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(metadata.iptc).toBeUndefined();
    expect(capture.bytes.includes(Buffer.from("private source metadata"))).toBe(false);
  });

  it("rejects a MIME-spoofed PNG, random data and truncated JPEG pixels", async () => {
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#000000" } })
      .png()
      .toBuffer();
    const valid = await jpeg();
    for (const bytes of [
      png,
      Buffer.from("not an image"),
      valid.subarray(0, Math.floor(valid.length / 2)),
    ])
      await expect(prepareCapture(input(bytes))).rejects.toMatchObject({
        status: 400,
        code: "CAPTURE_INVALID",
      });
    await expect(
      prepareCapture(input(valid, { dataUrl: "data:image/jpeg;base64,/9j/AA" })),
    ).rejects.toMatchObject({ status: 400, code: "CAPTURE_INVALID" });
  });

  it("enforces byte, edge and total decoded-pixel limits", async () => {
    await expect(prepareCapture(input(Buffer.alloc(CAPTURE_MAX_BYTES + 1)))).rejects.toMatchObject({
      status: 413,
      code: "CAPTURE_TOO_LARGE",
    });
    for (const bytes of [await jpeg(CAPTURE_MAX_EDGE + 1, 2), await jpeg(3000, 3000)])
      await expect(prepareCapture(input(bytes))).rejects.toMatchObject({
        status: 400,
        code: "CAPTURE_DIMENSIONS_INVALID",
      });
  });

  it("rejects invalid point coordinates and timestamps with stable localized errors", async () => {
    const valid = input(await jpeg());
    for (const patch of [
      { pointX: -0.1 },
      { pointY: 1.1 },
      { pointX: Infinity },
      { capturedAt: "1969-01-01T00:00:00Z" },
      { capturedAt: "9999-12-31T23:00:00-02:00" },
    ]) {
      const response = await handle(new Request("https://app.test"), async () =>
        Response.json(captureSchema.parse({ ...valid, ...patch })),
      );
      expect(response.status).toBe(400);
      expect((await response.json()).code).toBe("CAPTURE_INVALID");
    }
    const tooLarge = input(Buffer.alloc(CAPTURE_MAX_BYTES + 4));
    const response = await handle(new Request("https://app.test"), async () =>
      Response.json(captureSchema.parse(tooLarge)),
    );
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe("CAPTURE_TOO_LARGE");
  });

  it("expands only the explicit comment JSON reader, leaving other API limits intact", async () => {
    const bytes = JSON.stringify({ text: "a".repeat(70 * 1024) });
    const request = () =>
      new Request("https://app.test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bytes,
      });
    await expect(readJson(request())).rejects.toMatchObject({ status: 413 });
    await expect(readJson(request(), MAX_COMMENT_BODY_BYTES)).resolves.toHaveProperty("text");
    await expect(
      readJson(
        new Request("https://app.test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "x".repeat(MAX_COMMENT_BODY_BYTES + 1),
        }),
        MAX_COMMENT_BODY_BYTES,
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
});

describe("private screenshot files", () => {
  it("stores only a UUID JPEG in a private directory and streams exactly its normalized bytes", async () => {
    const directory = await temporaryUploads();
    const capture = await prepareCapture(input(await jpeg()));
    const key = await storeCapture(capture);
    expect(key).toMatch(/^[a-f0-9-]{36}\.jpg$/);
    expect((await stat(path.join(directory, "captures"))).mode & 0o777).toBe(0o700);
    expect((await stat(capturePath(key))).mode & 0o777).toBe(0o600);
    const file = await readCapture(key);
    expect(file.size).toBe(capture.bytes.length);
    expect(Buffer.from(await new Response(file.body).arrayBuffer())).toEqual(capture.bytes);
    expect(await readFile(capturePath(key))).toEqual(capture.bytes);
    await removeCapture(key);
    await expect(readCapture(key)).rejects.toMatchObject({
      status: 404,
      code: "SCREENSHOT_NOT_FOUND",
    });
  });

  it("rejects traversal and symlink files, and permits cleanup after download cancellation", async () => {
    const directory = await temporaryUploads();
    const key = await storeCapture(await prepareCapture(input(await jpeg())));
    for (const bad of ["../../secret.jpg", "/tmp/secret.jpg", `${randomUUID()}.svg`])
      expect(() => capturePath(bad)).toThrow("SCREENSHOT_NOT_FOUND");
    const linked = `${randomUUID()}.jpg`;
    await symlink(capturePath(key), path.join(directory, "captures", linked));
    await expect(readCapture(linked)).rejects.toMatchObject({
      status: 404,
      code: "SCREENSHOT_NOT_FOUND",
    });
    const file = await readCapture(key);
    await file.body.cancel();
    await removeCapture(key);
    expect(
      (await readdir(path.join(directory, "captures"))).filter((entry) => entry !== linked),
    ).toEqual([]);
  });

  it("refuses a symlink capture directory before writing outside the upload volume", async () => {
    const directory = await temporaryUploads();
    const outside = await mkdtemp(path.join(tmpdir(), "repere-capture-outside-"));
    directories.push(outside);
    await mkdir(directory, { recursive: true });
    await symlink(outside, path.join(directory, "captures"));
    await expect(storeCapture(await prepareCapture(input(await jpeg())))).rejects.toThrow(
      "Capture storage is not a directory",
    );
    expect(await readdir(outside)).toEqual([]);
  });
});
