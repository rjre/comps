// Discovery follows <a href> values found inside third-party feed/page
// content — a malicious or compromised source could point one at an
// internal network address (this app's own host, a router admin panel,
// another LAN device) instead of a real sponsor site. A resolved URL like
// that would get stored as Competition.url and later opened by Playwright
// with the user's real profile data — i.e. real PII submitted to whatever
// internal service happens to be there. This blocks that class of target
// before any fetch/navigation happens.
//
// This is a hostname/IP-literal check, not DNS-rebinding-proof (a domain
// an attacker controls could resolve to a private IP at connect time,
// after passing this check on the literal hostname) — a meaningfully
// smaller residual risk than the unrestricted case, not a complete SSRF
// defense.
const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^169\.254\./, // link-local (also cloud metadata endpoints)
  /^0\./, // "this network"
];

export function isPrivateOrLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "::1" || host === "0.0.0.0") return true;
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return true; // IPv6 ULA/link-local
  if (PRIVATE_IPV4_PATTERNS.some((re) => re.test(host))) return true;

  return false;
}

/** True if this URL is safe to fetch/navigate — public host, http(s) only. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return !isPrivateOrLocalHost(parsed.hostname);
  } catch {
    return false;
  }
}
