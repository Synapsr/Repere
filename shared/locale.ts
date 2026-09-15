export const locales = ["en", "fr"] as const;
export type Locale = (typeof locales)[number];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "repere_locale";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "fr";
}

type HeadersLike = { get(name: string): string | null };

/** Pure negotiation shared by Next.js, API handlers and the isolated preview service. */
export function resolveLocale(headers: HeadersLike, cookieValue?: string): Locale {
  const preference =
    cookieValue ??
    headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${LOCALE_COOKIE}=`))
      ?.slice(LOCALE_COOKIE.length + 1);
  if (isLocale(preference)) return preference;

  const ranges = (headers.get("accept-language") ?? "")
    .slice(0, 8192)
    .split(",")
    .slice(0, 100)
    .flatMap((part, index) => {
      const [rawTag, ...parameters] = part
        .toLowerCase()
        .split(";")
        .map((value) => value.trim());
      if (!/^(?:[a-z]{1,8}(?:-[a-z0-9]{1,8})*|\*)$/.test(rawTag)) return [];
      let quality = 1;
      for (const parameter of parameters) {
        const match = /^\s*q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)\s*$/.exec(parameter);
        if (!match || parameters.length > 1) return [];
        quality = Number(match[1]);
      }
      return [{ tag: rawTag.split("-")[0], quality, index }];
    });

  // Explicit language ranges take precedence over '*' for that language, including q=0.
  const candidates = locales.map((locale) => {
    const matches = ranges.filter((range) => range.tag === locale);
    const accepted = (matches.length ? matches : ranges.filter((range) => range.tag === "*")).sort(
      (a, b) => b.quality - a.quality || a.index - b.index,
    )[0];
    return { locale, quality: accepted?.quality ?? 0, index: accepted?.index ?? Infinity };
  });
  candidates.sort((a, b) => b.quality - a.quality || a.index - b.index);
  return candidates[0].quality > 0 ? candidates[0].locale : DEFAULT_LOCALE;
}
