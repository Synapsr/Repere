import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { database } from "@/db";
import { rateLimits } from "@/db/schema";
import { ApiError } from "./errors";
import { secret } from "./security";

/** A locked database row makes limits durable across restarts and application replicas. */
export async function rateLimit(scope: string, identity: string, limit: number, windowMs: number) {
  const key = createHmac("sha256", secret("SESSION_SECRET"))
    .update(`${scope}:${identity}`)
    .digest("hex");
  const now = new Date();
  const allowed = await database().transaction(async (tx) => {
    await tx
      .insert(rateLimits)
      .values({ key, count: 0, expiresAt: new Date(now.getTime() + windowMs) })
      .onDuplicateKeyUpdate({ set: { key } });
    const [row] = await tx.select().from(rateLimits).where(eq(rateLimits.key, key)).for("update");
    const expired = row.expiresAt <= now;
    const count = expired ? 1 : Math.min(row.count + 1, limit + 1);
    await tx
      .update(rateLimits)
      .set({ count, ...(expired ? { expiresAt: new Date(now.getTime() + windowMs) } : {}) })
      .where(eq(rateLimits.key, key));
    return count <= limit;
  });
  if (!allowed) throw new ApiError(429, "RATE_LIMITED");
}
