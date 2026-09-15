import { sql } from "drizzle-orm";
import { database } from "@/db";
import { errorResponse, json } from "@/lib/server/errors";
import { resolveLocale } from "../../../../shared/locale";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await database().execute(sql`select 1`);
    return json({ ok: true });
  } catch {
    return errorResponse("DATABASE_UNAVAILABLE", 503, resolveLocale(request.headers));
  }
}
