"use client";
import { useCallback, useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  MousePointer2,
  MessageCircle,
  MessageCirclePlus,
  Share2,
  Monitor,
  Smartphone,
  Check,
  X,
  ArrowUpRight,
  Send,
  CheckCircle2,
  Circle,
  ChevronDown,
  Archive,
  RotateCcw,
  Copy,
  SlidersHorizontal,
  FileText,
  Globe,
  MoreHorizontal,
  CircleHelp,
} from "lucide-react";
import type { Anchor, CaptureInput, Feedback, ReviewData, Workspace } from "../../shared/types";
import { api, relativeDate } from "@/lib/client";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Logo, Avatar, Modal, Spinner, ErrorBanner } from "./ui";
import { AuthForm } from "./auth";
import { WebsiteViewer } from "./website-viewer";
import { CopyPromptButton } from "./copy-prompt-button";
import { CommentCapture } from "./comment-capture";
import { ReviewOnboarding } from "./review-onboarding";
import "./review.css";

function PdfLoading() {
  const t = useTranslations("pdf");
  return (
    <div className="center-page">
      <Spinner label={t("loading")} />
    </div>
  );
}
const PdfViewer = dynamic(() => import("./pdf-viewer").then((m) => m.PdfViewer), {
  ssr: false,
  loading: PdfLoading,
});

type DraftCapture = {
  result: Promise<CaptureInput | null>;
  resolve: (value: CaptureInput | null) => void;
};

