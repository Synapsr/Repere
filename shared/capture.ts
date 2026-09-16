import { z } from "zod";
import type { CaptureInput } from "./types";

export * from "./capture-limits";
import { CAPTURE_MAX_DATA_URL_LENGTH } from "./capture-limits";

const fraction = z
  .number({ error: "CAPTURE_INVALID" })
  .finite("CAPTURE_INVALID")
  .min(0, "CAPTURE_INVALID")
  .max(1, "CAPTURE_INVALID");

// Parse at both trust boundaries: reviewed websites can send arbitrary messages.
// The server additionally decodes, checks dimensions and re-encodes the JPEG.
export const captureSchema = z
  .object({
    dataUrl: z
      .string({ error: "CAPTURE_INVALID" })
      .max(CAPTURE_MAX_DATA_URL_LENGTH, "CAPTURE_TOO_LARGE")
      .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/, "CAPTURE_INVALID"),
    capturedAt: z.iso
      .datetime({ offset: true, error: "CAPTURE_INVALID" })
      .refine(
        (value) => Date.parse(value) >= 0 && new Date(value).getUTCFullYear() <= 9999,
        "CAPTURE_INVALID",
      ),
    pointX: fraction,
    pointY: fraction,
  })
  .strict();

export function parseCaptureInput(value: unknown): CaptureInput | null {
  const result = captureSchema.safeParse(value);
  return result.success ? result.data : null;
}
