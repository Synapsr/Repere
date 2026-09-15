import { afterEach, describe, expect, it, vi } from "vitest";
import { isLocale, resolveLocale } from "../../shared/locale";
import { ApiError, handle, json } from "../../src/lib/server/errors";
import {
  authRequestSchema,
  authVerifySchema,
  websiteUrlSchema,
} from "../../src/lib/server/validation";
import { renderOtpEmail } from "../../src/lib/server/emails";
import enErrors from "../../src/i18n/messages/en/errors.json";
import frErrors from "../../src/i18n/messages/fr/errors.json";
import enEmails from "../../src/i18n/messages/en/emails.json";
import frEmails from "../../src/i18n/messages/fr/emails.json";
import { POST as setLocale } from "../../src/app/api/locale/route";

const cookieSet = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ cookies: async () => ({ set: cookieSet }) }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  cookieSet.mockReset();
});

describe("request-scoped locale negotiation", () => {
  it.each([
    ["fr-CA,fr;q=0.9,en;q=0.7", "fr"],
    ["fr;q=0.4,en-GB;q=0.9", "en"],
    ["de-DE,fr-FR;q=0.8,en;q=0.6", "fr"],
    ["fr,en", "fr"],
    ["en,fr", "en"],
    [" FR-ca ; q=0.9 , en;q=0.5", "fr"],
    ["fr;q=0,en;q=0.6", "en"],
    ["en;q=0,*;q=0.7", "fr"],
    ["fr;q=2,en;q=0.5", "en"],
    ["fr;q=NaN,en", "en"],
    ["fr;q=0.5;unknown=1,en", "en"],
    ["de,es", "en"],
    ["", "en"],
  ])("negotiates %s as %s", (acceptLanguage, expected) => {
    expect(resolveLocale(new Headers({ "accept-language": acceptLanguage }))).toBe(expected);
  });

  it("prefers a validated cookie and rejects unknown or injected preferences", () => {
    const headers = new Headers({
      cookie: "repere_session=private; repere_locale=en; other=fr",
      "accept-language": "fr-FR",
    });
    expect(resolveLocale(headers)).toBe("en");
    expect(resolveLocale(headers, "fr")).toBe("fr");
    for (const value of ["../../fr", "FR", "fr-FR", "en<script>", "__proto__"]) {
      expect(isLocale(value)).toBe(false);
      expect(resolveLocale(new Headers({ "accept-language": "en-US" }), value)).toBe("en");
    }
    expect(
      resolveLocale(new Headers({ cookie: "repere_locale=unknown", "accept-language": "fr" })),
    ).toBe("fr");
    expect(resolveLocale(new Headers({ cookie: "unrelated_repere_locale=fr" }))).toBe("en");
  });
});

