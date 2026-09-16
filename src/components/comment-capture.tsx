"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { MessageCircle, ImageIcon } from "lucide-react";
import { ErrorBanner, Modal } from "./ui";
import { Tooltip } from "./tooltip";

export function CommentCapture({
  src,
  pointX,
  pointY,
  number,
  variant = "icon",
  onAction,
}: {
  src: string;
  pointX: number;
  pointY: number;
  number?: number;
  variant?: "icon" | "menu";
  onAction?: () => void;
}) {
  const t = useTranslations("review");
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (expanded) return;
    if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    returnFocus.current = null;
  }, [expanded]);
  function content() {
    return (
      <span className="capture-image">
        {/* Authenticated private images bypass image optimization. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={t("captureTitle")} onError={() => setFailed(true)} />
        <span
          className="capture-pin"
          aria-hidden="true"
          style={{ left: `${pointX * 100}%`, top: `${pointY * 100}%` }}
        >
          {number ?? <MessageCircle size={15} />}
        </span>
      </span>
    );
  }
  const button = (
    <button
      className={`${variant === "menu" ? "feedback-action-item" : "icon-button"} capture-button`}
      type="button"
      role={variant === "menu" ? "menuitem" : undefined}
      tabIndex={variant === "menu" ? -1 : undefined}
      aria-label={t("captureView")}
      onClick={() => {
        onAction?.();
        returnFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setExpanded(true);
      }}
    >
      <ImageIcon size={16} />
      {variant === "menu" && <span>{t("captureView")}</span>}
    </button>
  );
  return (
    <>
      {variant === "menu" ? button : <Tooltip content={t("captureView")}>{button}</Tooltip>}
      {expanded &&
        createPortal(
          <Modal wide title={t("captureTitle")} onClose={() => setExpanded(false)}>
            {failed ? (
              <ErrorBanner message={t("captureUnavailable")} />
            ) : (
              <div className="capture-expanded">{content()}</div>
            )}
          </Modal>,
          document.body,
        )}
    </>
  );
}