export function Review({ token }: { token: string }) {
  const t = useTranslations("review");
  const [data, setData] = useState<ReviewData | null>(null);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"browse" | "comment">("browse");
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<Feedback | null>(null);
  const [filter, setFilter] = useState<"open" | "resolved" | "all">("open");
  const [pendingAnchor, setPendingAnchor] = useState<Anchor | null>(null);
  const capture = useRef<DraftCapture | null>(null);
  const captureId = useRef<string | null>(null);
  const captureTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitting = useRef(false);
  const clearDraft = useCallback(() => {
    captureId.current = null;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    setPendingAnchor(null);
    capture.current?.resolve(null);
    capture.current = null;
  }, []);
  useEffect(
    () => () => {
      captureId.current = null;
      capture.current?.resolve(null);
      capture.current = null;
      if (captureTimer.current) clearTimeout(captureTimer.current);
    },
    [],
  );
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(false);
  const [settings, setSettings] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [showSidebar, setShowSidebar] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [controlsHost, setControlsHost] = useState<HTMLDivElement | null>(null);
  const options = useRef<HTMLDetailsElement>(null);
  const loadFailure = useEffectEvent(() => t("notFound"));
  const refresh = useCallback(async () => {
    const next = await api<ReviewData>(`/api/reviews/${token}`);
    setData(next);
    if (next.project.archived) {
      setMode("browse");
      clearDraft();
      setBody("");
    }
    return next;
  }, [token, clearDraft]);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const next = await api<ReviewData>(`/api/reviews/${token}`);
        if (active) setData(next);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : loadFailure());
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [token]);
  useEffect(() => {
    if (!data?.user?.id) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh().catch(() => {});
    }, 8000);
    return () => clearInterval(timer);
  }, [data?.user?.id, refresh]);
  useEffect(() => {
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !options.current?.contains(event.target) &&
        options.current
      )
        options.current.open = false;
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape" && options.current?.open) {
        options.current.open = false;
        options.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting.current || data?.project.archived || !pendingAnchor || !body.trim()) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    const draftCapture = capture.current;
    try {
      const image = await draftCapture?.result;
      // A cancelled or archived draft must not publish after its capture settles.
      if (capture.current !== draftCapture) return;
      const { comment } = await api<{ comment: Feedback }>(`/api/reviews/${token}/comments`, {
        method: "POST",
        body: JSON.stringify({
          body: body.trim(),
          anchor: pendingAnchor,
          ...(image ? { capture: image } : {}),
        }),
      });
      // The POST committed both records. A later refresh failure must not leave a
      // publishable draft that would duplicate the comment and its image.
      setData((current) =>
        current
          ? {
              ...current,
              comments: [...current.comments.filter((item) => item.id !== comment.id), comment],
            }
          : current,
      );
      setSelected(comment.id);
      setBody("");
      clearDraft();
      setFilter("open");
      void refresh().catch(() => {});
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sendFailed"));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function updateStatus(comment: Feedback) {
    if (data?.project.archived) return;
    setError("");
    try {
      await api(`/api/reviews/${token}/comments/${comment.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: comment.status === "open" ? "resolved" : "open" }),
      });
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("updateFailed"));
    }
  }
  function choose(id: string) {
    setSelected(id);
    setShowSidebar(true);
    const comment = data?.comments.find((c) => c.id === id);
    if (comment) {
      setFocus({ ...comment });
      if (filter !== "all" && filter !== comment.status) setFilter(comment.status);
    }
  }
  function receivedCapture(id: string, value: CaptureInput | null) {
    if (captureId.current !== id) return;
    captureId.current = null;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureTimer.current = null;
    capture.current?.resolve(value);
  }
  function anchor(value: Anchor, id: string | null) {
    if (data?.project.archived || submitting.current) return false;
    if (captureTimer.current) clearTimeout(captureTimer.current);
    captureId.current = id;
    capture.current?.resolve(null);
    let resolve!: DraftCapture["resolve"];
    const result = new Promise<CaptureInput | null>((complete) => {
      resolve = complete;
    });
    capture.current = { result, resolve };
    if (!id) resolve(null);
    if (id) captureTimer.current = setTimeout(() => receivedCapture(id, null), 15_000);
    setPendingAnchor(value);
    setShowSidebar(true);
    setSelected(null);
    setError("");
    return true;
  }
  if (!data)
    return (
      <main className="center-page">
        <Logo />
        {error ? (
          <>
            <ErrorBanner message={error} />
            <Link className="button secondary" href="/">
              {t("home")}
            </Link>
          </>
        ) : (
          <Spinner label={t("loading")} />
        )}
      </main>
    );
  if (!data.user)
    return (
      <main className="review-auth">
        <header>
          <Logo />
          <span className="pill">{t("invitation")}</span>
          <LanguageSwitcher compact />
        </header>
        <div className="review-auth-content">
          <div className="invited-project">
            <span className="invited-icon">
              {data.project.type === "website" ? <Globe size={24} /> : <FileText size={24} />}
            </span>
            <span>{t("welcome")}</span>
            <h2>{data.project.name}</h2>
            <p>{t("inviteDescription")}</p>
            <div className="invite-decoration" aria-hidden="true">
              <span>1</span>
              <span>2</span>
              <span>3</span>
            </div>
          </div>
          <AuthForm
            compact
            onSuccess={async () => {
              try {
                await refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : t("loadFailed"));
              }
            }}
          />
        </div>
        <ErrorBanner message={error} />
      </main>
    );
  const project = data.project;
  const readOnly = project.archived;
  const effectiveMode = readOnly ? "browse" : mode;
  const comments = data.comments.filter((c) => filter === "all" || c.status === filter);
  const openCount = data.comments.filter((c) => c.status === "open").length;
  return (
    <div className="review-layout">
      <header className="review-header">
        <div className="review-project-heading">
          <Link
            href={data.canManage ? `/?workspace=${project.workspaceId}` : "/"}
            className="icon-button"
            aria-label={t("back")}
          >
            <ArrowLeft size={19} />
          </Link>
          <h1 title={project.name}>{project.name}</h1>
          {readOnly && (
            <span className="review-archived" title={t("archived")}>
              <Archive size={15} />
            </span>
          )}
        </div>
        <div className="mode-switch" role="group" aria-label={t("mode")}>
          <button
            className={effectiveMode === "browse" ? "active" : ""}
            aria-pressed={effectiveMode === "browse"}
            disabled={busy}
            onClick={() => {
              setMode("browse");
              clearDraft();
            }}
          >
            <MousePointer2 size={15} />
            <span>{t("browse")}</span>
          </button>
          <button
            className={effectiveMode === "comment" ? "active" : ""}
            aria-pressed={effectiveMode === "comment"}
            onClick={() => setMode("comment")}
            disabled={busy || readOnly}
          >
            <MessageCirclePlus size={15} />
            <span>{t("comment")}</span>
          </button>
        </div>
        <div className="review-header-actions">
          <button
            className="icon-button review-mobile-comments"
            aria-label={t("showFeedback")}
            aria-expanded={showSidebar}
            onClick={() => setShowSidebar((value) => !value)}
          >
            <MessageCircle size={18} />
          </button>
          <button
            className="button primary share-button"
            onClick={() => setShare(true)}
            disabled={readOnly}
            title={readOnly ? t("shareArchived") : undefined}
            aria-label={t("share")}
          >
            <Share2 size={15} />
            <span>{t("share")}</span>
          </button>
          <details className="review-options" ref={options}>
            <summary className="icon-button" aria-label={t("options")} title={t("options")}>
              <MoreHorizontal size={21} />
            </summary>
            <div className="review-options-panel">
              <div ref={setControlsHost} />
              {project.type === "website" && !readOnly && (
                <div className="review-option-row">
                  <span>{t("viewport")}</span>
                  <div className="viewport-switch" role="group" aria-label={t("viewport")}>
                    <button
                      className={viewport === "desktop" ? "active" : ""}
                      aria-label={t("desktop")}
                      aria-pressed={viewport === "desktop"}
                      onClick={() => setViewport("desktop")}
                    >
                      <Monitor size={17} />
                    </button>
                    <button
                      className={viewport === "mobile" ? "active" : ""}
                      aria-label={t("mobile")}
                      aria-pressed={viewport === "mobile"}
                      onClick={() => setViewport("mobile")}
                    >
                      <Smartphone size={16} />
                    </button>
                  </div>
                </div>
              )}
              <div className="review-option-row">
                <span>{t("language")}</span>
                <LanguageSwitcher compact />
              </div>
              {project.type === "website" && !readOnly && (
                <button
                  className="review-option-action"
                  onClick={() => {
                    if (options.current) options.current.open = false;
                    setOnboardingOpen(true);
                  }}
                >
                  <CircleHelp size={16} />
                  {t("onboardingReplay")}
                </button>
              )}
              {data.canManage && (
                <button
                  className="review-option-action"
                  onClick={() => {
                    if (options.current) options.current.open = false;
                    setSettings(true);
                  }}
                >
                  <SlidersHorizontal size={16} />
                  {t("settings")}
                </button>
              )}
            </div>
          </details>
        </div>
      </header>
      <div className={`review-body ${showSidebar ? "sidebar-open" : ""}`}>
        <main className="review-canvas">
          {project.type === "website" && readOnly ? (
            <div className="viewer-archived" role="status">
              <Archive size={28} />
              <h2>{t("archivedTitle")}</h2>
              <p>{t("archivedDescription")}</p>
              {data.canManage && (
                <button className="button secondary" onClick={() => setSettings(true)}>
                  {t("settings")}
                </button>
              )}
            </div>
          ) : project.type === "website" && project.url ? (
            <WebsiteViewer
              token={token}
              url={project.url}
              mode={effectiveMode}
              comments={comments}
              draft={pendingAnchor?.type === "website" ? pendingAnchor : null}
              onAnchor={anchor}
              onCapture={receivedCapture}
              selected={selected}
              onSelect={choose}
              focus={focus}
              viewport={viewport}
              controlsHost={controlsHost}
            />
          ) : (
            <PdfViewer
              token={token}
              mode={effectiveMode}
              comments={comments}
              onAnchor={anchor}
              onCapture={receivedCapture}
              selected={selected}
              onSelect={choose}
              focus={focus}
              controlsHost={controlsHost}
            />
          )}
        </main>
        <aside className="feedback-sidebar" aria-label={t("feedback")}>
          <div className="feedback-heading">
            <h2>
              {t("feedback")}
              <span>{data.comments.length}</span>
            </h2>
            <div className="feedback-heading-actions">
              {data.canManage && openCount > 0 && filter !== "resolved" && (
                <CopyPromptButton projectId={project.id} onError={setError} />
              )}
              <button
                className="icon-button review-mobile-comments"
                aria-label={t("hideFeedback")}
                onClick={() => setShowSidebar(false)}
              >
                <X size={17} />
              </button>
            </div>
          </div>
          <div className="feedback-filters">
            <button
              className={filter === "open" ? "active" : ""}
              aria-pressed={filter === "open"}
              onClick={() => setFilter("open")}
            >
              {t("open")}
              <span>{openCount}</span>
            </button>
            <button
              className={filter === "resolved" ? "active" : ""}
              aria-pressed={filter === "resolved"}
              onClick={() => setFilter("resolved")}
            >
              {t("resolved")}
              <span>{data.comments.length - openCount}</span>
            </button>
            <button
              className={filter === "all" ? "active" : ""}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              {t("all")}
            </button>
          </div>
          <ErrorBanner message={error} />
          <div className="feedback-scroll">
            {pendingAnchor && !readOnly && (
              <form className="new-feedback" onSubmit={submit}>
                <div className="new-feedback-title">
                  <span className="draft-pin">
                    <MessageCircle size={15} />
                  </span>
                  <strong>{t("newComment")}</strong>
                  <button
                    className="icon-button"
                    type="button"
                    aria-label={t("cancelComment")}
                    onClick={clearDraft}
                    disabled={busy}
                  >
                    <X size={16} />
                  </button>
                </div>
                {pendingAnchor.type === "pdf" && (
                  <span className="anchor-location">
                    {t("page", { number: pendingAnchor.page })}
                  </span>
                )}
                <textarea
                  aria-label={t("yourComment")}
                  placeholder={t("commentPlaceholder")}
                  value={body}
                  maxLength={10000}
                  disabled={busy}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  autoFocus
                  required
                />
                <div className="new-feedback-footer">
                  <Avatar name={data.user.name} size="small" />
                  <button className="button primary" disabled={busy || !body.trim()}>
                    {busy ? (
                      <Spinner label={t("sending")} />
                    ) : (
                      <>
                        {t("publish")}
                        <Send size={14} />
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
            {comments.length
              ? comments.map((comment) => (
                  <FeedbackCard
                    key={comment.id}
                    comment={comment}
                    selected={selected === comment.id}
                    onSelect={() => choose(comment.id)}
                    onStatus={() => updateStatus(comment)}
                    canResolve={
                      !readOnly && (data.canManage || data.user?.id === comment.author.id)
                    }
                    canCopyPrompt={data.canManage && comment.status === "open"}
                    onPromptError={setError}
                    readOnly={readOnly}
                    token={token}
                    onReply={refresh}
                  />
                ))
              : (!pendingAnchor || readOnly) && (
                  <div className="feedback-empty">
                    <MessageCircle size={25} aria-hidden="true" />
                    <h3>
                      {filter === "resolved"
                        ? t("emptyResolved")
                        : data.comments.length
                          ? t("emptyOpen")
                          : t("empty")}
                    </h3>
                    {!readOnly && (
                      <p>
                        {filter === "resolved"
                          ? t("emptyResolvedHint")
                          : !data.comments.length
                            ? t("emptyHint")
                            : null}
                      </p>
                    )}
                  </div>
                )}
          </div>
        </aside>
      </div>
      {project.type === "website" && !readOnly && (
        <ReviewOnboarding
          autoShow={!data.canManage}
          open={onboardingOpen}
          onClose={() => setOnboardingOpen(false)}
        />
      )}
      {share && (
        <Modal title={t("shareTitle")} onClose={() => setShare(false)}>
          <p className="modal-description">
            {readOnly ? t("shareArchivedDescription") : t("shareDescription")}
          </p>
          <label htmlFor="share-url">{t("shareLink")}</label>
          <div className="share-input">
            <input
              id="share-url"
              readOnly
              value={
                typeof window !== "undefined"
                  ? `${window.location.origin}/r/${project.shareToken}`
                  : ""
              }
              onFocus={(e) => e.target.select()}
            />
            <button
              className="button primary"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(
                    `${window.location.origin}/r/${project.shareToken}`,
                  );
                  setShareCopied(true);
                } catch {
                  document.getElementById("share-url")?.focus();
                }
              }}
            >
              {shareCopied ? <Check size={16} /> : <Copy size={16} />}
              {shareCopied ? t("copied") : t("copy")}
            </button>
          </div>
        </Modal>
      )}
      {settings && (
        <ProjectSettings data={data} onClose={() => setSettings(false)} onUpdated={refresh} />
      )}
    </div>
  );
}

function FeedbackCard({
  comment,
  selected,
  onSelect,
  onStatus,
  canResolve,
  canCopyPrompt,
  onPromptError,
  readOnly,
  token,
  onReply,
}: {
  comment: Feedback;
  selected: boolean;
  onSelect: () => void;
  onStatus: () => void;
  canResolve: boolean;
  canCopyPrompt: boolean;
  onPromptError: (message: string) => void;
  readOnly: boolean;
  token: string;
  onReply: () => Promise<unknown>;
}) {
  const t = useTranslations("review");
  const locale = useLocale();
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (readOnly || !reply.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/reviews/${token}/comments/${comment.id}/replies`, {
        method: "POST",
        body: JSON.stringify({ body: reply.trim() }),
      });
      setReply("");
      await onReply();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sendFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className={`feedback-card ${selected ? "selected" : ""}`}>
      <div className="feedback-card-heading">
        <button
          className="feedback-select"
          onClick={onSelect}
          aria-label={t("openComment", { number: comment.number })}
        >
          <span className={`feedback-number ${comment.status === "resolved" ? "resolved" : ""}`}>
            {comment.number}
          </span>
          <span className="feedback-author-name">{comment.author.name}</span>
          <ArrowUpRight size={13} />
        </button>
        <div className="feedback-card-actions">
          {canCopyPrompt && (
            <CopyPromptButton
              projectId={comment.projectId}
              commentId={comment.id}
              onError={onPromptError}
            />
          )}
          {comment.screenshot && (
            <CommentCapture
              src={`/api/reviews/${token}/comments/${comment.id}/screenshot`}
              pointX={comment.screenshot.pointX}
              pointY={comment.screenshot.pointY}
              number={comment.number}
            />
          )}
          {canResolve && (
            <button
              className={`resolve-button ${comment.status === "resolved" ? "resolved" : ""}`}
              aria-label={t(comment.status === "resolved" ? "reopenComment" : "resolveComment", {
                number: comment.number,
              })}
              title={t(comment.status === "resolved" ? "reopen" : "resolve")}
              onClick={onStatus}
            >
              {comment.status === "resolved" ? <CheckCircle2 size={19} /> : <Circle size={19} />}
            </button>
          )}
        </div>
      </div>
      <button className="feedback-content" onClick={onSelect}>
        <span className="feedback-text">{comment.body}</span>
      </button>
      <div className="feedback-card-meta">
        <time dateTime={comment.createdAt}>{relativeDate(comment.createdAt, locale)}</time>
        <button className="reply-expand" onClick={onSelect}>
          <MessageCircle size={12} />
          {comment.replies.length
            ? t("replyCount", { count: comment.replies.length })
            : readOnly
              ? t("readOnly")
              : t("reply")}
          <ChevronDown size={12} />
        </button>
      </div>
      {selected && (
        <div className="replies">
          {comment.replies.map((item) => (
            <div className="reply" key={item.id}>
              <div className="comment-author">
                <Avatar name={item.author.name} size="small" />
                <div>
                  <strong>{item.author.name}</strong>
                  <span>{relativeDate(item.createdAt, locale)}</span>
                </div>
              </div>
              <p>{item.body}</p>
            </div>
          ))}
          {readOnly ? (
            <p className="field-help">{t("conversationReadOnly")}</p>
          ) : (
            <form onSubmit={submit}>
              <textarea
                aria-label={t("replyTo", { number: comment.number })}
                rows={2}
                placeholder={t("replyPlaceholder")}
                maxLength={10000}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                required
              />
              <ErrorBanner message={error} />
              <button className="button primary reply-submit" disabled={busy || !reply.trim()}>
                {busy ? t("sending") : t("reply")}
                <Send size={13} />
              </button>
            </form>
          )}
        </div>
      )}
    </article>
  );
}

