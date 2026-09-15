import { describe, expect, it } from "vitest";
import { isPublicAddress, resolveDestination, validateNavigation } from "../../preview/network";
import { rewriteCookie, upstreamHeaders } from "../../preview/transport";
import { rewriteHtml, rewriteUrl } from "../../preview/rewrite";

describe("native preview network boundary", () => {
  it.each([
    "127.0.0.1",
    "0.0.0.0",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "169.254.169.254",
    "100.100.100.200",
    "192.0.2.1",
    "224.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "2001:db8::1",
    "64:ff9b::a00:1",
  ])("denies non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });
  it("permits public IPs, rejects mixed DNS and only permits exact development hosts", async () => {
    expect(isPublicAddress("93.184.216.34")).toBe(true);
    expect(isPublicAddress("2606:4700:4700::1111")).toBe(true);
    await expect(
      resolveDestination("example.com", 443, new Set(), async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
    ).rejects.toThrow();
    await expect(resolveDestination("127.1", 80)).rejects.toThrow();
    await expect(resolveDestination("example.com", 3306)).rejects.toThrow();
    const resolver = async () => [{ address: "127.0.0.1", family: 4 }];
    await expect(
      resolveDestination("fixture.test", 4000, new Set(["fixture.test"]), resolver),
    ).resolves.toEqual({ address: "127.0.0.1", family: 4 });
    await expect(
      resolveDestination("child.fixture.test", 4000, new Set(["fixture.test"]), resolver),
    ).rejects.toThrow();
  });
  it("rejects unsafe protocols, userinfo and another project origin", () => {
    for (const value of [
      "file:///etc/passwd",
      "javascript:alert(1)",
      "https://user:password@example.com",
      "https://example.com.evil.test",
    ])
      expect(() => validateNavigation(value, "https://example.com")).toThrow();
  });
});

describe("native preview transformations", () => {
  const target = "https://source.example";
  const preview = "https://abc.preview.example";
  const config = {
    appOrigin: "https://app.example",
    targetOrigin: target,
    channel: "a".repeat(32),
  };
  it("injects before target scripts while preserving JS, relative URLs and external HTTPS assets", () => {
    const script = `window.initial = { url: "https://source.example/api", text: "<hello> & test" }; import('/module.js');`;
    const html = rewriteHtml(
      `<!doctype html><html><head><script>${script}</script><script src="/module.js" integrity="sha256-original"></script><script src="https://cdn.example/lib.js"></script><meta http-equiv="Content-Security-Policy" content="script-src 'none'"></head><body><a href="${target}/page?q=1#anchor">Page</a><img srcset="${target}/one.png 1x,${target}/two.png 2x"><form action="${target}/send"></form></body></html>`,
      target,
      preview,
      config,
    );
    expect(html.indexOf('id="repere-preview-config"')).toBeLessThan(html.indexOf(script));
    expect(html).toContain(`<script>${script}</script>`);
    expect(html).toContain('src="/module.js" integrity="sha256-original"');
    expect(html).toContain('src="https://cdn.example/lib.js"');
    expect(html).toContain(`href="${preview}/page?q=1#anchor"`);
    expect(html).toContain(`srcset="${preview}/one.png 1x,${preview}/two.png 2x"`);
    expect(html).toContain(`action="${preview}/send"`);
    expect(html).not.toContain('http-equiv="Content-Security-Policy"');
  });
  it("keeps embedded JSON inert even if config contains a script delimiter", () => {
    const html = rewriteHtml("<h1>Hello</h1>", target, preview, {
      ...config,
      channel: '</script><script>alert("bad")</script>',
    });
    expect(html).toContain("\\u003c/script>");
    expect(html).not.toContain('<script>alert("bad")</script>');
  });
  it("preserves cross-origin and non-network URLs", () => {
    for (const value of [
      "/relative?q=x",
      "#fragment",
      "data:image/png;base64,abc",
      "mailto:hello@example.com",
      "https://cdn.example/path",
    ])
      expect(rewriteUrl(value, target, preview)).toBe(value);
    expect(rewriteUrl("//source.example/path", target, preview)).toBe(`${preview}/path`);
  });
  it("makes cookies host-only and partitioned while retaining HttpOnly, path and expiry", () => {
    const result = rewriteCookie(
      "session=opaque; Domain=.source.example; Path=/area; HttpOnly; SameSite=Lax; Expires=Tue, 15 Sep 2037 00:00:00 GMT",
    );
    expect(result).toContain("session=opaque; Path=/area; HttpOnly;");
    expect(result).toContain("Expires=Tue, 15 Sep 2037 00:00:00 GMT");
    expect(result).toContain("SameSite=None; Secure; Partitioned");
    expect(result).not.toContain("Domain");
    expect(result).not.toContain("SameSite=Lax");
  });
  it("translates Origin/Referer, strips hop/forwarded headers and preserves site auth", () => {
    const result = upstreamHeaders(
      {
        host: "preview.example",
        origin: preview,
        referer: `${preview}/page?q=1`,
        connection: "keep-alive, x-private-hop",
        "x-private-hop": "hidden",
        "x-forwarded-for": "internal",
        cookie: "site=value",
        authorization: "Bearer website-token",
      },
      new URL(`${target}/api`),
      preview,
    );
    expect(result).toMatchObject({
      host: "source.example",
      origin: target,
      referer: `${target}/page?q=1`,
      cookie: "site=value",
      authorization: "Bearer website-token",
    });
    expect(result).not.toHaveProperty("connection");
    expect(result).not.toHaveProperty("x-private-hop");
    expect(result).not.toHaveProperty("x-forwarded-for");
    expect(
      upstreamHeaders({ referer: "https://app.example/r/private-token" }, new URL(target), preview),
    ).not.toHaveProperty("referer");
  });
});
