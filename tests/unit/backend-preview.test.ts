import { afterEach, describe, expect, it, vi } from "vitest";
import { requestPreviewSession, validatePreviewSession } from "../../src/lib/server/preview";

const hostname = `${"a".repeat(48)}.localhost:3001`;
const now = Date.parse("2026-09-15T12:00:00Z");
function session(expiresAt = new Date(now + 60 * 60 * 1000).toISOString()) {
  return {
    url: `http://${hostname}/about?q=2#heading`,
    origin: `http://${hostname}`,
    targetUrl: "https://target.example/about?q=2#heading",
    channel: "c".repeat(32),
    expiresAt,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("native preview origin boundary", () => {
  it("accepts only a live session with an isolated hostname and preserved page URL", () => {
    expect(validatePreviewSession(session(), "http://localhost:3001", now)).toEqual(session());
    // The trusted service may canonicalize an initial redirect to another validated public origin.
    expect(
      validatePreviewSession(
        { ...session(), targetUrl: "https://canonical.example/about?q=2#heading" },
        "http://localhost:3001",
        now,
      ).targetUrl,
    ).toBe("https://canonical.example/about?q=2#heading");
  });

  it("rejects injected frame hosts, ports, protocols and nested labels", () => {
    for (const origin of [
      "http://localhost:3001",
      `http://${hostname}.evil.test`,
      `http://${"a".repeat(48)}.nested.localhost:3001`,
      `http://${"a".repeat(48)}.localhost:9999`,
      `https://${hostname}`,
      "https://evil.test",
    ]) {
      expect(() =>
        validatePreviewSession(
          { ...session(), url: `${origin}/about?q=2#heading`, origin },
          "http://localhost:3001",
          now,
        ),
      ).toThrow();
    }
    expect(() =>
      validatePreviewSession(
        { ...session(), origin: "https://evil.test" },
        "http://localhost:3001",
        now,
      ),
    ).toThrow();
  });

  it("rejects malformed metadata, unsafe target schemes, path substitution and invalid expiry", () => {
    for (const patch of [
      { channel: "short" },
      { targetUrl: "javascript:alert(1)" },
      { targetUrl: "https://user:password@target.example/about?q=2#heading" },
      { url: `http://${hostname}/different` },
      { expiresAt: new Date(now).toISOString() },
      { expiresAt: new Date(now + 3 * 60 * 60 * 1000).toISOString() },
      { expiresAt: "not-a-date" },
      { extra: "unexpected" },
    ]) {
      expect(() =>
        validatePreviewSession({ ...session(), ...patch }, "http://localhost:3001", now),
      ).toThrow();
    }
  });
});

describe("preview service transport", () => {
  const input = { url: "https://target.example/start", projectId: "project-id", userId: "user-id" };
  function configure() {
    vi.stubEnv("PROXY_SECRET", "p".repeat(64));
    vi.stubEnv("APP_URL", "http://localhost:3000");
    vi.stubEnv("PROXY_INTERNAL_URL", "http://preview:3001");
    vi.stubEnv("PREVIEW_BASE_URL", "http://localhost:3001");
  }

  it("sends only the independent service credential and explicit identity payload", async () => {
    configure();
    const response = session(new Date(Date.now() + 60 * 60 * 1000).toISOString());
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response));
    vi.stubGlobal("fetch", fetchMock);
    expect(await requestPreviewSession(input, "fr")).toEqual(response);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://preview:3001/__repere/sessions");
    expect(init.headers).toEqual({
      Authorization: `Bearer ${"p".repeat(64)}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Accept-Language": "fr",
    });
    expect(JSON.parse(String(init.body))).toEqual(input);
    expect(init).toMatchObject({ method: "POST", cache: "no-store", redirect: "error" });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("masks internal failure details and bounds successful service responses", async () => {
    configure();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("private internal secret", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(requestPreviewSession(input)).rejects.toMatchObject({ status: 503 });
    fetchMock.mockResolvedValueOnce(new Response("private DNS address", { status: 400 }));
    await expect(requestPreviewSession(input)).rejects.toMatchObject({
      status: 400,
      code: "PREVIEW_TARGET_UNAVAILABLE",
    });
    fetchMock.mockResolvedValueOnce(new Response(" ".repeat(20 * 1024)));
    await expect(requestPreviewSession(input)).rejects.toMatchObject({
      status: 503,
      code: "PREVIEW_RESPONSE_INVALID",
    });
  });

  it("rejects mixed-content preview configuration for an HTTPS application", async () => {
    configure();
    vi.stubEnv("APP_URL", "https://repere.example");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(session(new Date(Date.now() + 60000).toISOString()))),
    );
    await expect(requestPreviewSession(input)).rejects.toMatchObject({ status: 503 });
  });
});
