"use client";
import { useEffect, useRef, useState } from "react";
import { ImagePlus, LoaderCircle, RotateCcw } from "lucide-react";
import { useTranslations } from "next-intl";
import type { Project } from "../../shared/types";
import { COVER_MAX_UPLOAD_BYTES, COVER_MIME_TYPES } from "../../shared/cover";
import { api } from "@/lib/client";
import { ErrorBanner } from "./ui";
import { ProjectCover } from "./project-cover";

export function ProjectCoverSettings({
  project,
  onUpdated,
}: {
  project: Project;
  onUpdated: () => Promise<unknown>;
}) {
  const t = useTranslations("review");
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The successful response owns the preview immediately, even if the review refresh fails.
  const [saved, setSaved] = useState<{
    cover: Project["cover"];
    previousVersion: string | null;
  } | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function update(file?: File) {
    if (request.current) return;
    setError("");
    if (file && file.size > COVER_MAX_UPLOAD_BYTES) {
      setError(t("coverTooLarge"));
      return;
    }
    if (file && !COVER_MIME_TYPES.some((type) => type === file.type)) {
      setError(t("coverInvalid"));
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    const body = new FormData();
    if (file) {
      body.set("file", file);
      body.set("source", "custom");
    }
    try {
      const result = await api<{ cover: Project["cover"] }>(`/api/projects/${project.id}/cover`, {
        method: file ? "POST" : "DELETE",
        ...(file ? { body } : {}),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setSaved({ ...result, previousVersion: project.cover?.version ?? null });
      await onUpdated();
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : t("updateFailed"));
    } finally {
      if (!controller.signal.aborted) setBusy(false);
      if (request.current === controller) request.current = null;
    }
  }
  const current =
    saved && saved.previousVersion === (project.cover?.version ?? null)
      ? { ...project, cover: saved.cover }
      : project;
  return (
    <section className="settings-section cover-settings" aria-labelledby="cover-settings-title">
      <h3 id="cover-settings-title">{t("coverTitle")}</h3>
      <div className="project-preview cover-settings-preview">
        <ProjectCover project={current} />
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        aria-label={t("coverChange")}
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void update(file);
        }}
      />
      <div className="cover-settings-actions">
        <button
          type="button"
          className="button secondary"
          onClick={() => input.current?.click()}
          disabled={busy}
        >
          {busy ? <LoaderCircle size={16} className="spin" /> : <ImagePlus size={16} />}
          {t("coverChange")}
        </button>
        {current.cover?.source === "custom" && (
          <button
            type="button"
            className="button ghost"
            onClick={() => void update()}
            disabled={busy}
          >
            <RotateCcw size={15} />
            {t("coverReset")}
          </button>
        )}
      </div>
      <p className="cover-settings-hint">{t(current.cover ? "coverHint" : "coverAutomaticHint")}</p>
      <ErrorBanner message={error} />
    </section>
  );
}
