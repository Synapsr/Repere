import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectCovers, projects } from "../../src/db/schema";
import {
  coverMetadata,
  coverPath,
  deleteProjectCover,
  parseCoverUpload,
  prepareCover,
  readCoverFile,
  storeCover,
  uploadProjectCover,
} from "../../src/lib/server/covers";
import { COVER_MAX_EDGE, COVER_MAX_UPLOAD_BYTES, type CoverSource } from "../../shared/cover";

const mocks = vi.hoisted(() => ({ transaction: vi.fn(), membership: vi.fn() }));
vi.mock("@/db", () => ({ database: () => ({ transaction: mocks.transaction }) }));
vi.mock("../../src/lib/server/rate-limit", () => ({ rateLimit: vi.fn() }));
vi.mock("../../src/lib/server/workspaces", () => ({ workspaceMembership: mocks.membership }));

type Row = typeof projectCovers.$inferSelect;
const user = { id: randomUUID(), email: "cover@example.test", name: "Cover test" };
let directory: string;
let project: { id: string; workspaceId: string; archived: boolean };
let row: Row | undefined;
let failCommit: boolean;
let beforeCommit: (() => void) | undefined;

beforeEach(async () => {
  vi.resetAllMocks();
  directory = await mkdtemp(path.join(tmpdir(), "repere-cover-test-"));
  vi.stubEnv("UPLOAD_DIR", directory);
  project = { id: randomUUID(), workspaceId: randomUUID(), archived: false };
  row = undefined;
  failCommit = false;
  beforeCommit = undefined;
  mocks.membership.mockResolvedValue({ role: "member" });
  let count = 0;
  mocks.transaction.mockImplementation(async (callback) => {
    count++;
    if (count === 2) beforeCommit?.();
    let staged = row ? { ...row } : undefined;
    const result = await callback({
      select: () => ({
        from: (table: unknown) => ({
          where: () => ({
            for: async () => (table === projects ? [project] : staged ? [staged] : []),
          }),
        }),
      }),
      insert: () => ({
        values: (value: Row) => ({
          onDuplicateKeyUpdate: async () => {
            staged = value;
          },
        }),
      }),
      update: () => ({
        set: (patch: Partial<Row>) => ({
          where: async () => {
            staged = { ...staged!, ...patch };
          },
        }),
      }),
    });
    if (failCommit && count === 2) throw new Error("Simulated commit failure");
    row = staged;
    return result;
  });
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

async function png(width = 40, height = 25) {
  return sharp({ create: { width, height, channels: 3, background: "#4060a0" } })
    .png()
    .toBuffer();
}
function request(bytes: Buffer, source: string = "custom", mime = "image/png") {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(bytes)], "cover.bin", { type: mime }));
  form.append("source", source);
  return new Request("http://app.test/api/projects/id/cover", { method: "POST", body: form });
}
async function files() {
  return readdir(path.join(directory, "covers")).catch(() => []);
}

