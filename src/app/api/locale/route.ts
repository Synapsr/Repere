import { cookies } from "next/headers";
import { z } from "zod";
import { LOCALE_COOKIE, locales } from "../../../../shared/locale";
import { handle, json } from "@/lib/server/errors";
import { assertLocaleOrigin } from "@/lib/server/security";
import { readJson } from "@/lib/server/validation";

const inputSchema = z.object({ locale: z.enum(locales, { error: "INVALID_LOCALE" }) }).strict();

export async function POST(request: Request) {
  return handle(request, async () => {
    const origin = assertLocaleOrigin(request);
    const { locale } = inputSchema.parse(await readJson(request));
    (await cookies()).set(LOCALE_COOKIE, locale, {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.protocol === "https:",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
    return json({ locale }, 200, locale);
  });
}
