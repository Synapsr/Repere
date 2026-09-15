import { describe, expect, it } from "vitest";
import { anchorSchema, parseWebsiteAnchorForOrigin } from "../../shared/validation";

const anchor = {
  type: "website",
  url: "https://target.example/about?q=2#heading",
  selector: "h1",
  text: "Heading",
  x: 0.4,
  y: 0.6,
  documentX: 200,
  documentY: 1000,
  viewportWidth: 1280,
  viewportHeight: 720,
};

describe("shared iframe and API anchor validation", () => {
  it("accepts a real anchor and normalizes only a safe URL", () => {
    expect(parseWebsiteAnchorForOrigin(anchor, "https://target.example/start")).toEqual(anchor);
    expect(anchorSchema.parse(anchor)).toEqual(anchor);
  });
  it("rejects object text, bad selectors and missing fields before the parent UI renders them", () => {
    for (const patch of [
      { text: {} },
      { text: [] },
      { text: 42 },
      { text: "x".repeat(1001) },
      { selector: {} },
      { selector: undefined },
      { extra: true },
    ]) {
      expect(
        parseWebsiteAnchorForOrigin({ ...anchor, ...patch }, "https://target.example"),
      ).toBeNull();
      expect(anchorSchema.safeParse({ ...anchor, ...patch }).success).toBe(false);
    }
  });
  it("rejects non-finite, out-of-bounds and nonnumeric coordinates from structured-clone messages", () => {
    for (const patch of [
      { x: NaN },
      { y: Infinity },
      { x: -0.1 },
      { y: 1.1 },
      { documentX: "20" },
      { viewportWidth: 0 },
      { viewportHeight: 1.2 },
    ])
      expect(
        parseWebsiteAnchorForOrigin({ ...anchor, ...patch }, "https://target.example"),
      ).toBeNull();
  });
  it("rejects another origin, scheme, port, credentialed URLs and malformed messages", () => {
    for (const url of [
      "https://other.example/about",
      "http://target.example/about",
      "https://target.example:8443/about",
      "https://target.example.evil.test/about",
      "javascript:alert(1)",
      "https://user:password@target.example/about",
    ])
      expect(parseWebsiteAnchorForOrigin({ ...anchor, url }, "https://target.example")).toBeNull();
    for (const value of [null, false, "anchor", {}, { type: "pdf", page: 1, x: 0.5, y: 0.5 }])
      expect(parseWebsiteAnchorForOrigin(value, "https://target.example")).toBeNull();
  });
});
