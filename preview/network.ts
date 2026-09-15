import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export type Address = { address: string; family: number };
export type Resolver = (host: string) => Promise<Address[]>;
const systemResolver: Resolver = (host) => lookup(host, { all: true, verbatim: true });

export function normalizeHost(host: string): string {
  return host
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

export function isPublicAddress(address: string): boolean {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress())
      parsed = (parsed as ipaddr.IPv6).toIPv4Address();
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

/** Resolve once, reject mixed public/private answers, and use the returned numeric address for the socket. */
export async function resolveDestination(
  rawHost: string,
  port: number,
  allowedPrivateHosts: ReadonlySet<string> = new Set(),
  resolver: Resolver = systemResolver,
): Promise<Address> {
  const host = normalizeHost(rawHost);
  if (!host || host.includes("%") || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid destination");
  const allowPrivate = allowedPrivateHosts.has(host);
  if (!allowPrivate && port !== 80 && port !== 443)
    throw new Error("Only public HTTP and HTTPS ports are allowed");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolver(host);
  if (
    !addresses.length ||
    (!allowPrivate && addresses.some(({ address }) => !isPublicAddress(address)))
  )
    throw new Error("Private network destinations are blocked");
  // Prefer IPv4 for deployments without IPv6 egress. No DNS lookup occurs after this check.
  return addresses.find(({ family }) => family === 4) ?? addresses[0];
}

export function validateNavigation(raw: string, projectOrigin?: string): URL {
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    raw.length > 4096
  )
    throw new Error("This address cannot be opened");
  if (projectOrigin && url.origin !== projectOrigin)
    throw new Error("Navigation is limited to this project's website");
  return url;
}
