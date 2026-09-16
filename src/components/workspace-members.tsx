"use client";
import { Tooltip } from "./tooltip";

import { useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { Mail, RotateCw, Send, UserMinus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { Workspace, WorkspaceInvitation, WorkspaceMember } from "../../shared/types";
import { api } from "@/lib/client";
import { Avatar, ErrorBanner, Modal, Spinner } from "./ui";
import "./workspace-members.css";

type MembersData = { members: WorkspaceMember[]; invitations: WorkspaceInvitation[] };

export function WorkspaceMembers({
  workspace,
  currentUserId,
  onClose,
}: {
  workspace: Workspace;
  currentUserId: string;
  onClose: () => void;
}) {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const owner = workspace.role === "owner";
  const [data, setData] = useState<MembersData | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{
    type: "invitationSent" | "invitationCanceled" | "memberRemoved";
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const action = useRef<AbortController | null>(null);
  const refreshRequest = useRef<AbortController | null>(null);
  const revision = useRef(0);
  const loadFailure = useEffectEvent(() => t("membersLoadError"));
  const endpoint = `/api/workspaces/${workspace.id}`;

  useEffect(() => {
    const controller = new AbortController();
    api<MembersData>(`${endpoint}/members`, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : loadFailure());
      });
    return () => controller.abort();
  }, [endpoint, retry]);
  useEffect(() => () => action.current?.abort(), []);

  const refresh = useEffectEvent(async () => {
    if (
      !data ||
      action.current ||
      confirm ||
      refreshRequest.current ||
      document.visibilityState !== "visible"
    )
      return;
    const controller = new AbortController();
    const startedAtRevision = revision.current;
    refreshRequest.current = controller;
    try {
      const next = await api<MembersData>(`${endpoint}/members`, { signal: controller.signal });
      if (!controller.signal.aborted && startedAtRevision === revision.current) setData(next);
    } catch {
      // Keep the current roster during transient background failures.
    } finally {
      if (refreshRequest.current === controller) refreshRequest.current = null;
    }
  });
  useEffect(() => {
    const timer = setInterval(() => void refresh(), 8000);
    function visibilityChanged() {
      if (document.visibilityState === "visible") void refresh();
      else {
        refreshRequest.current?.abort();
        refreshRequest.current = null;
      }
    }
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      refreshRequest.current?.abort();
      refreshRequest.current = null;
    };
  }, []);

  function interruptRefresh() {
    revision.current++;
    refreshRequest.current?.abort();
    refreshRequest.current = null;
  }

  async function perform(key: string, operation: (signal: AbortSignal) => Promise<void>) {
    if (action.current) return;
    interruptRefresh();
    const controller = new AbortController();
    action.current = controller;
    setBusy(key);
    setError("");
    setNotice(null);
    try {
      await operation(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : t("membersUpdateError"));
    } finally {
      action.current = null;
      if (!controller.signal.aborted) setBusy(null);
    }
  }
  function invite(address: string, key = "invite") {
    return perform(key, async (signal) => {
      const { invitation } = await api<{ invitation: WorkspaceInvitation }>(
        `${endpoint}/invitations`,
        {
          method: "POST",
          body: JSON.stringify({ email: address.trim() }),
          signal,
        },
      );
      if (signal.aborted) return;
      setData(
        (current) =>
          current && {
            ...current,
            invitations: [
              ...current.invitations.filter(
                (item) =>
                  item.id !== invitation.id &&
                  item.email.toLowerCase() !== invitation.email.toLowerCase(),
              ),
              invitation,
            ],
          },
      );
      if (key === "invite") setEmail("");
      setNotice({ type: "invitationSent", name: invitation.email });
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (email.trim()) void invite(email);
  }
  function cancel(invitation: WorkspaceInvitation) {
    void perform(`cancel:${invitation.id}`, async (signal) => {
      await api(`${endpoint}/invitations/${invitation.id}`, { method: "DELETE", signal });
      if (signal.aborted) return;
      setData(
        (current) =>
          current && {
            ...current,
            invitations: current.invitations.filter((item) => item.id !== invitation.id),
          },
      );
      setNotice({ type: "invitationCanceled", name: invitation.email });
    });
  }
  function remove(member: WorkspaceMember) {
    void perform(`remove:${member.user.id}`, async (signal) => {
      await api(`${endpoint}/members/${member.user.id}`, { method: "DELETE", signal });
      if (signal.aborted) return;
      setData(
        (current) =>
          current && {
            ...current,
            members: current.members.filter((item) => item.user.id !== member.user.id),
          },
      );
      setConfirm(null);
      setNotice({ type: "memberRemoved", name: member.user.name });
    });
  }
  return (
    <Modal title={t("membersTitle")} onClose={onClose}>
      <div className="workspace-members">
        <p className="workspace-members-intro">
          <strong>{workspace.name}</strong>
          <span>{t("membersDescription")}</span>
        </p>
        {!data && !error && (
          <div className="workspace-members-loading" role="status">
            <Spinner label={t("membersLoading")} />
          </div>
        )}
        {!data && error && (
          <button
            className="button secondary"
            onClick={() => {
              setError("");
              setRetry((value) => value + 1);
            }}
          >
            {t("retry")}
            <RotateCw size={15} />
          </button>
        )}
        {data && (
          <>
            {owner && (
              <form
                className="workspace-invite-form"
                onSubmit={submit}
                aria-busy={busy === "invite"}
              >
                <label htmlFor="workspace-invite-email">{t("memberEmail")}</label>
                <div>
                  <input
                    id="workspace-invite-email"
                    type="email"
                    autoComplete="email"
                    maxLength={254}
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t("memberEmailPlaceholder")}
                    disabled={!!busy}
                  />
                  <button className="button primary" disabled={!!busy || !email.trim()}>
                    {busy === "invite" ? (
                      <Spinner label={t("inviting")} />
                    ) : (
                      <>
                        {t("inviteMember")}
                        <Send size={15} />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
            <ul className="workspace-member-list" aria-label={t("members")}>
              {data.members.map((member) => (
                <li key={member.user.id}>
                  <div className="workspace-member-row">
                    <Avatar name={member.user.name} />
                    <div className="workspace-member-identity">
                      <strong>{member.user.name}</strong>
                      <span>{member.user.email}</span>
                    </div>
                    <span className="workspace-member-role">
                      {t(member.role === "owner" ? "memberOwner" : "memberRole")}
                    </span>
                    {owner && member.role !== "owner" && member.user.id !== currentUserId && (
                      <Tooltip content={t("removeMember", { name: member.user.name })} asChild>
                        <button
                          className="icon-button"
                          disabled={!!busy}
                          aria-label={t("removeMember", { name: member.user.name })}
                          onClick={() => {
                            interruptRefresh();
                            setConfirm(member.user.id);
                          }}
                        >
                          <UserMinus size={16} />
                        </button>
                      </Tooltip>
                    )}
                  </div>
                  {confirm === member.user.id && (
                    <div
                      className="workspace-member-confirm"
                      role="group"
                      aria-label={t("removeMember", { name: member.user.name })}
                    >
                      <p>{t("removeMemberConfirm", { name: member.user.name })}</p>
                      <p>{t("sharedLinksRemain")}</p>
                      <div>
                        <button
                          className="button secondary"
                          disabled={!!busy}
                          onClick={() => setConfirm(null)}
                        >
                          {t("cancel")}
                        </button>
                        <button
                          className="button secondary workspace-remove-confirm"
                          disabled={!!busy}
                          onClick={() => remove(member)}
                        >
                          {busy === `remove:${member.user.id}` ? (
                            <Spinner label={t("removing")} />
                          ) : (
                            t("confirmRemoveMember")
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {owner && data.invitations.length > 0 && (
              <section
                className="workspace-pending-invitations"
                aria-labelledby="workspace-pending-title"
              >
                <h3 id="workspace-pending-title">{t("pendingInvitations")}</h3>
                <ul>
                  {data.invitations.map((invitation) => (
                    <li key={invitation.id}>
                      <span className="workspace-invitation-icon" aria-hidden="true">
                        <Mail size={17} />
                      </span>
                      <div className="workspace-member-identity">
                        <strong>{invitation.email}</strong>
                        <span>
                          {t("invitationExpires", {
                            date: new Intl.DateTimeFormat(locale, {
                              day: "numeric",
                              month: "short",
                            }).format(new Date(invitation.expiresAt)),
                          })}
                        </span>
                      </div>
                      <div className="workspace-invitation-actions">
                        <button
                          className="text-button"
                          disabled={!!busy}
                          aria-label={t("resendInvitationTo", { email: invitation.email })}
                          onClick={() => void invite(invitation.email, `resend:${invitation.id}`)}
                        >
                          {t("resendInvitation")}
                        </button>
                        <Tooltip
                          content={t("cancelInvitationTo", { email: invitation.email })}
                          asChild
                        >
                          <button
                            className="text-button"
                            disabled={!!busy}
                            aria-label={t("cancelInvitationTo", { email: invitation.email })}
                            onClick={() => cancel(invitation)}
                          >
                            {t("cancel")}
                          </button>
                        </Tooltip>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        {notice && (
          <p className="workspace-members-notice" role="status">
            {t(notice.type, { name: notice.name })}
          </p>
        )}
        <ErrorBanner message={error} />
      </div>
    </Modal>
  );
}
