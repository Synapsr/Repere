import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { jar, database } = vi.hoisted(() => ({
  jar: { get: vi.fn(), set: vi.fn() },
  database: vi.fn(),
}));
vi.mock("next/headers", () => ({ cookies: async () => jar }));
vi.mock("@/db", () => ({ database }));

import { currentUser, logout } from "../../src/lib/server/auth";

describe("HTTPS session cookie isolation", () => {
  beforeEach(() => {
    vi.stubEnv("APP_URL", "https://app.repere.dev");
    vi.clearAllMocks();
    // A sibling hostname can set a legacy cookie for the parent domain.
    jar.get.mockImplementation((name: string) =>
      name === "repere_session" ? { value: "a".repeat(43) } : undefined,
    );
  });
  afterEach(() => vi.unstubAllEnvs());

  it("does not authenticate a legacy cookie planted by a sibling preview", async () => {
    expect(await currentUser()).toBeNull();
    expect(jar.get).toHaveBeenCalledWith("__Host-repere_session");
    expect(database).not.toHaveBeenCalled();
  });

  it("clears the protected host cookie without acting on a planted legacy session", async () => {
    await logout();
    expect(database).not.toHaveBeenCalled();
    expect(jar.set).toHaveBeenCalledWith("__Host-repere_session", "", {
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    });
  });
});
