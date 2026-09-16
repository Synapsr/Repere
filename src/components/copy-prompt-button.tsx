"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ClipboardCopy, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/client";
import { Modal } from "./ui";
import { Tooltip } from "./tooltip";

export function CopyPromptButton({
  projectId,
  commentId,
  onError,
  variant = "icon",
  onAction,
}: {
  projectId: string;
  commentId?: string;
  onError: (message: string) => void;
  variant?: "icon" | "menu";
  onAction?: () => void;
}) {
  const t = useTranslations("review");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (manual !== null) {
      text.current?.focus();
      text.current?.select();
    } else {
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
      returnFocus.current = null;
    }
  }, [manual]);
  function success() {
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }
  async function copy() {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setCopied(false);
    onError("");
    try {
      const query = commentId ? `?commentId=${encodeURIComponent(commentId)}` : "";
      const { prompt } = await api<{ prompt: string }>(
        `/api/projects/${projectId}/prompt${query}`,
        {
          signal: request.signal,
        },
      );
      if (request.signal.aborted) return;
      try {
        await navigator.clipboard.writeText(prompt);
        if (!request.signal.aborted) success();
      } catch {
        // HTTP self-hosting and browser permissions can disable the clipboard.
        // Keep the requested text selectable without claiming that it was copied.
        if (!request.signal.aborted) {
          returnFocus.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setManual(prompt);
        }
      }
    } catch (error) {
      if (!request.signal.aborted)
        onError(error instanceof Error ? error.message : t("promptFailed"));
    } finally {
      if (!request.signal.aborted) setBusy(false);
      if (controller.current === request) controller.current = null;
    }
  }
  const label = copied ? t("promptCopied") : t(commentId ? "copyCommentPrompt" : "copyOpenPrompt");
  const button = (
    <button
      className={`${variant === "menu" ? "feedback-action-item" : "icon-button"} copy-prompt-button`}
      type="button"
      role={variant === "menu" ? "menuitem" : undefined}
      tabIndex={variant === "menu" ? -1 : undefined}
      aria-label={label}
      disabled={busy}
      onClick={() => {
        void copy();
        onAction?.();
      }}
    >
      {busy ? (
        <LoaderCircle className="spin" size={16} />
      ) : copied ? (
        <Check size={16} />
      ) : (
        <ClipboardCopy size={16} />
      )}
      {variant === "menu" && <span>{label}</span>}
    </button>
  );
  const status = (
    <span
      className={variant === "menu" && copied ? "feedback-copy-toast" : "sr-only"}
      role="status"
    >
      {variant === "menu" && copied && <Check size={16} aria-hidden="true" />}
      {copied ? t("promptCopied") : ""}
    </span>
  );
  return (
    <>
      {variant === "menu" ? button : <Tooltip content={label}>{button}</Tooltip>}
      {variant === "menu" && typeof document !== "undefined"
        ? createPortal(status, document.body)
        : status}
      {manual !== null &&
        createPortal(
          <Modal title={t("promptTitle")} onClose={() => setManual(null)}>
            <p className="modal-description">{t("promptManual")}</p>
            <textarea
              ref={text}
              className="prompt-text"
              aria-label={t("promptTitle")}
              value={manual}
              readOnly
              rows={12}
              onFocus={(event) => event.currentTarget.select()}
            />
          </Modal>,
          document.body,
        )}
    </>
  );
}
