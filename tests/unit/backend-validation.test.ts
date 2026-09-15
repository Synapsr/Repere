import { describe, expect, it } from "vitest";
import {
  anchorSchema,
  assertAnchorMatchesProject,
  authRequestSchema,
  authVerifySchema,
  boundedBody,
  commentSchema,
  projectUpdateSchema,
  readJson,
  websiteUrlSchema,
} from "../../src/lib/server/validation";
import {
  MAX_PDF_BYTES,
  parsePdfUpload,
  uploadPath,
  validPdfSignature,
} from "../../src/lib/server/uploads";

describe("untrusted request validation", () => {
  it("canonicalizes email and rejects malformed identity input", () => {
    expect(authRequestSchema.parse({ email: " Alice@Example.COM ", name: " Alice " })).toEqual({
      email: "alice@example.com",
      name: "Alice",
    });
    expect(authRequestSchema.safeParse({ email: "a@b.com", isAdmin: true }).success).toBe(false);
    expect(authVerifySchema.safeParse({ email: "alice@example.com", code: "012345" }).success).toBe(
      true,
    );
    expect(authVerifySchema.safeParse({ email: "alice@example.com", code: 123456 }).success).toBe(
      false,
    );
    expect(authVerifySchema.safeParse({ email: "alice@example.com", code: "12345" }).success).toBe(
      false,
    );
  });

  it("only permits HTTP(S) URLs without inline credentials", () => {
    expect(websiteUrlSchema.parse(" https://example.com/a?q=1#title ")).toBe(
      "https://example.com/a?q=1#title",
    );
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "ftp://example.com",
      "https://user:password@example.com",
      "data:text/html,test",
      "not-a-url",
    ]) {
      expect(websiteUrlSchema.safeParse(url).success).toBe(false);
    }
  });

  it("bounds and distinguishes PDF and website anchors", () => {
    const pdf = { type: "pdf", page: 1, x: 0, y: 1 };
    expect(anchorSchema.safeParse(pdf).success).toBe(true);
    for (const patch of [
      { page: 0 },
      { page: 1.5 },
      { x: -0.01 },
      { y: 1.001 },
      { y: Infinity },
      { extra: "field" },
    ]) {
      expect(anchorSchema.safeParse({ ...pdf, ...patch }).success).toBe(false);
    }
    const website = {
      type: "website",
      url: "https://example.com/about?q=1#heading",
      selector: "#heading",
      text: "Title",
      x: 0.5,
      y: 0.3,
      documentX: 100,
      documentY: 2000,
      viewportWidth: 1280,
      viewportHeight: 720,
    };
    expect(anchorSchema.safeParse(website).success).toBe(true);
    expect(anchorSchema.safeParse({ ...website, viewportWidth: 0 }).success).toBe(false);
    expect(anchorSchema.safeParse({ ...website, documentY: -1 }).success).toBe(false);
  });

  it("prevents empty text and client-controlled future attachment kinds or ownership changes", () => {
    const anchor = { type: "pdf", page: 1, x: 0.5, y: 0.5 };
    expect(commentSchema.safeParse({ body: "  ", anchor }).success).toBe(false);
    expect(
      commentSchema.safeParse({ body: "Useful feedback", anchor, kind: "audio" }).success,
    ).toBe(false);
    expect(projectUpdateSchema.safeParse({ ownerId: "another-person" }).success).toBe(false);
    expect(projectUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("accepts website page changes but rejects anchors belonging to a different origin", () => {
    const project = { type: "website" as const, url: "https://example.com/start" };
    const anchor = {
      type: "website" as const,
      url: "https://example.com:443/about?q=2#heading",
      selector: null,
      text: null,
      x: 0.5,
      y: 0.5,
      documentX: 10,
      documentY: 200,
      viewportWidth: 1280,
      viewportHeight: 720,
    };
    expect(() => assertAnchorMatchesProject(anchor, project)).not.toThrow();
    for (const url of [
      "https://other.example.com/about",
      "http://example.com/about",
      "https://example.com:8443",
      "https://example.com.evil.test",
      "not-a-url",
    ]) {
      expect(() => assertAnchorMatchesProject({ ...anchor, url }, project)).toThrow(
        "ANCHOR_ORIGIN_MISMATCH",
      );
    }
    expect(() => assertAnchorMatchesProject(anchor, { ...project, url: null })).toThrow();
    expect(() => assertAnchorMatchesProject(anchor, { type: "pdf", url: null })).toThrow(
      "ANCHOR_TYPE_MISMATCH",
    );
    expect(() =>
      assertAnchorMatchesProject({ type: "pdf", page: 1, x: 0.5, y: 0.5 }, project),
    ).toThrow("ANCHOR_TYPE_MISMATCH");
  });

  it("rejects oversized body based on actual bytes even with a forged Content-Length", async () => {
    const req = new Request("https://example.com", {
      method: "POST",
      headers: { "content-length": "1" },
      body: "too much data",
    });
    await expect(boundedBody(req, 3)).rejects.toMatchObject({ status: 413 });
  });

  it("cancels chunked streams immediately when crossing the size limit", async () => {
    let cancelled = false;
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads++;
        controller.enqueue(new Uint8Array(10));
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request("https://example.com", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(boundedBody(req, 15)).rejects.toMatchObject({ status: 413 });
    expect(cancelled).toBe(true);
    expect(reads).toBeLessThan(5);
  });

  it("rejects malformed content length and JSON without leaking parsing errors", async () => {
    await expect(
      boundedBody(
        new Request("https://example.com", {
          method: "POST",
          headers: { "content-length": "nope" },
          body: "{}",
        }),
        100,
      ),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      readJson(new Request("https://example.com", { method: "POST", body: "{}" })),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      readJson(
        new Request("https://example.com", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "invalid",
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("private PDF upload boundary", () => {
  it("checks bytes rather than trusting an extension or MIME type", () => {
    expect(validPdfSignature(Buffer.from("%PDF-1.7\n"))).toBe(true);
    expect(validPdfSignature(Buffer.from("<html>fake.pdf</html>"))).toBe(false);
    expect(validPdfSignature(Buffer.from("%PDF"))).toBe(false);
  });

  it("prevents filesystem path traversal", () => {
    expect(() => uploadPath("../../etc/passwd")).toThrow();
    expect(() => uploadPath("/tmp/document.pdf")).toThrow();
    expect(() => uploadPath("00000000-0000-0000-0000-000000000000.pdf")).not.toThrow();
  });

  it("rejects MIME-spoofed multipart files and duplicate file fields", async () => {
    const form = new FormData();
    form.set("name", "Project");
    form.set("type", "pdf");
    form.set("file", new File(["<html>not PDF</html>"], "test.pdf", { type: "application/pdf" }));
    await expect(
      parsePdfUpload(new Request("https://example.com", { method: "POST", body: form })),
    ).rejects.toMatchObject({ status: 400 });
    form.set("file", new File(["%PDF-1.7\n"], "test.pdf"));
    form.append("file", new File(["%PDF-1.7\n"], "other.pdf"));
    await expect(
      parsePdfUpload(new Request("https://example.com", { method: "POST", body: form })),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("accepts a bounded PDF upload with normalized project metadata", async () => {
    const form = new FormData();
    form.set("name", " Brand review ");
    form.set("type", "pdf");
    form.set("description", " Specs ");
    form.set("file", new File(["%PDF-1.7\n%%EOF"], "brief.pdf", { type: "application/pdf" }));
    const result = await parsePdfUpload(
      new Request("https://example.com", { method: "POST", body: form }),
    );
    expect(result).toMatchObject({
      name: "Brand review",
      description: "Specs",
      fileName: "brief.pdf",
      fileSize: 14,
    });
    expect(result.bytes.byteLength).toBeLessThan(MAX_PDF_BYTES);
  });
});
