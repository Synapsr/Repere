import type { Locale } from "./locale";
import type { CaptureInput, WebsiteAnchor } from "./types";
export type PreviewSession = {
  url: string;
  origin: string;
  targetUrl: string;
  channel: string;
  expiresAt: string;
};
export type PreviewConfig = {
  appOrigin: string;
  targetOrigin: string;
  channel: string;
  locale?: Locale;
  servicePage?: "redirect";
};
export type PreviewPin = {
  id: string;
  number: number;
  status: "open" | "resolved";
  anchor: WebsiteAnchor;
};
export type PreviewCommand = { source: "repere"; channel: string } & (
  | { type: "init" | "back" | "forward" | "reload" }
  | { type: "locale"; locale: Locale }
  | { type: "mode"; mode: "browse" | "comment" }
  | { type: "navigate"; url: string }
  | { type: "focus"; anchor: WebsiteAnchor }
  | { type: "draft"; anchor: WebsiteAnchor | null }
  | { type: "cover" | "cover-cancel"; requestId: string }
  | { type: "pins"; pins: PreviewPin[]; selected: string | null }
);
export type PreviewEvent = { source: "repere-preview"; channel: string } & (
  | { type: "ready" | "location"; url: string; title: string }
  | { type: "anchor"; anchor: WebsiteAnchor; captureId?: string }
  | { type: "capture"; captureId: string; capture: CaptureInput | null }
  | { type: "cover"; requestId: string; capture: CaptureInput | null }
  | { type: "select"; id: string }
  | { type: "error"; message: string }
);
