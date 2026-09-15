import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { ApiError } from "./errors";

export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_COOKIE = "repere_session";

export function secret(name: "SESSION_SECRET" | "PROXY_SECRET") {
  const value = process.env[name];
  if (!value || value.length < 32) throw new Error(`${name} must contain at least 32 characters.`);
  return value;
}
export function appOrigin() {
  return new URL(process.env.APP_URL || "http://localhost:3000").origin;
}
export function assertSameOrigin(request: Request) {
  if (request.headers.get("origin") !== appOrigin()) throw new ApiError(403, "ORIGIN_NOT_ALLOWED");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new ApiError(403, "CROSS_SITE_REQUEST");
}
/** A language preference belongs to the configured application host only. */
export function assertLocaleOrigin(request: Request): URL {
  assertSameOrigin(request);
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const app = new URL(appOrigin());
  if (app.host !== host.toLowerCase()) throw new ApiError(403, "ORIGIN_NOT_ALLOWED");
  return app;
}
export function randomToken() {
  return randomBytes(32).toString("base64url");
}
export function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function otpHash(email: string, code: string) {
  return createHmac("sha256", secret("SESSION_SECRET"))
    .update(`otp:${email}:${code}`)
    .digest("hex");
}
export function generateOtp() {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}
export function safeHashEquals(left: string, right: string) {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === 32 && b.length === 32 && timingSafeEqual(a, b);
}
export function challengeUsable(
  challenge: { consumedAt: Date | null; expiresAt: Date; attempts: number },
  now: Date,
) {
  return (
    !challenge.consumedAt && challenge.expiresAt > now && challenge.attempts < OTP_MAX_ATTEMPTS
  );
}
export function ownerEmailAllowed(email: string) {
  const allowed = (process.env.ALLOWED_EMAIL_DOMAINS || "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  return (
    allowed.length === 0 || allowed.includes(email.slice(email.lastIndexOf("@") + 1).toLowerCase())
  );
}
export function requestNetwork(request: Request) {
  // Enable only behind a trusted proxy which overwrites this header; never trust it by default.
  return process.env.TRUST_PROXY === "true"
    ? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 80) || "unknown"
    : "shared";
}