describe("localized API boundaries", () => {
  it("keeps stable codes and request languages isolated under concurrent errors", async () => {
    const responses = await Promise.all(
      ["en", "fr", "en", "fr"].map((locale) =>
        handle(
          new Request("https://app.test", { headers: { "accept-language": locale } }),
          async () => {
            await Promise.resolve();
            throw new ApiError(401, "AUTH_REQUIRED");
          },
        ),
      ),
    );
    for (const [index, response] of responses.entries()) {
      const locale = index % 2 ? "fr" : "en";
      expect(response.status).toBe(401);
      expect(response.headers.get("content-language")).toBe(locale);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        code: "AUTH_REQUIRED",
        error: (locale === "en" ? enErrors : frErrors).AUTH_REQUIRED,
      });
    }
  });

  it("localizes explicit validation identifiers, without exposing Zod internals", async () => {
    const request = new Request("https://app.test", { headers: { cookie: "repere_locale=fr" } });
    for (const [schema, value, expectedCode] of [
      [authRequestSchema, { email: "bad" }, "INVALID_EMAIL"],
      [authVerifySchema, { email: "alice@example.test", code: "123" }, "OTP_FORMAT"],
      [websiteUrlSchema, "https://username:password@private.test", "INVALID_WEBSITE_URL"],
      [authRequestSchema, { email: 42 }, "INVALID_INPUT"],
    ] as const) {
      const response = await handle(request, async () => json(schema.parse(value)));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ code: expectedCode, error: frErrors[expectedCode] });
    }
  });

  it("masks unexpected errors and never logs their content", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await handle(new Request("https://app.test"), async () => {
      throw new Error("private OTP code, SQL query or database password");
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      code: "INTERNAL_ERROR",
      error: enErrors.INTERNAL_ERROR,
    });
    expect(logger).toHaveBeenCalledExactlyOnceWith("API request failed", "Error");
  });

  it("stores only a valid locale with host-only secure cookie attributes", async () => {
    vi.stubEnv("APP_URL", "https://app.test");
    const response = await setLocale(
      new Request("https://app.test/api/locale", {
        method: "POST",
        headers: { Origin: "https://app.test", "Content-Type": "application/json" },
        body: JSON.stringify({ locale: "fr" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ locale: "fr" });
    expect(cookieSet).toHaveBeenCalledExactlyOnceWith("repere_locale", "fr", {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
  });

  it("rejects CSRF and malformed locale values before writing any cookie", async () => {
    vi.stubEnv("APP_URL", "https://app.test");
    for (const [origin, locale, status, code] of [
      ["https://evil.test", "fr", 403, "ORIGIN_NOT_ALLOWED"],
      ["https://app.test", "de", 400, "INVALID_LOCALE"],
      ["https://app.test", "../../en", 400, "INVALID_LOCALE"],
    ] as const) {
      const response = await setLocale(
        new Request("https://app.test/api/locale", {
          method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" },
          body: JSON.stringify({ locale }),
        }),
      );
      expect(response.status).toBe(status);
      expect((await response.json()).code).toBe(code);
    }
    expect(cookieSet).not.toHaveBeenCalled();
  });

  it("refuses setting an app language from another host or a cross-site request", async () => {
    vi.stubEnv("APP_URL", "https://app.test");
    const rejectedHeaders: Record<string, string>[] = [
      { host: "public.test", origin: "https://public.test" },
      { host: "public.test", origin: "https://app.test", "x-forwarded-host": "app.test" },
      { host: "app.test", origin: "https://app.test", "sec-fetch-site": "cross-site" },
    ];
    for (const headers of rejectedHeaders) {
      const response = await setLocale(
        new Request("http://app:3000/api/locale", {
          method: "POST",
          headers: { ...headers, "content-type": "application/json" },
          body: JSON.stringify({ locale: "fr" }),
        }),
      );
      expect(response.status).toBe(403);
    }
    expect(cookieSet).not.toHaveBeenCalled();
  });
});

describe("OTP translations", () => {
  it("ships matching complete error and email catalogs", () => {
    expect(Object.keys(frErrors).sort()).toEqual(Object.keys(enErrors).sort());
    expect(Object.keys(frEmails).sort()).toEqual(Object.keys(enEmails).sort());
    for (const catalog of [enErrors, frErrors, enEmails, frEmails]) {
      expect(
        Object.values(catalog).every((value) => typeof value === "string" && value.trim()),
      ).toBe(true);
    }
  });

  it("renders leading-zero codes and expiry in both subjects, plain text and HTML", () => {
    const en = renderOtpEmail("en", "012345", 10);
    const fr = renderOtpEmail("fr", "012345", 10);
    expect(en.subject).toBe("012345 — Your Repère code");
    expect(fr.subject).toBe("012345 — Votre code Repère");
    expect(en.text).toContain("expires in 10 minutes");
    expect(fr.text).toContain("expire dans 10 minutes");
    for (const [locale, email] of [
      ["en", en],
      ["fr", fr],
    ] as const) {
      expect(email.text).toContain("012345");
      expect(email.html).toContain(`lang="${locale}"`);
      expect(email.html).toContain("012345");
      for (const color of ["#3657e8", "#202331", "#f6f7fb"]) expect(email.html).toContain(color);
      expect(email.html).not.toContain("{minutes}");
    }
  });

  it("rejects template injection and impossible expiry input", () => {
    expect(() => renderOtpEmail("en", '<img src="x">', 10)).toThrow();
    expect(() => renderOtpEmail("fr", "123456", NaN)).toThrow();
    expect(() => renderOtpEmail("en", "123456", 0)).toThrow();
  });
});
