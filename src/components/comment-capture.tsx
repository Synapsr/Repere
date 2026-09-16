"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { MessageCircle, Maximize2 } from "lucide-react";
import { Modal } from "./ui";

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
        {/* Authenticated, private images and in-memory drafts bypass image optimization. */}
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
  if (failed) return <p className="capture-notice">{t("captureUnavailable")}</p>;
  return (
    <>
      <button
        className="capture-thumbnail"
        type="button"
        aria-label={t("captureView")}
        onClick={() => setExpanded(true)}
      >
        {content()}
        <span className="capture-expand" aria-hidden="true">
          <Maximize2 size={14} />
        </span>
      </button>
      {expanded && (
        <Modal wide title={t("captureTitle")} onClose={() => setExpanded(false)}>
          <div className="capture-expanded">{content()}</div>
        </Modal>
      )}
    </>
  );
}
