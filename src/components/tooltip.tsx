"use client";

import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactElement,
  type Ref,
} from "react";
import { createPortal } from "react-dom";
import "./tooltip.css";

type Side = "top" | "bottom" | "left" | "right";
type TriggerProps = HTMLAttributes<HTMLElement> & {
  title?: string;
  disabled?: boolean;
  ref?: Ref<HTMLElement>;
  "aria-label"?: string;
  "aria-describedby"?: string;
};
type TooltipProps = {
  content: string;
  side?: Side;
  asChild?: boolean;
  children: ReactElement;
};

const HOVER_DELAY = 400;
const EXIT_DURATION = 160;
const GAP = 8;
const MARGIN = 8;

function updateRef(ref: Ref<HTMLElement> | undefined, node: HTMLElement | null) {
  if (typeof ref === "function") return ref(node);
  if (ref) ref.current = node;
}

export function Tooltip({ content, side = "top", asChild = false, children }: TooltipProps) {
  const id = useId();
  const anchor = useRef<HTMLElement>(null);
  const tooltip = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<number | undefined>(undefined);
  const leaveTimer = useRef<number | undefined>(undefined);
  const exitTimer = useRef<number | undefined>(undefined);
  const keyboardFocus = useRef(false);
  const [present, setPresent] = useState(false);
  const [open, setOpen] = useState(false);
  const child = children as ReactElement<TriggerProps>;
  const childRef = child.props.ref;
  const composedRef = useCallback(
    (node: HTMLElement | null) => {
      anchor.current = node;
      const cleanup = updateRef(childRef, node);
      if (!node) return;
      return () => {
        anchor.current = null;
        if (typeof cleanup === "function") cleanup();
        else updateRef(childRef, null);
      };
    },
    [childRef],
  );
  const disabled = child.props.disabled === true;
  const description =
    [child.props["aria-describedby"], open ? id : undefined].filter(Boolean).join(" ") || undefined;

  const hide = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(leaveTimer.current);
    window.clearTimeout(exitTimer.current);
    setOpen(false);
    exitTimer.current = window.setTimeout(() => setPresent(false), EXIT_DURATION);
  }, []);

  const show = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    window.clearTimeout(leaveTimer.current);
    window.clearTimeout(exitTimer.current);
    if (!content.trim()) return;
    setPresent(true);
    setOpen(true);
  }, [content]);

  const leave = useCallback(() => {
    window.clearTimeout(hoverTimer.current);
    if (keyboardFocus.current) return;
    // The short gap lets the pointer reach the tooltip itself without dismissing it.
    leaveTimer.current = window.setTimeout(hide, 80);
  }, [hide]);

  useEffect(
    () => () => {
      window.clearTimeout(hoverTimer.current);
      window.clearTimeout(leaveTimer.current);
      window.clearTimeout(exitTimer.current);
    },
    [],
  );

  useLayoutEffect(() => {
    if (!present || !open) return;
    const trigger = anchor.current;
    const bubble = tooltip.current;
    if (!trigger || !bubble) return;
    let frame = 0;

    const position = () => {
      const rect = trigger.getBoundingClientRect();
      const width = bubble.offsetWidth;
      const height = bubble.offsetHeight;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      const right = left + (viewport?.width ?? window.innerWidth);
      const bottom = top + (viewport?.height ?? window.innerHeight);
      if (
        !rect.width ||
        !rect.height ||
        rect.bottom < top ||
        rect.top > bottom ||
        rect.right < left ||
        rect.left > right
      ) {
        hide();
        return;
      }
      const room = {
        top: rect.top - top - GAP - MARGIN,
        bottom: bottom - rect.bottom - GAP - MARGIN,
        left: rect.left - left - GAP - MARGIN,
        right: right - rect.right - GAP - MARGIN,
      };
      const opposite: Record<Side, Side> = {
        top: "bottom",
        bottom: "top",
        left: "right",
        right: "left",
      };
      let placement = side;
      const required = side === "top" || side === "bottom" ? height : width;
      if (room[side] < required && room[opposite[side]] > room[side]) placement = opposite[side];
      if ((placement === "left" || placement === "right") && room[placement] < width)
        placement = room.top >= room.bottom ? "top" : "bottom";
      let x = rect.left + (rect.width - width) / 2;
      let y = rect.top + (rect.height - height) / 2;
      if (placement === "top") y = rect.top - height - GAP;
      if (placement === "bottom") y = rect.bottom + GAP;
      if (placement === "left") x = rect.left - width - GAP;
      if (placement === "right") x = rect.right + GAP;
      bubble.style.left = `${Math.max(left + MARGIN, Math.min(x, right - width - MARGIN))}px`;
      bubble.style.top = `${Math.max(top + MARGIN, Math.min(y, bottom - height - MARGIN))}px`;
      bubble.dataset.side = placement;
      bubble.dataset.positioned = "true";
    };
    const schedule = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(position);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    position();
    // No global listeners or observers exist while the tooltip is closed.
    window.addEventListener("resize", schedule, { passive: true });
    window.addEventListener("scroll", schedule, { capture: true, passive: true });
    document.addEventListener("keydown", escape);
    window.visualViewport?.addEventListener("resize", schedule, { passive: true });
    window.visualViewport?.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(trigger);
    observer.observe(bubble);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("keydown", escape);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      observer.disconnect();
    };
  }, [present, open, content, side, hide]);

  const handlers: Pick<
    HTMLAttributes<HTMLElement>,
    "onPointerEnter" | "onPointerLeave" | "onPointerDown" | "onFocus" | "onBlur" | "onKeyDown"
  > = {
    onPointerEnter: (event) => {
      window.clearTimeout(leaveTimer.current);
      if (
        event.pointerType !== "mouse" ||
        !window.matchMedia("(hover: hover) and (pointer: fine)").matches
      )
        return;
      window.clearTimeout(hoverTimer.current);
      hoverTimer.current = window.setTimeout(show, HOVER_DELAY);
    },
    onPointerLeave: leave,
    onPointerDown: hide,
    onFocus: (event) => {
      if (event.target instanceof HTMLElement && event.target.matches(":focus-visible")) {
        keyboardFocus.current = true;
        show();
      }
    },
    onBlur: (event) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
        return;
      keyboardFocus.current = false;
      hide();
    },
    onKeyDown: (event) => {
      if (["Escape", "Enter", " "].includes(event.key)) hide();
    },
  };
  const trigger = asChild ? (
    // cloneElement forwards this callback ref; React invokes it only during commit, never render.
    // eslint-disable-next-line react-hooks/refs
    cloneElement(child, {
      title: undefined,
      "aria-describedby": description,
      ref: composedRef,
      onPointerEnter: (event) => {
        child.props.onPointerEnter?.(event);
        if (!event.defaultPrevented) handlers.onPointerEnter?.(event);
      },
      onPointerLeave: (event) => {
        child.props.onPointerLeave?.(event);
        if (!event.defaultPrevented) handlers.onPointerLeave?.(event);
      },
      onPointerDown: (event) => {
        child.props.onPointerDown?.(event);
        if (!event.defaultPrevented) handlers.onPointerDown?.(event);
      },
      onFocus: (event) => {
        child.props.onFocus?.(event);
        if (!event.defaultPrevented) handlers.onFocus?.(event);
      },
      onBlur: (event) => {
        child.props.onBlur?.(event);
        if (!event.defaultPrevented) handlers.onBlur?.(event);
      },
      onKeyDown: (event) => {
        child.props.onKeyDown?.(event);
        if (!event.defaultPrevented) handlers.onKeyDown?.(event);
      },
    })
  ) : (
    <span
      className="tooltip-trigger"
      ref={anchor}
      tabIndex={disabled ? 0 : undefined}
      role={disabled ? "group" : undefined}
      aria-disabled={disabled || undefined}
      aria-label={disabled ? child.props["aria-label"] || content : undefined}
      aria-describedby={disabled ? description : undefined}
      {...handlers}
    >
      {cloneElement(child, { title: undefined, "aria-describedby": description })}
    </span>
  );

  return (
    <>
      {trigger}
      {present &&
        createPortal(
          <div
            className="tooltip-bubble"
            id={id}
            role="tooltip"
            ref={tooltip}
            data-side={side}
            data-open={open}
            aria-hidden={!open}
            onPointerEnter={() => window.clearTimeout(leaveTimer.current)}
            onPointerLeave={leave}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
