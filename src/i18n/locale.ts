import { headers } from "next/headers";
import { resolveLocale } from "../../shared/locale";

export {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_COOKIE,
  locales,
  resolveLocale,
} from "../../shared/locale";
export type { Locale } from "../../shared/locale";

export async function requestLocale() {
  return resolveLocale(await headers());
}
