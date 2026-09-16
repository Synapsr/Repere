"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { MessageCircle, ImageIcon } from "lucide-react";
import { ErrorBanner, Modal } from "./ui";

export function CommentCapture({
  src,
  pointX,
  pointY,
  number,
}: {
  src: string;
  pointX: number;
  pointY: number;
  number?: number;
}) {
  const t = useTranslations("review");
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
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
  return (
    <>
      <button
        className="icon-button capture-button"
        type="button"
        aria-label={t("captureView")}
        title={t("captureView")}
        onClick={() => setExpanded(true)}
      >
        <ImageIcon size={16} />
      </button>
      {expanded && (
        <Modal wide title={t("captureTitle")} onClose={() => setExpanded(false)}>
          {failed ? (
            <ErrorBanner message={t("captureUnavailable")} />
          ) : (
            <div className="capture-expanded">{content()}</div>
          )}
        </Modal>
      )}
    </>
  );
}
