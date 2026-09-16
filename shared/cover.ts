export const COVER_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const COVER_MAX_EDGE = 10_000;
export const COVER_MAX_PIXELS = 25_000_000;
export const COVER_WIDTH = 1200;
export const COVER_HEIGHT = 750;
export const COVER_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export type CoverSource = "automatic" | "custom";
export type ProjectCover = { source: CoverSource; version: string };
