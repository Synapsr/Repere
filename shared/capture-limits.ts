export const CAPTURE_MAX_BYTES = 2 * 1024 * 1024;
export const CAPTURE_MAX_EDGE = 4096;
export const CAPTURE_MAX_PIXELS = 8_000_000;
export const CAPTURE_MAX_DATA_URL_LENGTH =
  "data:image/jpeg;base64,".length + 4 * Math.ceil(CAPTURE_MAX_BYTES / 3);
