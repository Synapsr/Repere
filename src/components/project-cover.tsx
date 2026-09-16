"use client";
import { useState } from "react";
import type { Project } from "../../shared/types";

/** Private images need the browser's session cookie, so they bypass image optimization. */
export function ProjectCover({ project }: { project: Project }) {
  const [failed, setFailed] = useState<string | null>(null);
  const source = project.cover
    ? `/api/projects/${project.id}/cover?v=${encodeURIComponent(project.cover.version)}`
    : null;
  if (source && source !== failed)
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Authenticated, server-resized local image.
      <img
        className="project-cover-image"
        src={source}
        alt=""
        width={1200}
        height={750}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(source)}
      />
    );
  return project.type === "website" ? (
    <div className="mini-website" aria-hidden="true">
      <div className="mini-nav">
        <span />
        <i />
        <i />
        <i />
      </div>
      <div className="mini-web-body">
        <div>
          <b>{project.name.split(/[—–-]/)[0]}</b>
          <i />
          <i />
          <span />
        </div>
        <div className="mini-web-visual">
          <span />
        </div>
      </div>
    </div>
  ) : (
    <div className="mini-document" aria-hidden="true">
      <div className="mini-doc-top" />
      <strong>{project.name}</strong>
      <i />
      <i />
      <i />
      <div />
      <i />
      <i />
    </div>
  );
}
