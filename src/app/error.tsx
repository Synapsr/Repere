"use client";
import { useTranslations } from "next-intl";
export default function ErrorPage({ reset }: { reset: () => void }) {
  const t = useTranslations("common");
  return (
    <main className="center-page">
      <h1>{t("errorTitle")}</h1>
      <p>{t("errorDescription")}</p>
      <button className="button primary" onClick={reset}>
        {t("retry")}
      </button>
    </main>
  );
}
