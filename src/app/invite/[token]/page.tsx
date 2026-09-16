import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Invitation } from "@/components/invitation";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard");
  return {
    title: t("workspaceInvitation"),
    referrer: "no-referrer",
    robots: { index: false, follow: false },
  };
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <Invitation key={token} token={token} />;
}
