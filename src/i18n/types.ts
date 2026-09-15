import type { Locale } from "../../shared/locale";
import type auth from "./messages/en/auth.json";
import type common from "./messages/en/common.json";
import type dashboard from "./messages/en/dashboard.json";
import type demo from "./messages/en/demo.json";
import type emails from "./messages/en/emails.json";
import type errors from "./messages/en/errors.json";
import type pdf from "./messages/en/pdf.json";
import type review from "./messages/en/review.json";
import type website from "./messages/en/website.json";

export type Messages = {
  auth: typeof auth;
  common: typeof common;
  dashboard: typeof dashboard;
  demo: typeof demo;
  emails: typeof emails;
  errors: typeof errors;
  pdf: typeof pdf;
  review: typeof review;
  website: typeof website;
};

declare module "next-intl" {
  interface AppConfig {
    Locale: Locale;
    Messages: Messages;
  }
}
