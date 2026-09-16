import { describe, expect, it } from "vitest";
import { loginDestination } from "../../src/lib/login-destination";

describe("post-login destination", () => {
  const origin = "https://app.repere.test";
  it("preserves invitation routes and workspace state", () => {
    expect(loginDestination("/invite/a-valid-token", origin)).toBe("/invite/a-valid-token");
    expect(loginDestination("/?workspace=workspace-id#projects", origin)).toBe(
      "/?workspace=workspace-id#projects",
    );
  });
  it.each([
    null,
    "https://evil.test/path",
    "//evil.test/path",
    "/\\evil.test/path",
    "/\t/evil.test/path",
    "javascript:alert(1)",
    "relative/path",
  ])("rejects non-local or normalized cross-origin input %s", (next) => {
    expect(loginDestination(next, origin)).toBe("/");
  });
});
