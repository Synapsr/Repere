"use client";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, Circle, MapPin, MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Feedback } from "../../shared/types";
import { CommentCapture } from "./comment-capture";
import { CopyPromptButton } from "./copy-prompt-button";
import { Tooltip } from "./tooltip";
import "./feedback-actions.css";

export function FeedbackActions({
  comment,
  token,
  canResolve,
  canCopyPrompt,
  onStatus,
  onSelect,
  onPromptError,
}: {
  comment: Feedback;
  token: string;
  canResolve: boolean;
  canCopyPrompt: boolean;
  onStatus: () => void;
  onSelect: () => void;
  onPromptError: (message: string) => void;
}) {
  const t = useTranslations("review");
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const focusEdge = useRef<"first" | "last">("first");
  const [open, setOpen] = useState(false);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const label = t("commentActions", { number: comment.number });
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }, []);
  const items = useCallback(
    () =>
      Array.from(
        menu.current?.querySelectorAll<HTMLButtonElement>(
          'button[role="menuitem"]:not(:disabled)',
        ) ?? [],
      ),
    [],
  );
  const position = useCallback(() => {
    const anchor = trigger.current;
    const popup = menu.current;
    if (!anchor || !popup || popup.hidden) return;
    const viewport = window.visualViewport;
    const leftEdge = (viewport?.offsetLeft ?? 0) + 8;
    const topEdge = (viewport?.offsetTop ?? 0) + 8;
    const rightEdge = leftEdge + (viewport?.width ?? window.innerWidth) - 16;
    const bottomEdge = topEdge + (viewport?.height ?? window.innerHeight) - 16;
    const rect = anchor.getBoundingClientRect();
    if (
      rect.bottom < topEdge ||
      rect.top > bottomEdge ||
      rect.right < leftEdge ||
      rect.left > rightEdge
    ) {
      close();
      return;
    }
    popup.style.maxWidth = `${Math.max(0, rightEdge - leftEdge)}px`;
    popup.style.maxHeight = `${Math.max(0, bottomEdge - topEdge)}px`;
    const bounds = popup.getBoundingClientRect();
    const left = Math.max(leftEdge, Math.min(rect.right - bounds.width, rightEdge - bounds.width));
    const preferredTop =
      rect.bottom + 6 + bounds.height <= bottomEdge
        ? rect.bottom + 6
        : rect.top - bounds.height - 6;
    const top = Math.max(topEdge, Math.min(preferredTop, bottomEdge - bounds.height));
    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  }, [close]);

  function show(edge: "first" | "last" = "first") {
    focusEdge.current = edge;
    setPortalHost(document.body);
    setOpen(true);
  }

  useLayoutEffect(() => {
    if (!open || !portalHost) return;
    position();
    const available = items();
    available[focusEdge.current === "first" ? 0 : available.length - 1]?.focus({
      preventScroll: true,
    });
  }, [open, portalHost, position, items]);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    function reposition() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(position);
    }
    function outside(event: Event) {
      if (
        event.target instanceof Node &&
        !menu.current?.contains(event.target) &&
        !trigger.current?.contains(event.target)
      )
        close();
    }
    function blur() {
      close();
    }
    // Firefox can focus a cross-origin frame without parent blur/focus events.
    // This fallback exists only while the popup is open and never reads the frame.
    const iframeFocus = window.setInterval(() => {
      if (document.activeElement instanceof HTMLIFrameElement) close();
    }, 150);
    const observer = new ResizeObserver(reposition);
    if (menu.current) observer.observe(menu.current);
    if (trigger.current) observer.observe(trigger.current);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", reposition, { capture: true, passive: true });
    window.addEventListener("resize", reposition);
    window.addEventListener("blur", blur);
    window.visualViewport?.addEventListener("resize", reposition);
    window.visualViewport?.addEventListener("scroll", reposition);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.clearInterval(iframeFocus);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("blur", blur);
      window.visualViewport?.removeEventListener("resize", reposition);
      window.visualViewport?.removeEventListener("scroll", reposition);
    };
  }, [open, position, close]);

  function navigate(event: KeyboardEvent<HTMLDivElement>) {
    // Dialogs portal out of the hidden menu but still bubble through React's tree.
    if (!menu.current?.contains(event.target as Node)) return;
    if (event.key === "Tab") {
      // Let the browser move from the trigger's original place in document order.
      close(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    const available = items();
    const index = available.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === "ArrowDown") next = (index + 1) % available.length;
    else if (event.key === "ArrowUp") next = (index - 1 + available.length) % available.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = available.length - 1;
    else return;
    event.preventDefault();
    event.stopPropagation();
    available[next]?.focus({ preventScroll: true });
  }

  return (
    <>
      <Tooltip content={label}>
        <button
          ref={trigger}
          type="button"
          className="icon-button feedback-actions-trigger"
          aria-label={label}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => (open ? close() : show())}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              show(event.key === "ArrowUp" ? "last" : "first");
            }
          }}
        >
          <MoreHorizontal size={18} />
        </button>
      </Tooltip>
      {portalHost &&
        createPortal(
          <div
            ref={menu}
            id={id}
            className="feedback-actions-menu"
            role="menu"
            aria-label={label}
            hidden={!open}
            onKeyDown={navigate}
          >
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="feedback-action-item"
              onClick={() => {
                close(true);
                onSelect();
              }}
            >
              <MapPin size={16} />
              <span>{t("showPoint")}</span>
            </button>
            {comment.screenshot && (
              <CommentCapture
                src={`/api/reviews/${token}/comments/${comment.id}/screenshot`}
                pointX={comment.screenshot.pointX}
                pointY={comment.screenshot.pointY}
                number={comment.number}
                variant="menu"
                onAction={() => close(true)}
              />
            )}
            {canCopyPrompt && (
              <CopyPromptButton
                projectId={comment.projectId}
                commentId={comment.id}
                onError={onPromptError}
                variant="menu"
                onAction={() => close(true)}
              />
            )}
            {canResolve && (
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="feedback-action-item"
                aria-label={t(comment.status === "resolved" ? "reopenComment" : "resolveComment", {
                  number: comment.number,
                })}
                onClick={() => {
                  close(true);
                  onStatus();
                }}
              >
                {comment.status === "resolved" ? <Circle size={16} /> : <CheckCircle2 size={16} />}
                <span>{t(comment.status === "resolved" ? "reopen" : "resolve")}</span>
              </button>
            )}
          </div>,
          portalHost,
        )}
    </>
  );
}
