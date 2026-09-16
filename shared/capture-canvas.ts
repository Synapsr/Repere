import { CAPTURE_MAX_BYTES } from "./capture-limits";
import type { CaptureInput } from "./types";

type CapturePoint = Omit<CaptureInput, "dataUrl">;

export function newCaptureId(): string {
  // getRandomValues is also available on HTTP self-hosted installations, where
  // randomUUID may be unavailable. This ID correlates messages, not permissions.
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

// Copy synchronously before yielding: PDF rendering may reuse its canvas as soon
// as the user changes page. The encoded image must keep the state at placement.
export async function encodeCapture(
  source: HTMLCanvasElement,
  point: CapturePoint,
): Promise<CaptureInput> {
  if (!source.width || !source.height) throw new Error("CAPTURE_INVALID");
  const canvas = document.createElement("canvas");
  const scale = Math.min(1, 2048 / Math.max(source.width, source.height));
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("CAPTURE_INVALID");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  try {
    for (const quality of [0.86, 0.7, 0.5]) {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (value) => (value ? resolve(value) : reject(new Error("CAPTURE_INVALID"))),
          "image/jpeg",
          quality,
        );
      });
      if (blob.size > CAPTURE_MAX_BYTES) continue;
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error("CAPTURE_INVALID"));
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
      return { ...point, dataUrl };
    }
    throw new Error("CAPTURE_TOO_LARGE");
  } finally {
    canvas.width = canvas.height = 0;
  }
}
