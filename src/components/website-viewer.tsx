"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, RotateCw, ExternalLink, Link2 } from "lucide-react";
import type { CaptureInput, Feedback, WebsiteAnchor } from "../../shared/types";
import type { PreviewCommand, PreviewEvent, PreviewSession } from "../../shared/preview";
import { parseWebsiteAnchorForOrigin } from "../../shared/validation";
import { parseCaptureInput } from "../../shared/capture";
import { api } from "@/lib/client";
import { Spinner } from "./ui";

const OPEN_TIMEOUT_MS = 25_000;

type Props = {
  token: string;
  url: string;
  mode: "browse" | "comment";
  comments: Feedback[];
  draft: WebsiteAnchor | null;
  onAnchor: (anchor: WebsiteAnchor, captureId: string | null) => boolean;
  onCapture: (captureId: string, capture: CaptureInput | null) => void;
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
  onCapture,
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
    onCapture,
    draft,
    onSelect,
    mode,
    commentIds: new Set(comments.map((comment) => comment.id)),
  });
  useEffect(() => {
    callbacks.current = {
      onAnchor,
      onCapture,
      draft,
      onSelect,
      mode,
      commentIds: new Set(comments.map((comment) => comment.id)),
    };
  }, [onAnchor, onCapture, draft, onSelect, mode, comments]);
  const clearReadinessTimeout = useCallback(() => {
    if (readinessTimer.current) clearTimeout(readinessTimer.current);
    readinessTimer.current = null;
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
    // One deadline covers both the API request and the frame handshake. Frame
    // reloads must not extend it, and a ready frame must not restart it.
    const timer = setTimeout(() => {
      controller.abort();
      readinessTimer.current = null;
      setSession(null);
      setError("");
      setErrorCode("timeout");
      setStatus("error");
    }, OPEN_TIMEOUT_MS);
    readinessTimer.current = timer;
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
          clearReadinessTimeout();
          if (e instanceof Error) setError(e.message);
          else setErrorCode("openFailed");
          setStatus("error");
        }
      });
    return () => {
      controller.abort();
      clearTimeout(timer);
      if (readinessTimer.current === timer) readinessTimer.current = null;
    };
  }, [token, retry, clearReadinessTimeout]);

  useEffect(() => {
    if (!session) return;
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
          clearReadinessTimeout();
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
        if (anchor) {
          const accepted = callbacks.current.onAnchor(
            anchor,
            typeof message.captureId === "string" && /^[a-zA-Z0-9-]{1,64}$/.test(message.captureId)
              ? message.captureId
              : null,
          );
          // A slow submission can reject a new point. Restore the existing pin
          // immediately so a failed POST never leaves its draft at another place.
          if (!accepted) send({ type: "draft", anchor: callbacks.current.draft });
        }
      }
      if (
        message.type === "capture" &&
        typeof message.captureId === "string" &&
        message.captureId.length <= 64
      ) {
        callbacks.current.onCapture(message.captureId, parseCaptureInput(message.capture));
      }
      if (
        message.type === "select" &&
        typeof message.id === "string" &&
        callbacks.current.commentIds.has(message.id)
      )
        callbacks.current.onSelect(message.id);
      if (message.type === "error" && typeof message.message === "string") {
        clearReadinessTimeout();
        setErrorCode(null);
        setError(message.message.slice(0, 500));
        setStatus("error");
      }
    }
    window.addEventListener("message", receive);
    return () => {
      window.removeEventListener("message", receive);
    };
  }, [session, clearReadinessTimeout, send]);
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
          <div className="viewer-state" role="status">
            <Link2 size={26} />
            <h3>{t("retryTitle")}</h3>
            <p>{errorMessage}</p>
            <button className="button primary" onClick={reconnect}>
              {t("retry")}
              <RotateCw size={15} />
            </button>
            <a
              className="button secondary"
              href={currentUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("openExternal")}
              <ExternalLink size={15} />
            </a>
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
