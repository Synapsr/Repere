import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import sharp from "sharp";
import type { Feedback, Project, ReviewData } from "../../shared/types";
import {
  apiContext,
  assertLocalWorkspaceEnvironment,
  createWebsite,
  signIn,
  websiteAnchor,
} from "./helpers";

const jpegUrl = (bytes: Buffer) => `data:image/jpeg;base64,${bytes.toString("base64")}`;

test("point screenshots persist privately, follow share permissions and reject invalid images atomically", async () => {
  assertLocalWorkspaceEnvironment();
  const owner = await apiContext();
  const guest = await apiContext();
  const anonymous = await apiContext();
  try {
    await signIn(owner, "screenshot-owner");
    await signIn(guest, "screenshot-guest");
    const project = await createWebsite(owner, "Screenshot permissions");
    const otherProject = await createWebsite(owner, "Unrelated screenshot project");
    const route = `/api/reviews/${project.shareToken}`;
    const anchor = websiteAnchor(project.url!);
    const bytes = await sharp({
      create: { width: 160, height: 100, channels: 3, background: "#dc283c" },
    })
      .withExif({ IFD0: { ImageDescription: "Synthetic metadata must not be published" } })
      .jpeg()
      .toBuffer();
    expect((await sharp(bytes).metadata()).exif).toBeDefined();
    const capture = {
      dataUrl: jpegUrl(bytes),
      capturedAt: new Date().toISOString(),
      pointX: 0.25,
      pointY: 0.75,
    };
    const saved = await guest.post(`${route}/comments`, {
      data: { body: "The exact state when this point was placed.", anchor, capture },
    });
    expect(saved.status(), await saved.text()).toBe(201);
    const { comment } = (await saved.json()) as { comment: Feedback };
    const expectedScreenshot = {
      width: 160,
      height: 100,
      pointX: capture.pointX,
      pointY: capture.pointY,
      capturedAt: capture.capturedAt,
    };
    expect(comment).toMatchObject({ number: 1, screenshot: expectedScreenshot });
    const screenshotRoute = `${route}/comments/${comment.id}/screenshot`;
    const file = await guest.get(screenshotRoute);
    expect(file.status()).toBe(200);
    expect(file.headers()["content-type"]).toBe("image/jpeg");
    expect(file.headers()["cache-control"]).toContain("private");
    expect(file.headers()["cache-control"]).toContain("no-store");
    expect(file.headers()["x-content-type-options"]).toBe("nosniff");
    const storedBytes = await file.body();
    const metadata = await sharp(storedBytes).metadata();
    expect(metadata).toMatchObject({ format: "jpeg", width: 160, height: 100 });
    expect(metadata.exif).toBeUndefined();
    expect(metadata.xmp).toBeUndefined();
    expect(await (await owner.get(screenshotRoute)).body()).toEqual(storedBytes);
    expect((await anonymous.get(screenshotRoute)).status()).toBe(401);
    expect(
      (
        await guest.get(`/api/reviews/${otherProject.shareToken}/comments/${comment.id}/screenshot`)
      ).status(),
    ).toBe(404);
    expect((await guest.get(`${route}/comments/${randomUUID()}/screenshot`)).status()).toBe(404);
    expect((await (await anonymous.get(route)).json()).comments).toEqual([]);

    const tooWide = await sharp({
      create: { width: 4097, height: 2, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const tooManyPixels = await sharp({
      create: { width: 3000, height: 3000, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const disguisedPng = await sharp(bytes).png().toBuffer();
    const invalidCaptures = [
      {
        label: "invalid base64",
        patch: { dataUrl: "data:image/jpeg;base64,not-an-image!" },
        code: "CAPTURE_INVALID",
      },
      {
        label: "JPEG MIME with PNG bytes",
        patch: { dataUrl: jpegUrl(disguisedPng) },
        code: "CAPTURE_INVALID",
      },
      {
        label: "truncated JPEG",
        patch: { dataUrl: jpegUrl(bytes.subarray(0, 30)) },
        code: "CAPTURE_INVALID",
      },
      {
        label: "side over 4096",
        patch: { dataUrl: jpegUrl(tooWide) },
        code: "CAPTURE_DIMENSIONS_INVALID",
      },
      {
        label: "over eight million pixels",
        patch: { dataUrl: jpegUrl(tooManyPixels) },
        code: "CAPTURE_DIMENSIONS_INVALID",
      },
      { label: "invalid capture date", patch: { capturedAt: "not-a-date" } },
      { label: "point outside the image", patch: { pointX: 1.01 } },
    ];
    for (const invalid of invalidCaptures) {
      const response = await guest.post(`${route}/comments`, {
        data: { body: invalid.label, anchor, capture: { ...capture, ...invalid.patch } },
      });
      expect(response.status(), `${invalid.label}: ${await response.text()}`).toBe(400);
      if (invalid.code) expect((await response.json()).code).toBe(invalid.code);
    }
    // Encoded payload remains under the route limit, while decoded bytes exceed 2 MiB.
    const tooLarge = await guest.post(`${route}/comments`, {
      data: {
        body: "Oversized decoded JPEG",
        anchor,
        capture: { ...capture, dataUrl: jpegUrl(Buffer.alloc(2 * 1024 * 1024 + 1)) },
      },
    });
    expect(tooLarge.status(), await tooLarge.text()).toBe(413);
    expect((await tooLarge.json()).code).toBe("CAPTURE_TOO_LARGE");
    const oversizedBody = await guest.post(`${route}/comments`, {
      data: {
        body: "Oversized request",
        anchor,
        capture: { ...capture, dataUrl: jpegUrl(Buffer.alloc(3 * 1024 * 1024)) },
      },
    });
    expect(oversizedBody.status(), await oversizedBody.text()).toBe(413);
    expect((await oversizedBody.json()).code).toBe("PAYLOAD_TOO_LARGE");
    const persisted = (await (await guest.get(route)).json()) as ReviewData;
    expect(persisted.project.commentCount).toBe(1);
    expect(persisted.comments).toHaveLength(1);
    expect(persisted.comments[0]).toMatchObject({ id: comment.id, screenshot: expectedScreenshot });
    expect(await (await guest.get(screenshotRoute)).body()).toEqual(storedBytes);

    const withoutCapture = await guest.post(`${route}/comments`, {
      data: { body: "Explicitly published without a screenshot.", anchor },
    });
    expect(withoutCapture.status(), await withoutCapture.text()).toBe(201);
    const plain = ((await withoutCapture.json()) as { comment: Feedback }).comment;
    expect(plain).toMatchObject({ number: 2, screenshot: null });
    expect((await guest.get(`${route}/comments/${plain.id}/screenshot`)).status()).toBe(404);

    const rotated = await owner.patch(`/api/projects/${project.id}`, {
      data: { rotateShareToken: true },
    });
    expect(rotated.status()).toBe(200);
    const next = ((await rotated.json()) as { project: Project }).project;
    const currentRoute = `/api/reviews/${next.shareToken}/comments/${comment.id}/screenshot`;
    expect((await owner.get(screenshotRoute)).status()).toBe(404);
    expect((await guest.get(screenshotRoute)).status()).toBe(404);
    expect(await (await guest.get(currentRoute)).body()).toEqual(storedBytes);
    expect(
      (await owner.patch(`/api/projects/${project.id}`, { data: { archived: true } })).status(),
    ).toBe(200);
    expect((await guest.get(currentRoute)).status()).toBe(410);
    const archived = await owner.get(currentRoute);
    expect(archived.status()).toBe(200);
    expect(await archived.body()).toEqual(storedBytes);
  } finally {
    await Promise.all([owner.dispose(), guest.dispose(), anonymous.dispose()]);
  }
});
