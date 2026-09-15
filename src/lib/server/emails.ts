import { createTranslator } from "next-intl";
import type { Locale } from "../../../shared/locale";
import en from "../../i18n/messages/en/emails.json";
import fr from "../../i18n/messages/fr/emails.json";

const messages = { en, fr };
const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

/** A pure template: the requesting locale is passed explicitly, never stored globally. */
export function renderOtpEmail(locale: Locale, code: string, minutes: number) {
  if (!/^\d{6}$/.test(code) || !Number.isInteger(minutes) || minutes < 1 || minutes > 60)
    throw new Error("Invalid OTP email parameters.");
  const t = createTranslator({
    locale,
    messages: { emails: messages[locale] },
    namespace: "emails",
  });
  const heading = t("heading");
  const intro = t("intro");
  const expiry = t("expiry", { minutes });
  const ignore = t("ignore");
  return {
    subject: t("subject", { code }),
    text: `${heading}\n\n${intro}\n\n${t("codeLabel")}: ${code}\n\n${expiry}\n${ignore}`,
    html: `<!doctype html><html lang="${locale}"><body style="margin:0;padding:32px 16px;background:#f6f7fb;color:#202331;font-family:Arial,sans-serif"><div style="max-width:480px;margin:0 auto;padding:32px;background:#ffffff;border-radius:16px"><p style="margin:0 0 24px;font-size:18px;font-weight:bold;color:#3657e8">Repère</p><h1 style="font-size:24px;line-height:1.3">${escapeHtml(heading)}</h1><p style="line-height:1.6">${escapeHtml(intro)}</p><p style="padding:20px 12px;background:#f6f7fb;border-radius:10px;color:#3657e8;font-size:36px;font-weight:bold;letter-spacing:8px;text-align:center">${code}</p><p style="line-height:1.6">${escapeHtml(expiry)}</p><p style="font-size:13px;line-height:1.6">${escapeHtml(ignore)}</p></div></body></html>`,
  };
}
