import type { Locale } from "../../shared/locale";
import en from "@/i18n/messages/en/common.json";
import fr from "@/i18n/messages/fr/common.json";

function fallbackError() {
  return typeof document !== "undefined" && document.documentElement.lang === "fr"
    ? fr.unexpectedError
    : en.unexpectedError;
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...init?.headers,
    },
  }).catch(() => {
    throw new Error(fallbackError());
  });
  const data = await response.json().catch(() => ({ error: fallbackError() }));
  if (!response.ok) throw new Error(data.error || fallbackError());
  return data as T;
}
export function initials(name: string) {
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
}
export function relativeDate(date: string, locale: Locale = "en") {
  const hours = Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 3600000));
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (hours < 1) return relative.format(0, "second");
  if (hours < 24) return relative.format(-hours, "hour");
  if (hours < 48) return relative.format(-1, "day");
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(new Date(date));
}
