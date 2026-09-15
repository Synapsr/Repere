import { getRequestConfig } from "next-intl/server";
import { requestLocale } from "./locale";
import type { Locale } from "../../shared/locale";
import type { Messages } from "./types";

export async function loadMessages(locale: Locale): Promise<Messages> {
  const [common, auth, dashboard, demo, review, pdf, website, errors, emails] = await Promise.all([
    import(`./messages/${locale}/common.json`),
    import(`./messages/${locale}/auth.json`),
    import(`./messages/${locale}/dashboard.json`),
    import(`./messages/${locale}/demo.json`),
    import(`./messages/${locale}/review.json`),
    import(`./messages/${locale}/pdf.json`),
    import(`./messages/${locale}/website.json`),
    import(`./messages/${locale}/errors.json`),
    import(`./messages/${locale}/emails.json`),
  ]);
  return {
    common: common.default,
    auth: auth.default,
    dashboard: dashboard.default,
    demo: demo.default,
    review: review.default,
    pdf: pdf.default,
    website: website.default,
    errors: errors.default,
    emails: emails.default,
  };
}

export default getRequestConfig(async () => {
  const locale = await requestLocale();
  return { locale, messages: await loadMessages(locale), timeZone: "UTC" };
});
