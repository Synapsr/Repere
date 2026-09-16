"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ClipboardCopy, LoaderCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { api } from "@/lib/client";
import { Modal } from "./ui";

export function CopyPromptButton({
  projectId,
  commentId,
  onError,
}: {
  projectId: string;
  commentId?: string;
  onError: (message: string) => void;
}) {
  const t = useTranslations("review");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);
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
        if (!request.signal.aborted) setManual(prompt);
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
  return (
    <>
      <button
        className="icon-button copy-prompt-button"
        type="button"
        title={label}
        aria-label={label}
        disabled={busy}
        onClick={() => void copy()}
      >
        {busy ? (
          <LoaderCircle className="spin" size={16} />
        ) : copied ? (
          <Check size={16} />
        ) : (
          <ClipboardCopy size={16} />
        )}
      </button>
      <span className="sr-only" role="status">
        {copied ? t("promptCopied") : ""}
      </span>
      {manual !== null && (
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
        </Modal>
      )}
    </>
  );
}
