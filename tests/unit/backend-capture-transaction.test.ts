import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CaptureInput, User, WebsiteAnchor } from "../../shared/types";
import { createComment } from "../../src/lib/server/projects";

const db = vi.hoisted(() => ({ transaction: vi.fn(), select: vi.fn() }));
vi.mock("@/db", () => ({ database: () => db }));
vi.mock("../../src/lib/server/rate-limit", () => ({ rateLimit: vi.fn() }));

let directory: string;
beforeEach(async () => {
  vi.resetAllMocks();
  directory = await mkdtemp(path.join(tmpdir(), "repere-capture-transaction-"));
  vi.stubEnv("UPLOAD_DIR", directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

const user: User = { id: randomUUID(), name: "Capture test", email: "capture@example.test" };
const token = "a".repeat(43);
const project = {
  id: randomUUID(),
  type: "website",
  url: "https://example.test/",
  archived: false,
  nextCommentNumber: 1,
  commentCount: 0,
};
const anchor: WebsiteAnchor = {
  type: "website",
  url: "https://example.test/",
  selector: null,
  text: null,
  x: 0.3,
  y: 0.4,
  documentX: 307,
  documentY: 307,
  viewportWidth: 1024,
  viewportHeight: 768,
};

async function capture(): Promise<CaptureInput> {
  const bytes = await sharp({
    create: { width: 16, height: 12, channels: 3, background: "#4060a0" },
  })
    .jpeg()
    .toBuffer();
  return {
    dataUrl: `data:image/jpeg;base64,${bytes.toString("base64")}`,
    capturedAt: "2026-09-16T12:00:00Z",
    pointX: 0.3,
    pointY: 0.4,
  };
}

function transaction(rows: (typeof project)[]) {
  return {
    select: () => ({ from: () => ({ where: () => ({ for: async () => rows }) }) }),
    insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
}

describe("comment capture persistence boundaries", () => {
  it("rejects an unavailable link before decoding or creating a private file", async () => {
    db.transaction.mockImplementationOnce(async (callback) => callback(transaction([])));
    await expect(
      createComment(token, user, {
        body: "A comment",
        anchor,
        capture: { ...(await capture()), dataUrl: "invalid image data" },
      }),
    ).rejects.toMatchObject({ status: 404, code: "REVIEW_LINK_UNAVAILABLE" });
    expect(await readdir(directory)).toEqual([]);
  });

  it.each([
    { rows: [{ ...project, archived: true }], status: 409, code: "PROJECT_READ_ONLY" },
    { rows: [], status: 404, code: "REVIEW_LINK_UNAVAILABLE" },
  ])("removes the file if access changes before commit: $code", async ({ rows, status, code }) => {
    const finalTransaction = transaction(rows);
    db.transaction
      .mockImplementationOnce(async (callback) => callback(transaction([project])))
      .mockImplementationOnce(async (callback) => {
        expect(await readdir(path.join(directory, "captures"))).toHaveLength(1);
        return callback(finalTransaction);
      });
    await expect(
      createComment(token, user, { body: "A comment", anchor, capture: await capture() }),
    ).rejects.toMatchObject({ status, code });
    expect(finalTransaction.insert).not.toHaveBeenCalled();
    expect(await readdir(path.join(directory, "captures"))).toEqual([]);
  });

  it("removes the private file when the database transaction cannot commit", async () => {
    db.transaction
      .mockImplementationOnce(async (callback) => callback(transaction([project])))
      .mockImplementationOnce(async (callback) => {
        await callback(transaction([project]));
        throw new Error("Simulated failed commit");
      });
    await expect(
      createComment(token, user, { body: "A comment", anchor, capture: await capture() }),
    ).rejects.toThrow("Simulated failed commit");
    expect(await readdir(path.join(directory, "captures"))).toEqual([]);
  });

  it("preserves the committed file when only the subsequent response read fails", async () => {
    db.transaction.mockImplementation(async (callback) => callback(transaction([project])));
    db.select.mockImplementation(() => {
      throw new Error("Simulated response read failure");
    });
    await expect(
      createComment(token, user, { body: "A comment", anchor, capture: await capture() }),
    ).rejects.toThrow("Simulated response read failure");
    expect(await readdir(path.join(directory, "captures"))).toHaveLength(1);
  });
});
