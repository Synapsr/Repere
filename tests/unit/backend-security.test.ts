import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/lib/server/errors";
import {
  appOrigin,
  assertSameOrigin,
  challengeUsable,
  generateOtp,
  OTP_MAX_ATTEMPTS,
  otpHash,
  ownerEmailAllowed,
  randomToken,
  requestNetwork,
  safeHashEquals,
  secret,
  sessionCookieName,
  tokenHash,
} from "../../src/lib/server/security";

describe("authentication security boundaries", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-thirty-two-characters");
    vi.stubEnv("APP_URL", "https://review.example.com");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uses browser-enforced host cookies on HTTPS deployments", () => {
    vi.stubEnv("APP_URL", "https://app.repere.dev");
    expect(sessionCookieName()).toBe("__Host-repere_session");
    vi.stubEnv("APP_URL", "http://localhost:8080");
    expect(sessionCookieName()).toBe("repere_session");
  });

  it("hashes each OTP against both identity and the server secret", () => {
    const hash = otpHash("alice@example.com", "012345");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toBe(otpHash("bob@example.com", "012345"));
    expect(hash).not.toBe(otpHash("alice@example.com", "012346"));
    vi.stubEnv("SESSION_SECRET", "a-different-secret-at-least-thirty-two-characters");
    expect(hash).not.toBe(otpHash("alice@example.com", "012345"));
  });

  it("rejects missing / insufficient deployment secrets", () => {
    vi.stubEnv("SESSION_SECRET", "short");
    expect(() => secret("SESSION_SECRET")).toThrow("at least 32");
  });

  it("uses six digits, including leading zero compatibility", () => {
    for (let i = 0; i < 100; i++) expect(generateOtp()).toMatch(/^\d{6}$/);
    expect(
      safeHashEquals(otpHash("a@example.com", "000000"), otpHash("a@example.com", "000000")),
    ).toBe(true);
  });

  it("does not accept truncated or malformed hashes", () => {
    const hash = otpHash("a@example.com", "123456");
    expect(safeHashEquals(hash, hash)).toBe(true);
    expect(safeHashEquals(hash, hash.slice(0, -2))).toBe(false);
    expect(safeHashEquals("", "")).toBe(false);
    expect(safeHashEquals("g".repeat(64), "g".repeat(64))).toBe(false);
  });

  it("rejects consumed, expired, and exhausted challenges at boundary times", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const valid = { consumedAt: null, expiresAt: new Date(now.getTime() + 1), attempts: 0 };
    expect(challengeUsable(valid, now)).toBe(true);
    expect(challengeUsable({ ...valid, expiresAt: now }, now)).toBe(false);
    expect(challengeUsable({ ...valid, consumedAt: now }, now)).toBe(false);
    expect(challengeUsable({ ...valid, attempts: OTP_MAX_ATTEMPTS }, now)).toBe(false);
    expect(challengeUsable({ ...valid, attempts: OTP_MAX_ATTEMPTS - 1 }, now)).toBe(true);
  });

  it("issues unique 256-bit bearer values and stores only their digest", () => {
    const a = randomToken();
    const b = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(tokenHash(a)).toMatch(/^[a-f0-9]{64}$/);
    expect(tokenHash(a)).not.toBe(tokenHash(b));
  });

  it("requires the exact configured origin on mutations", () => {
    expect(appOrigin()).toBe("https://review.example.com");
    expect(() =>
      assertSameOrigin(
        new Request("https://review.example.com/api/auth/request", {
          headers: { origin: "https://review.example.com" },
        }),
      ),
    ).not.toThrow();
    for (const origin of [
      "https://evil.example.com",
      "https://review.example.com.evil.test",
      "http://review.example.com",
      "null",
    ]) {
      expect(() =>
        assertSameOrigin(new Request("https://review.example.com", { headers: { origin } })),
      ).toThrow(ApiError);
    }
    expect(() => assertSameOrigin(new Request("https://review.example.com"))).toThrow(ApiError);
    expect(() =>
      assertSameOrigin(
        new Request("https://review.example.com", {
          headers: { origin: "https://review.example.com", "sec-fetch-site": "cross-site" },
        }),
      ),
    ).toThrow(ApiError);
  });

  it("does not trust attacker-provided forwarded IP headers by default", () => {
    const request = new Request("https://review.example.com", {
      headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" },
    });
    vi.stubEnv("TRUST_PROXY", "false");
    expect(requestNetwork(request)).toBe("shared");
    vi.stubEnv("TRUST_PROXY", "true");
    expect(requestNetwork(request)).toBe("1.2.3.4");
  });

  it("matches exact allowed owner email domains without suffix bypasses", () => {
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", " Example.COM, agency.fr ");
    expect(ownerEmailAllowed("alice@example.com")).toBe(true);
    expect(ownerEmailAllowed("alice@agency.fr")).toBe(true);
    expect(ownerEmailAllowed("alice@evil-example.com")).toBe(false);
    expect(ownerEmailAllowed("alice@example.com.evil.test")).toBe(false);
    vi.stubEnv("ALLOWED_EMAIL_DOMAINS", "");
    expect(ownerEmailAllowed("alice@anywhere.test")).toBe(true);
  });
});
