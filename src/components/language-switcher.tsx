"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { api } from "@/lib/client";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState(false);

  return (
    <div className={`language-switcher${compact ? " compact" : ""}`}>
      <Languages size={15} aria-hidden="true" />
      <select
        aria-label={t("language")}
        value={locale}
        disabled={pending}
        onChange={(event) => {
          const language = event.target.value;
          setError(false);
          startTransition(async () => {
            try {
              await api("/api/locale", {
                method: "POST",
                body: JSON.stringify({ locale: language }),
              });
              router.refresh();
            } catch {
              setError(true);
            }
          });
        }}
      >
        <option value="en" lang="en">
          {compact ? "EN" : "English"}
        </option>
        <option value="fr" lang="fr">
          {compact ? "FR" : "Français"}
        </option>
      </select>
      {error && (
        <span className="language-error" role="alert">
          {t("languageError")}
        </span>
      )}
    </div>
  );
}
