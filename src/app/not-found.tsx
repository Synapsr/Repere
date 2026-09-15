import Link from "next/link";
import { Logo } from "@/components/ui";
import { getTranslations } from "next-intl/server";
export default async function NotFound() {
  const t = await getTranslations("common");
  return (
    <main className="center-page">
      <Logo />
      <div className="empty-orbit">?</div>
      <h1>{t("notFoundTitle")}</h1>
      <p>{t("notFoundDescription")}</p>
      <Link className="button primary" href="/">
        {t("backToProjects")}
      </Link>
    </main>
  );
}
