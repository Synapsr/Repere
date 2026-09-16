/** Return a local route after sign-in, including when URL parsing normalizes slashes. */
export function loginDestination(next: string | null, origin: string): string {
  if (!next?.startsWith("/")) return "/";
  try {
    const destination = new URL(next, origin);
    if (destination.origin !== new URL(origin).origin) return "/";
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return "/";
  }
}