describe("cover image validation and private files", () => {
  it("accepts JPEG/PNG/WebP only and re-encodes without private metadata", async () => {
    for (const format of ["jpeg", "png", "webp"] as const) {
      const bytes = await sharp(await png())
        .toFormat(format)
        .withMetadata({ exif: { IFD0: { ImageDescription: "private metadata" } } })
        .toBuffer();
      const result = await prepareCover(bytes, `image/${format}`, "custom");
      const metadata = await sharp(result).metadata();
      expect(metadata.format).toBe("jpeg");
      for (const field of ["exif", "icc", "xmp", "iptc"] as const)
        expect(metadata[field]).toBeUndefined();
      expect(result.includes(Buffer.from("private metadata"))).toBe(false);
    }
    for (const [bytes, mime] of [
      [await png(), "image/jpeg"],
      [Buffer.from("invalid"), "image/png"],
      [Buffer.from("<svg/>"), "image/svg+xml"],
      [
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'),
        "image/png",
      ],
      [
        await sharp(await png())
          .tiff()
          .toBuffer(),
        "image/webp",
      ],
    ] as const)
      await expect(prepareCover(bytes, mime, "custom")).rejects.toMatchObject({
        status: 400,
        code: "COVER_INVALID",
      });
  });

  it("crops automatic covers from the top and custom covers from the center", async () => {
    const red = await sharp({
      create: { width: 1200, height: 750, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    const tall = await sharp({
      create: { width: 1200, height: 1500, channels: 3, background: "blue" },
    })
      .composite([{ input: red, top: 0, left: 0 }])
      .png()
      .toBuffer();
    for (const source of ["automatic", "custom"] as const) {
      const result = await prepareCover(tall, "image/png", source);
      const { data, info } = await sharp(result).raw().toBuffer({ resolveWithObject: true });
      expect(info).toMatchObject({ width: 1200, height: 750 });
      const offset = (700 * info.width + 600) * info.channels;
      expect(data[offset + (source === "automatic" ? 0 : 2)]).toBeGreaterThan(240);
    }
  });

  it("bounds decoded pixels, side lengths and the full multipart body", async () => {
    for (const bytes of [await png(COVER_MAX_EDGE + 1, 1), await png(5100, 5000)])
      await expect(prepareCover(bytes, "image/png", "custom")).rejects.toMatchObject({
        status: 400,
        code: "COVER_DIMENSIONS_INVALID",
      });
    await expect(
      parseCoverUpload(request(Buffer.alloc(COVER_MAX_UPLOAD_BYTES + 1))),
    ).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });
    expect(
      (await parseCoverUpload(request(Buffer.alloc(COVER_MAX_UPLOAD_BYTES)))).bytes.length,
    ).toBe(COVER_MAX_UPLOAD_BYTES);
    await expect(parseCoverUpload(request(await png(), "unknown"))).rejects.toMatchObject({
      status: 400,
      code: "COVER_INVALID",
    });
    const duplicate = new FormData();
    duplicate.append(
      "file",
      new File([new Uint8Array(await png())], "image.png", { type: "image/png" }),
    );
    duplicate.append("source", "custom");
    duplicate.append("source", "automatic");
    await expect(
      parseCoverUpload(new Request("http://app.test", { method: "POST", body: duplicate })),
    ).rejects.toMatchObject({ status: 400, code: "COVER_INVALID" });
    expect((await parseCoverUpload(request(await png(), "automatic"))).source).toBe("automatic");
  });

  it("stores a UUID JPEG privately and refuses traversal and symlink reads", async () => {
    const bytes = await prepareCover(await png(), "image/png", "custom");
    const key = await storeCover(bytes);
    expect((await stat(path.join(directory, "covers"))).mode & 0o777).toBe(0o700);
    expect((await stat(coverPath(key))).mode & 0o777).toBe(0o600);
    const read = await readCoverFile(key);
    expect(Buffer.from(await new Response(read.body).arrayBuffer())).toEqual(bytes);
    expect(() => coverPath("../../secret.jpg")).toThrow("COVER_NOT_FOUND");
    const link = `${randomUUID()}.jpg`;
    await symlink(coverPath(key), coverPath(link));
    await expect(readCoverFile(link)).rejects.toMatchObject({
      status: 404,
      code: "COVER_NOT_FOUND",
    });
  });

  it("exposes only source and version, preferring a custom image over the retained automatic one", () => {
    const value = {
      version: randomUUID(),
      automaticStorageKey: "private-auto",
      customStorageKey: "private-custom",
    };
    expect(coverMetadata(value)).toEqual({ source: "custom", version: value.version });
    expect(coverMetadata({ ...value, customStorageKey: null })).toEqual({
      source: "automatic",
      version: value.version,
    });
    expect(
      coverMetadata({ ...value, customStorageKey: null, automaticStorageKey: null }),
    ).toBeNull();
  });
});

describe("cover transaction and file lifetime", () => {
  async function seed(source: CoverSource) {
    const key = await storeCover(await prepareCover(await png(), "image/png", source));
    row = {
      projectId: project.id,
      automaticStorageKey: source === "automatic" ? key : null,
      customStorageKey: source === "custom" ? key : null,
      version: randomUUID(),
    };
    return key;
  }

  it("keeps the automatic image through custom replacements and restores it on delete", async () => {
    const automatic = await seed("automatic");
    const first = await uploadProjectCover(project.id, user, request(await png()));
    expect(first?.source).toBe("custom");
    const oldCustom = row!.customStorageKey!;
    const second = await uploadProjectCover(project.id, user, request(await png()));
    expect(second?.version).not.toBe(first?.version);
    expect(await files()).toEqual(expect.arrayContaining([automatic, row!.customStorageKey]));
    expect(await files()).not.toContain(oldCustom);
    const restored = await deleteProjectCover(project.id, user);
    expect(restored?.source).toBe("automatic");
    expect(restored?.version).not.toBe(second?.version);
    expect(await files()).toEqual([automatic]);
    expect(mocks.membership).toHaveBeenCalledWith(
      project.workspaceId,
      user.id,
      expect.anything(),
      "share",
    );
  });

  it.each(["automatic", "custom"] as const)(
    "never replaces an existing %s cover with an automatic request",
    async (source) => {
      const key = await seed(source);
      const initial = coverMetadata(row);
      expect(await uploadProjectCover(project.id, user, request(await png(), "automatic"))).toEqual(
        initial,
      );
      expect(await files()).toEqual([key]);
    },
  );

  it("ignores automatic uploads for an archive but permits custom settings", async () => {
    project.archived = true;
    expect(
      await uploadProjectCover(project.id, user, request(await png(), "automatic")),
    ).toBeNull();
    expect(await files()).toEqual([]);
    expect((await uploadProjectCover(project.id, user, request(await png())))?.source).toBe(
      "custom",
    );
  });

  it("rechecks membership after decoding and removes the rejected file", async () => {
    mocks.membership.mockResolvedValueOnce({ role: "member" }).mockResolvedValueOnce(null);
    await expect(uploadProjectCover(project.id, user, request(await png()))).rejects.toMatchObject({
      status: 404,
      code: "PROJECT_NOT_FOUND",
    });
    expect(await files()).toEqual([]);
    expect(row).toBeUndefined();
  });

  it("cleans a losing automatic upload when a custom override arrives before commit", async () => {
    const existing = await storeCover(await prepareCover(await png(), "image/png", "custom"));
    beforeCommit = () => {
      row = {
        projectId: project.id,
        automaticStorageKey: null,
        customStorageKey: existing,
        version: randomUUID(),
      };
    };
    expect(
      (await uploadProjectCover(project.id, user, request(await png(), "automatic")))?.source,
    ).toBe("custom");
    expect(await files()).toEqual([existing]);
  });

  it("preserves the previous cover and removes only the new file if commit fails", async () => {
    const existing = await seed("custom");
    const initial = { ...row! };
    failCommit = true;
    await expect(uploadProjectCover(project.id, user, request(await png()))).rejects.toThrow(
      "Simulated commit failure",
    );
    expect(row).toEqual(initial);
    expect(await files()).toEqual([existing]);
  });
});
