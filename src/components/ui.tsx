"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { initials } from "@/lib/client";
import { useTranslations } from "next-intl";

export function Logo({ compact = false }: { compact?: boolean }) {
  const t = useTranslations("common");
  return (
    <Link href="/" className="brand" aria-label={t("home")}>
      <span className="brand-mark">
        <span />
      </span>
      {!compact && (
        <>
          repère<span className="brand-dot">.</span>
        </>
      )}
    </Link>
  );
}
export function Avatar({ name, size = "normal" }: { name: string; size?: "small" | "normal" }) {
  return (
    <span className={`avatar ${size === "small" ? "avatar-small" : ""}`} aria-label={name}>
      {initials(name)}
    </span>
  );
}
export function Spinner({ label }: { label?: string }) {
  const t = useTranslations("common");
  return (
    <span className="loading-inline">
      <LoaderCircle size={18} className="spin" />
      {label ?? t("loading")}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const t = useTranslations("common");
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-content">
        <div className="modal-heading">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label={t("close")}>
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export function ErrorBanner({ message }: { message: string }) {
  return message ? (
    <div className="error-banner" role="alert">
      {message}
    </div>
  ) : null;
}
export function OpenSourceFooter() {
  const t = useTranslations("common");
  return (
    <span className="oss-label">
      <span className="status-dot" />
      {t("openSource")}
    </span>
  );
}