function ProjectSettings({
  data,
  onClose,
  onUpdated,
}: {
  data: ReviewData;
  onClose: () => void;
  onUpdated: () => Promise<unknown>;
}) {
  const t = useTranslations("review");
  const router = useRouter();
  const [name, setName] = useState(data.project.name);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rotate, setRotate] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState(data.project.workspaceId);
  const [workspaceError, setWorkspaceError] = useState("");
  const workspaceFailure = useEffectEvent(() => t("workspaceLoadError"));
  useEffect(() => {
    const controller = new AbortController();
    api<{ workspaces: Workspace[] }>("/api/workspaces", { signal: controller.signal })
      .then(({ workspaces }) => {
        if (!controller.signal.aborted) setWorkspaces(workspaces);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setWorkspaceError(error instanceof Error ? error.message : workspaceFailure());
      });
    return () => controller.abort();
  }, []);
  async function update(values: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ project: ReviewData["project"] }>(
        `/api/projects/${data.project.id}`,
        { method: "PATCH", body: JSON.stringify(values) },
      );
      if (values.rotateShareToken) {
        router.replace(`/r/${result.project.shareToken}`);
        return;
      }
      await onUpdated();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("updateFailed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={t("settings")} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void update({ name });
        }}
      >
        <label htmlFor="settings-name">{t("projectName")}</label>
        <input
          id="settings-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={120}
        />
        <button className="button primary settings-save" disabled={busy}>
          {t("save")}
          <Check size={15} />
        </button>
      </form>
      {(workspaces.length > 1 || workspaceError) && (
        <div className="settings-section">
          <h3>{t("moveTitle")}</h3>
          <p>{t("moveDescription")}</p>
          <ErrorBanner message={workspaceError} />
          {workspaces.length > 1 && (
            <form
              className="workspace-move-form"
              onSubmit={(event) => {
                event.preventDefault();
                void update({ workspaceId });
              }}
            >
              <label htmlFor="project-workspace">{t("destinationWorkspace")}</label>
              <select
                id="project-workspace"
                value={workspaceId}
                onChange={(event) => setWorkspaceId(event.target.value)}
                disabled={busy}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    {workspace.name}
                  </option>
                ))}
              </select>
              <button
                className="button secondary"
                disabled={busy || workspaceId === data.project.workspaceId}
              >
                {t("moveProject")}
                <ArrowUpRight size={15} />
              </button>
            </form>
          )}
        </div>
      )}
      <div className="settings-section">
        <h3>{t(data.project.archived ? "unarchiveTitle" : "archiveTitle")}</h3>
        <p>{t(data.project.archived ? "unarchiveDescription" : "archiveDescription")}</p>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => update({ archived: !data.project.archived })}
        >
          <Archive size={16} />
          {t(data.project.archived ? "unarchiveAction" : "archiveAction")}
        </button>
      </div>
      <div className="settings-section">
        <h3>{t("renewTitle")}</h3>
        <p>{t(rotate ? "renewConfirmDescription" : "renewDescription")}</p>
        <button
          className="button secondary"
          disabled={busy}
          onClick={() => (rotate ? update({ rotateShareToken: true }) : setRotate(true))}
        >
          <RotateCcw size={15} />
          {t(rotate ? "renewConfirm" : "renew")}
        </button>
      </div>
      <ErrorBanner message={error} />
    </Modal>
  );
}
