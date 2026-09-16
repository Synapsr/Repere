"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LogOut, Mail, Users } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { InvitationData, Workspace } from "../../shared/types";
import { api } from "@/lib/client";
import { ErrorBanner, Logo, Spinner } from "./ui";
import { LanguageSwitcher } from "./language-switcher";
import "./workspace-members.css";

export function Invitation({ token }: { token: string }) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const router = useRouter();
  const [data, setData] = useState<InvitationData | null>(null);
  const [failure, setFailure] = useState<{ unavailable: boolean; message: string } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState<"accept" | "account" | null>(null);
  const action = useRef<AbortController | null>(null);
  const loadFailure = useEffectEvent(() => t("invitationLoadError"));
  const endpoint = `/api/invitations/${encodeURIComponent(token)}`;
  const loginUrl = `/login?next=${encodeURIComponent(`/invite/${token}`)}`;

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch(endpoint, {
          signal: controller.signal,
          cache: "no-store",
          referrerPolicy: "no-referrer",
        });
        const result = await response.json();
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setFailure({
            unavailable: response.status === 404 || response.status === 410,
            message: typeof result.error === "string" ? result.error : loadFailure(),
          });
          return;
        }
        setData(result as InvitationData);
      } catch {
        if (!controller.signal.aborted) setFailure({ unavailable: false, message: loadFailure() });
      }
    }
    void load();
    return () => controller.abort();
  }, [endpoint, retry]);
  useEffect(() => () => action.current?.abort(), []);

  async function act(kind: "accept" | "account") {
    if (action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setBusy(kind);
    setError("");
    try {
      if (kind === "account") {
        await api("/api/auth/logout", { method: "POST", signal: controller.signal });
        if (!controller.signal.aborted) router.replace(loginUrl);
      } else {
        const { workspace } = await api<{ workspace: Workspace }>(endpoint, {
          method: "POST",
          signal: controller.signal,
          referrerPolicy: "no-referrer",
        });
        if (!controller.signal.aborted) router.replace(`/?workspace=${workspace.id}`);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error instanceof Error ? error.message : t("invitationAcceptError"));
        setBusy(null);
        action.current = null;
      }
    }
  }

  return (
    <main className="workspace-invitation-page">
      <header>
        <Logo />
        <LanguageSwitcher compact />
      </header>
      <section className="workspace-invitation-card" aria-busy={!!busy}>
        <div className="workspace-invitation-symbol" aria-hidden="true">
          {failure ? <Mail size={26} /> : <Users size={26} />}
        </div>
        {!data && !failure && (
          <div role="status">
            <Spinner label={t("invitationLoading")} />
          </div>
        )}
        {failure && (
          <>
            <h1>{t(failure.unavailable ? "invitationUnavailableTitle" : "invitationLoadTitle")}</h1>
            <ErrorBanner message={failure.message} />
            {failure.unavailable ? (
              <>
                <p>{t("invitationUnavailableHelp")}</p>
                <Link href="/" className="button secondary">
                  {t("invitationHome")}
                </Link>
              </>
            ) : (
              <button
                className="button primary"
                onClick={() => {
                  setFailure(null);
                  setRetry((value) => value + 1);
                }}
              >
                {t("retry")}
              </button>
            )}
          </>
        )}
        {data && (
          <>
            <p className="workspace-invitation-eyebrow">{t("workspaceInvitation")}</p>
            <h1>{data.invitation.workspaceName}</h1>
            {data.invitation.inviterName && (
              <p>{t("invitedBy", { name: data.invitation.inviterName })}</p>
            )}
            <p className="workspace-invitation-access">{t("membersDescription")}</p>
            {!data.user ? (
              <>
                <p className="workspace-invitation-account">
                  {t("invitationFor", { email: data.invitation.emailHint })}
                </p>
                <Link href={loginUrl} className="button primary full" referrerPolicy="no-referrer">
                  {t("signInToJoin")}
                  <ArrowRight size={17} />
                </Link>
              </>
            ) : data.canAccept ? (
              <>
                <p className="workspace-invitation-account">
                  {t("invitationSignedInAs", { email: data.user.email })}
                </p>
                <button
                  className="button primary full"
                  disabled={!!busy}
                  onClick={() => void act("accept")}
                >
                  {busy === "accept" ? (
                    <Spinner label={t("joiningWorkspace")} />
                  ) : (
                    <>
                      {t("joinWorkspace")}
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>
              </>
            ) : (
              <>
                <div className="workspace-invitation-wrong-account">
                  <p>{t("invitationSignedInAs", { email: data.user.email })}</p>
                  <p>{t("invitationWrongAccount", { email: data.invitation.emailHint })}</p>
                </div>
                <button
                  className="button primary full"
                  disabled={!!busy}
                  onClick={() => void act("account")}
                >
                  {busy === "account" ? (
                    <Spinner label={t("changingAccount")} />
                  ) : (
                    <>
                      {t("changeInvitationAccount")}
                      <LogOut size={16} />
                    </>
                  )}
                </button>
              </>
            )}
            <ErrorBanner message={error} />
            <p className="workspace-invitation-expiry">
              {t("invitationExpires", {
                date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long" }).format(
                  new Date(data.invitation.expiresAt),
                ),
              })}
            </p>
          </>
        )}
      </section>
    </main>
  );
}
