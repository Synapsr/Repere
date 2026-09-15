import { ZodError } from "zod";
import en from "../../i18n/messages/en/errors.json";
import fr from "../../i18n/messages/fr/errors.json";
import { resolveLocale, type Locale } from "../../../shared/locale";

export type ErrorCode = keyof typeof en;
const messages = { en, fr };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: ErrorCode,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export function json(data: unknown, status = 200, locale?: Locale) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...(locale ? { "Content-Language": locale, Vary: "Accept-Language, Cookie" } : {}),
    },
  });
}

export function errorResponse(code: ErrorCode, status: number, locale: Locale) {
  return json({ error: messages[locale][code], code }, status, locale);
}

export async function handle(
  request: Pick<Request, "headers">,
  work: () => Promise<Response>,
): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    const locale = resolveLocale(request.headers);
    if (error instanceof ApiError) return errorResponse(error.code, error.status, locale);
    if (error instanceof ZodError) {
      const key = error.issues[0]?.message;
      // Schemas emit explicit message identifiers. Never expose Zod internals or user input.
      const code: ErrorCode = key && Object.hasOwn(en, key) ? (key as ErrorCode) : "INVALID_INPUT";
      return errorResponse(code, 400, locale);
    }
    // Do not log query parameters: they can contain OTP hashes, emails or comment content.
    console.error("API request failed", error instanceof Error ? error.name : "UnknownError");
    return errorResponse("INTERNAL_ERROR", 500, locale);
  }
}
