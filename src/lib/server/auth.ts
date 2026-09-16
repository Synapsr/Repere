import { randomUUID } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import { cookies } from "next/headers";
import { database } from "@/db";
import { otpChallenges, sessions, users } from "@/db/schema";
import type { User } from "../../../shared/types";
import { resolveLocale } from "../../../shared/locale";
import { ApiError } from "./errors";
import { renderOtpEmail } from "./emails";
import { sendEmail } from "./mail";
import { rateLimit } from "./rate-limit";
import {
  appOrigin,
  challengeUsable,
  generateOtp,
  otpHash,
  OTP_TTL_MS,
  randomToken,
  requestNetwork,
  safeHashEquals,
  sessionCookieName,
  SESSION_TTL_SECONDS,
  tokenHash,
} from "./security";

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(sessionCookieName())?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const [row] = await database()
    .select({ user: { id: users.id, name: users.name, email: users.email } })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row?.user ?? null;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new ApiError(401, "AUTH_REQUIRED");
  return user;
}

export async function requestOtp(request: Request, input: { email: string; name?: string }) {
  await rateLimit("otp-request-global", "global", 200, OTP_TTL_MS);
  await rateLimit("otp-request-network", requestNetwork(request), 30, OTP_TTL_MS);
  await rateLimit("otp-request-email", input.email, 3, OTP_TTL_MS);
  const code = generateOtp();
  const codeHash = otpHash(input.email, code);
  const now = new Date();
  await database()
    .insert(otpChallenges)
    .values({
      email: input.email,
      codeHash,
      name: input.name ?? null,
      attempts: 0,
      expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      consumedAt: null,
      createdAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        codeHash,
        name: input.name ?? null,
        attempts: 0,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        consumedAt: null,
        createdAt: now,
      },
    });
  try {
    await sendEmail(
      input.email,
      renderOtpEmail(resolveLocale(request.headers), code, OTP_TTL_MS / 60000),
    );
  } catch {
    await database()
      .update(otpChallenges)
      .set({ consumedAt: new Date() })
      .where(and(eq(otpChallenges.email, input.email), eq(otpChallenges.codeHash, codeHash)));
    throw new ApiError(503, "EMAIL_DELIVERY_FAILED");
  }
}

export async function verifyOtp(
  request: Request,
  input: { email: string; code: string },
): Promise<User> {
  await rateLimit("otp-verify-network", requestNetwork(request), 100, OTP_TTL_MS);
  await rateLimit("otp-verify-email", input.email, 20, OTP_TTL_MS);
  const now = new Date();
  const rawToken = randomToken();
  const hash = tokenHash(rawToken);
  const result = await database().transaction(async (tx) => {
    const [challenge] = await tx
      .select()
      .from(otpChallenges)
      .where(eq(otpChallenges.email, input.email))
      .for("update");
    if (!challenge || !challengeUsable(challenge, now)) return null;
    // Commit failed attempt counters. Throwing inside the transaction would roll them back.
    await tx
      .update(otpChallenges)
      .set({ attempts: challenge.attempts + 1 })
      .where(eq(otpChallenges.email, input.email));
    if (!safeHashEquals(challenge.codeHash, otpHash(input.email, input.code))) return null;
    await tx
      .update(otpChallenges)
      .set({ consumedAt: now })
      .where(eq(otpChallenges.email, input.email));
    await tx
      .insert(users)
      .values({
        id: randomUUID(),
        email: input.email,
        name: challenge.name || input.email.split("@")[0].slice(0, 80),
      })
      .onDuplicateKeyUpdate({ set: { email: input.email } });
    const [user] = await tx
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.email, input.email));
    await tx.delete(sessions).where(and(eq(sessions.userId, user.id), lt(sessions.expiresAt, now)));
    await tx.insert(sessions).values({
      tokenHash: hash,
      userId: user.id,
      expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000),
    });
    return user;
  });
  if (!result) throw new ApiError(400, "OTP_INVALID");
  (await cookies()).set(sessionCookieName(), rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: appOrigin().startsWith("https:"),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  return result;
}

export async function logout() {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName())?.value;
  if (token)
    await database()
      .delete(sessions)
      .where(eq(sessions.tokenHash, tokenHash(token)));
  cookieStore.set(sessionCookieName(), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: appOrigin().startsWith("https:"),
    path: "/",
    maxAge: 0,
  });
}
