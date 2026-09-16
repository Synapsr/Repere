"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import type { CaptureInput, Feedback, PdfAnchor } from "../../shared/types";
import { encodeCapture, newCaptureId } from "../../shared/capture-canvas";
import { Spinner, ErrorBanner } from "./ui";
export function PdfViewer({
  token,
  mode,
  comments,
  onAnchor,
  onCapture,
  selected,
  onSelect,
  focus,
  controlsHost,
}: {
  token: string;
  mode: "browse" | "comment";
  comments: Feedback[];
  onAnchor: (a: PdfAnchor, captureId: string | null) => void;
  onCapture: (captureId: string, capture: CaptureInput | null) => void;
  selected: string | null;
  onSelect: (id: string) => void;
  focus: Feedback | null;
  controlsHost: HTMLElement | null;
}) {
  const t = useTranslations("pdf");
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState<"loadFailed" | "renderFailed" | null>(null);
  const [completed, setCompleted] = useState<{
    pdf: PDFDocumentProxy;
    pageNumber: number;
    zoom: number;
  } | null>(null);
  const ready =
    !!pdf &&
    !error &&
    completed?.pdf === pdf &&
    completed.pageNumber === pageNumber &&
    completed.zoom === zoom;
  const rendering = !error && !ready;
  const canvas = useRef<HTMLCanvasElement>(null);
  const documentPage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 680, height: 880 });
  useEffect(() => {
    let active = true;
    let destroy: (() => void) | undefined;
    async function load() {
      try {
        const pdfjs = await import("pdfjs-dist");
        const assets = `/pdfjs/${pdfjs.version}/`;
        pdfjs.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.min.mjs`;
        const task = pdfjs.getDocument({
          url: `/api/reviews/${token}/file`,
          withCredentials: true,
          cMapUrl: `${assets}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${assets}standard_fonts/`,
          wasmUrl: `${assets}wasm/`,
          iccUrl: `${assets}iccs/`,
          useSystemFonts: true,
        });
        destroy = () => {
          void task.destroy();
        };
        const document = await task.promise;
        if (active) setPdf(document);
      } catch {
        if (active) {
          setError("loadFailed");
        }
      }
    }
    void load();
    return () => {
      active = false;
      destroy?.();
    };
  }, [token]);
  useEffect(() => {
    if (!pdf) return;
    const document = pdf;
    let cancelled = false;
    let cancelRender: (() => void) | undefined;
    async function render() {
      try {
        const page = await document.getPage(pageNumber);
        if (cancelled || !canvas.current) return;
        // Changing the bitmap invalidates its previous completion, even if the reader quickly returns to that page.
        setCompleted(null);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: (680 / base.width) * zoom });
        const ratio = window.devicePixelRatio || 1;
        const element = canvas.current;
        element.width = Math.floor(viewport.width * ratio);
        element.height = Math.floor(viewport.height * ratio);
        setSize({ width: viewport.width, height: viewport.height });
        const task = page.render({
          canvas: element,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        cancelRender = () => task.cancel();
        await task.promise;
        if (!cancelled) {
          setCompleted({ pdf: document, pageNumber, zoom });
          setError(null);
        }
      } catch (e) {
        if (!cancelled && !(e instanceof Error && e.name === "RenderingCancelledException")) {
          setError("renderFailed");
        }
      }
    }
    void render();
    return () => {
      cancelled = true;
      cancelRender?.();
    };
  }, [pdf, pageNumber, zoom]);
  useEffect(() => {
    if (focus?.anchor.type === "pdf") {
      const page = focus.anchor.page;
      queueMicrotask(() => {
        setPageNumber(page);
      });
    }
  }, [focus]);
  useEffect(() => {
    if (!ready || focus?.anchor.type !== "pdf" || focus.anchor.page !== pageNumber) return;
    documentPage.current
      ?.querySelector(`[data-comment-id="${CSS.escape(focus.id)}"]`)
      ?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [focus, ready, pageNumber]);
  return (
    <div className="pdf-viewer">
      {controlsHost &&
        createPortal(
          <div className="pdf-menu-controls" aria-label={t("controls")}>
            <div className="pdf-pagination">
              <button
                className="icon-button"
                aria-label={t("previous")}
                disabled={pageNumber <= 1}
                onClick={() => {
                  setPageNumber((p) => p - 1);
                }}
              >
                <ChevronLeft size={17} />
              </button>
              <label>
                {t("page")}{" "}
                <input
                  aria-label={t("pageNumber")}
                  type="number"
                  min={1}
                  max={pdf?.numPages || 1}
                  value={pageNumber}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isInteger(n) && n >= 1 && pdf && n <= pdf.numPages) {
                      setPageNumber(n);
                    }
                  }}
                />{" "}
                {t("pageCount", { count: pdf?.numPages || "…" })}
              </label>
              <button
                className="icon-button"
                aria-label={t("next")}
                disabled={!pdf || pageNumber >= pdf.numPages}
                onClick={() => {
                  setPageNumber((p) => p + 1);
                }}
              >
                <ChevronRight size={17} />
              </button>
            </div>
            <div className="pdf-zoom">
              <button
                className="icon-button"
                aria-label={t("zoomOut")}
                disabled={zoom <= 0.5}
                onClick={() => {
                  setZoom((z) => Math.max(0.5, z - 0.25));
                }}
              >
                <Minus size={16} />
              </button>
              <span>{Math.round(zoom * 100)} %</span>
              <button
                className="icon-button"
                aria-label={t("zoomIn")}
                disabled={zoom >= 2}
                onClick={() => {
                  setZoom((z) => Math.min(2, z + 0.25));
                }}
              >
                <Plus size={16} />
              </button>
            </div>
          </div>,
          controlsHost,
        )}
      <ErrorBanner message={error ? t(error) : ""} />
      <div className="pdf-scroll">
        <div
          ref={documentPage}
          className={`pdf-page ${mode === "comment" ? "is-commenting" : ""}`}
          aria-busy={rendering}
          style={{ width: size.width, aspectRatio: `${size.width}/${size.height}` }}
          onClick={(e) => {
            if (mode !== "comment" || !ready) return;
            const rect = e.currentTarget.getBoundingClientRect();
            if (!canvas.current) return;
            const point = {
              pointX: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
              pointY: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
              capturedAt: new Date().toISOString(),
            };
            const captureId = newCaptureId();
            const capture = encodeCapture(canvas.current, point);
            onAnchor(
              { type: "pdf", page: pageNumber, x: point.pointX, y: point.pointY },
              captureId,
            );
            void capture.then(
              (value) => onCapture(captureId, value),
              () => onCapture(captureId, null),
            );
          }}
        >
          <canvas ref={canvas} aria-label={t("canvas", { number: pageNumber })} />
          {ready &&
            comments
              .filter((c) => c.anchor.type === "pdf" && c.anchor.page === pageNumber)
              .map((comment) => {
                const anchor = comment.anchor as PdfAnchor;
                return (
                  <button
                    key={comment.id}
                    className={`annotation-pin ${selected === comment.id ? "selected" : ""} ${comment.status === "resolved" ? "resolved" : ""}`}
                    aria-label={t("comment", { number: comment.number })}
                    data-comment-id={comment.id}
                    style={{ left: `${anchor.x * 100}%`, top: `${anchor.y * 100}%` }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(comment.id);
                    }}
                  >
                    {comment.number}
                  </button>
                );
              })}
          {rendering && !error && (
            <div className="pdf-loading">
              <Spinner label={t("loading")} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
