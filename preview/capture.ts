import html2canvas from "html2canvas-pro";
import { encodeCapture } from "../shared/capture-canvas";
import type { CaptureInput } from "../shared/types";

const CAPTURE_TIMEOUT_MS = 12_000;
const RENDER_MAX_EDGE = 2_048;

type CapturePoint = { x: number; y: number; capturedAt: string };

/** One best-effort cover, after assets settle, without delaying website interaction. */
export function captureInitialCover(signal: AbortSignal): Promise<CaptureInput | null> {
  if (signal.aborted) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    let scheduled = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (capture: CaptureInput | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      clearTimeout(settleTimer);
      window.removeEventListener("load", loaded);
      signal.removeEventListener("abort", abort);
      resolve(capture);
    };
    const abort = () => finish(null);
    const schedule = () => {
      if (settled || scheduled) return;
      scheduled = true;
      clearTimeout(deadline);
      window.removeEventListener("load", loaded);
      settleTimer = setTimeout(() => {
        void captureViewport(
          {
            x: window.innerWidth / 2,
            y: window.innerHeight / 2,
            capturedAt: new Date().toISOString(),
          },
          signal,
        ).then(finish);
      }, 300);
    };
    const loaded = () => {
      void document.fonts.ready.then(schedule, schedule);
    };
    const deadline = setTimeout(schedule, 2_000);
    signal.addEventListener("abort", abort, { once: true });
    if (document.readyState === "complete") loaded();
    else window.addEventListener("load", loaded, { once: true });
  });
}

/** Start cloning immediately: awaiting a module or a frame here would capture a later state. */
export function captureViewport(
  point: CapturePoint,
  signal?: AbortSignal,
): Promise<CaptureInput | null> {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const scrollX = window.scrollX;
  const scrollY = window.scrollY;
  if (
    signal?.aborted ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.y)
  )
    return Promise.resolve(null);

  const metadata = {
    pointX: Math.max(0, Math.min(1, point.x / width)),
    pointY: Math.max(0, Math.min(1, point.y / height)),
    capturedAt: point.capturedAt,
  };
  const controller = new AbortController();
  return new Promise((resolve) => {
    let settled = false;
    let container: HTMLElement | null = null;
    const finish = (capture: CaptureInput | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      container?.remove();
      resolve(capture);
    };
    const abort = () => {
      controller.abort();
      finish(null);
    };
    const timeout = setTimeout(abort, CAPTURE_TIMEOUT_MS);
    signal?.addEventListener("abort", abort, { once: true });

    try {
      // The renderer uses a temporary iframe. The website's own iframe CSS must
      // not resize it when the composer changes the live preview's dimensions.
      container = document.createElement("repere-capture");
      for (const [property, value] of Object.entries({
        all: "initial",
        position: "fixed",
        left: "-100000px",
        top: "0",
        width: `${width}px`,
        height: `${height}px`,
        visibility: "hidden",
        "pointer-events": "none",
        contain: "strict",
      }))
        container.style.setProperty(property, value, "important");
      const shadow = container.attachShadow({ mode: "closed" });
      const iframeContainer = document.createElement("div");
      shadow.append(iframeContainer);
      document.documentElement.append(container);

      // html2canvas-pro clones the live DOM, form values and canvases synchronously
      // before its first await. Explicit viewport/scroll values also survive resize.
      const rendered = html2canvas(document.documentElement, {
        x: scrollX,
        y: scrollY,
        width,
        height,
        windowWidth: width,
        windowHeight: height,
        scrollX,
        scrollY,
        scale: Math.min(1, RENDER_MAX_EDGE / Math.max(width, height)),
        logging: false,
        useCORS: true,
        allowTaint: false,
        imageTimeout: 3_000,
        signal: controller.signal,
        iframeContainer,
        ignoreElements: (element) =>
          element.localName === "repere-annotations" ||
          element.localName === "repere-capture" ||
          element.hasAttribute("data-repere-cursor"),
      });
      void rendered
        .then((canvas) => (controller.signal.aborted ? null : encodeCapture(canvas, metadata)))
        .then(finish, () => finish(null));
    } catch {
      // A reviewed site can contain inaccessible media or replace native APIs.
      // Capture failure must never prevent placing the point or using the website.
      finish(null);
    }
  });
}
