import { z } from "zod";
import type { WebsiteAnchor } from "./types";

// Shared by the API and the parent iframe UI: a matching postMessage origin does not
// make scripts from the reviewed website trustworthy, so both boundaries parse data.
export const websiteUrlSchema = z
  .string()
  .trim()
  .max(4096, "INVALID_WEBSITE_URL")
  .transform((value, ctx) => {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw new Error();
      return url.toString();
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "INVALID_WEBSITE_URL",
      });
      return z.NEVER;
    }
  });

const fraction = z.number().finite().min(0).max(1);
export const pdfAnchorSchema = z
  .object({
    type: z.literal("pdf"),
    page: z.number().int().min(1).max(100000),
    x: fraction,
    y: fraction,
  })
  .strict();
export const websiteAnchorSchema = z
  .object({
    type: z.literal("website"),
    url: websiteUrlSchema,
    selector: z.string().max(4096).nullable(),
    text: z.string().max(1000).nullable(),
    x: fraction,
    y: fraction,
    documentX: z.number().finite().min(0).max(10000000),
    documentY: z.number().finite().min(0).max(10000000),
    viewportWidth: z.number().int().min(1).max(10000),
    viewportHeight: z.number().int().min(1).max(10000),
  })
  .strict();
export const anchorSchema = z.discriminatedUnion("type", [pdfAnchorSchema, websiteAnchorSchema]);

export function parseWebsiteAnchorForOrigin(
  value: unknown,
  expectedOrigin: string,
): WebsiteAnchor | null {
  const parsed = websiteAnchorSchema.safeParse(value);
  if (!parsed.success) return null;
  try {
    return new URL(parsed.data.url).origin === new URL(expectedOrigin).origin ? parsed.data : null;
  } catch {
    return null;
  }
}
