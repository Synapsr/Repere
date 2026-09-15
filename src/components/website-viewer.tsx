"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, Link2 } from "lucide-react";
import type { Feedback, WebsiteAnchor } from "../../shared/types";
import type { PreviewCommand, PreviewEvent, PreviewSession } from "../../shared/preview";
import { parseWebsiteAnchorForOrigin } from "../../shared/validation";
import { api } from "@/lib/client";
import { Spinner } from "./ui";

type Props = {
  token: string;
  url: string;
  mode: "browse" | "comment";
  comments: Feedback[];
  draft: WebsiteAnchor | null;
  onAnchor: (anchor: WebsiteAnchor) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  focus: Feedback | null;
  viewport: "desktop" | "mobile";
  controlsHost: HTMLElement | null;
};
type CommandPayload = PreviewCommand extends infer Message
  ? Message extends PreviewCommand
    ? Omit<Message, "source" | "channel">
    : never
  : never;

export function WebsiteViewer({
  token,
  url,
  mode,
  comments,
  draft,
  onAnchor,
  selected,
  onSelect,
  focus,
  viewport,
  controlsHost,
}: Props) {
  const t = useTranslations("website");
  const locale = useLocale();
  const iframe = useRef<HTMLIFrameElement>(null);
  const [session, setSession] = useState<PreviewSession | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState<
    "timeout" | "openFailed" | "otherSite" | "invalidAddress" | null
  >(null);
  const [currentUrl, setCurrentUrl] = useState(url);
  const [address, setAddress] = useState(url);
  const [retry, setRetry] = useState(0);
  const [readyEpoch, setReadyEpoch] = useState(0);
  const readinessTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const callbacks = useRef({
    onAnchor,
    onSelect,
    mode,
    commentIds: new Set(comments.map((comment) => comment.id)),
  });
  useEffect(() => {
    callbacks.current = {
      onAnchor,
      onSelect,
      mode,
      commentIds: new Set(comments.map((comment) => comment.id)),
    };
  }, [onAnchor, onSelect, mode, comments]);
  const armReadinessTimeout = useCallback(() => {
    if (readinessTimer.current) clearTimeout(readinessTimer.current);
    readinessTimer.current = setTimeout(() => {
      setStatus("error");
      setErrorCode("timeout");
    }, 30000);
  }, []);
  const send = useCallback(
    (message: CommandPayload) => {
      if (session)
        iframe.current?.contentWindow?.postMessage(
          { ...message, source: "repere", channel: session.channel },
          session.origin,
        );
    },
    [session],
  );

  useEffect(() => {
    const controller = new AbortController();
    api<PreviewSession>(`/api/reviews/${token}/preview`, {
      method: "POST",
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setSession(result);
        setCurrentUrl(result.targetUrl);
        setAddress(result.targetUrl);
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          if (e instanceof Error) setError(e.message);
          else setErrorCode("openFailed");
          setStatus("error");
        }
      });
    return () => controller.abort();
  }, [token, retry]);

  useEffect(() => {
    if (!session) return;
    armReadinessTimeout();
    function receive(event: MessageEvent<PreviewEvent>) {
      if (
        event.source !== iframe.current?.contentWindow ||
        event.origin !== session!.origin ||
        event.data?.source !== "repere-preview" ||
        event.data.channel !== session!.channel
      )
        return;
      const message = event.data;
      if (message.type === "ready" || message.type === "location") {
        try {
          const next = new URL(message.url);
          if (next.origin !== new URL(session!.targetUrl).origin) return;
          if (readinessTimer.current) clearTimeout(readinessTimer.current);
          if (message.type === "ready") setReadyEpoch((epoch) => epoch + 1);
          setStatus("ready");
          setError("");
          setErrorCode(null);
          setCurrentUrl(next.href);
          setAddress(next.href);
        } catch {
          /* Untrusted frame messages never become navigation targets. */
        }
      }
      if (message.type === "anchor" && callbacks.current.mode === "comment") {
        const anchor = parseWebsiteAnchorForOrigin(message.anchor, session!.targetUrl);
        if (anchor) callbacks.current.onAnchor(anchor);
      }
      if (
        message.type === "select" &&
        typeof message.id === "string" &&
        callbacks.current.commentIds.has(message.id)
      )
        callbacks.current.onSelect(message.id);
      if (message.type === "error" && typeof message.message === "string") {
        if (readinessTimer.current) clearTimeout(readinessTimer.current);
        setError(message.message.slice(0, 500));
        setStatus("error");
      }
    }
    window.addEventListener("message", receive);
    return () => {
      if (readinessTimer.current) clearTimeout(readinessTimer.current);
      window.removeEventListener("message", receive);
    };
  }, [session, armReadinessTimeout]);
  useEffect(() => {
    if (status === "ready") send({ type: "mode", mode });
  }, [mode, send, status, currentUrl, readyEpoch]);
  useEffect(() => {
    if (status === "ready")
      send({
        type: "pins",
        selected,
        pins: comments
          .filter((c) => c.anchor.type === "website" && c.anchor.url === currentUrl)
          .slice(0, 500)
          .map((c) => ({
            id: c.id,
            number: c.number,
            status: c.status,
            anchor: c.anchor as WebsiteAnchor,
          })),
      });
  }, [comments, selected, send, status, currentUrl, readyEpoch]);
  useEffect(() => {
    if (focus?.anchor.type === "website" && status === "ready")
      send({ type: "focus", anchor: focus.anchor });
  }, [focus, send, status]);
  useEffect(() => {
    if (status === "ready") send({ type: "draft", anchor: draft });
  }, [draft, send, status, readyEpoch]);
  useEffect(() => {
    if (status === "ready") send({ type: "locale", locale });
  }, [locale, send, status, currentUrl, readyEpoch]);

  function navigate() {
    if (!session) return;
    try {
      const next = new URL(address, currentUrl);
      if (next.origin !== new URL(session.targetUrl).origin) {
        setErrorCode("otherSite");
        return;
      }
      setError("");
      setErrorCode(null);
      send({ type: "navigate", url: next.href });
    } catch {
      setErrorCode("invalidAddress");
    }
  }
  function reconnect() {
    setStatus("loading");
    setError("");
    setErrorCode(null);
    setSession(null);
    setRetry((value) => value + 1);
  }
  const errorMessage = errorCode ? t(errorCode) : error;
  return (
    <div className="website-viewer">
      {controlsHost &&
        createPortal(
          <form
            className="website-menu-controls"
            aria-label={t("navigation")}
            onSubmit={(event) => {
              event.preventDefault();
              navigate();
            }}
          >
            <label htmlFor="review-page-address">{t("address")}</label>
            <div className="website-menu-address">
              <input
                id="review-page-address"
                aria-label={t("address")}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
              <button className="icon-button" aria-label={t("go")} title={t("go")}>
                <ArrowRight size={16} />
              </button>
            </div>
            <div className="website-menu-actions">
              <button
                type="button"
                className="icon-button"
                title={t("back")}
                aria-label={t("back")}
                onClick={() => send({ type: "back" })}
              >
                <ArrowLeft size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                title={t("forward")}
                aria-label={t("forward")}
                onClick={() => send({ type: "forward" })}
              >
                <ArrowRight size={16} />
              </button>
              <button
                type="button"
                className="icon-button"
                title={t("reload")}
                aria-label={t("reload")}
                onClick={() => send({ type: "reload" })}
              >
                <RotateCw size={15} />
              </button>
              <a
                className="icon-button"
                href={currentUrl}
                target="_blank"
                rel="noopener noreferrer"
                title={t("openExternal")}
                aria-label={t("openExternal")}
              >
                <ExternalLink size={15} />
              </a>
            </div>
          </form>,
          controlsHost,
        )}
      <div
        className={`browser-shell native-shell ${viewport === "mobile" ? "mobile-preview" : ""}`}
      >
        {session && (
          <iframe
            ref={iframe}
            title={t("frame")}
            className="native-preview"
            src={session.url}
            style={{ width: viewport === "mobile" ? "min(390px,100%)" : "100%" }}
            sandbox="allow-scripts allow-forms allow-same-origin allow-pointer-lock allow-presentation allow-popups allow-popups-to-escape-sandbox allow-downloads"
            allow="fullscreen"
            referrerPolicy="no-referrer"
            onLoad={() => {
              armReadinessTimeout();
              send({ type: "init" });
              send({ type: "locale", locale });
              send({ type: "mode", mode });
            }}
          />
        )}
        {status === "loading" && (
          <div className="viewer-state">
            <Spinner label={t("loading")} />
          </div>
        )}
        {status === "error" && (
          <div className="viewer-state">
            <Link2 size={26} />
            <h3>{t("retryTitle")}</h3>
            <p>{errorMessage}</p>
            <button className="button primary" onClick={reconnect}>
              {t("retry")}
              <RotateCw size={15} />
            </button>
          </div>
        )}
      </div>
      {errorMessage && status === "ready" && (
        <div className="viewer-notice" role="status">
          {errorMessage}
          <button
            onClick={() => {
              setError("");
              setErrorCode(null);
            }}
            aria-label={t("dismiss")}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
