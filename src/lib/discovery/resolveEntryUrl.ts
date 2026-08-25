import { politeDelay, isAllowedByRobots } from "@/lib/net/politeness";

const USER_AGENT =
  "Mozilla/5.0 (compatible; comps-entry-assistant/0.1; personal use, single identity, respects robots.txt)";

/**
 * Listing sites (comping aggregators) publish an item per competition, but
 * the item's own link is usually a page *about* the competition, not the
 * sponsor's entry form — the real form is one click further, often behind
 * a tracking redirect. This follows that chain to the final off-site URL.
 *
 * Best-effort: HTTP-redirect based only (no JS execution) — a listing page
 * that requires clicking a JS-driven button to leave the site won't
 * resolve here and the competition is skipped rather than guessed at.
 */
export async function resolveEntryUrl(listingUrl: string): Promise<string | null> {
  if (!(await isAllowedByRobots(listingUrl))) return null;
  await politeDelay(listingUrl);

  const listingHost = new URL(listingUrl).host;

  let finalUrl = await followRedirects(listingUrl);
  if (!finalUrl) return null;

  if (new URL(finalUrl).host !== listingHost) {
    return finalUrl;
  }

  // Same host after following redirects: the listing page itself is what we
  // landed on. Look inside it for the actual outbound "enter"/tracking link.
  const outboundLink = await findOutboundLink(finalUrl, listingHost);
  if (!outboundLink) return null;

  await politeDelay(outboundLink);
  finalUrl = await followRedirects(outboundLink);
  if (!finalUrl || new URL(finalUrl).host === listingHost) return null;

  return finalUrl;
}

async function followRedirects(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    return res.url || url;
  } catch {
    return null;
  }
}

const OUTBOUND_LINK_HINTS = [
  "link-track",
  "go/",
  "/out/",
  "redirect",
  "enter-now",
  "enter now",
  "enter competition",
  "view competition",
  "visit site",
];

async function findOutboundLink(pageUrl: string, sourceHost: string): Promise<string | null> {
  try {
    const res = await fetch(pageUrl, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const html = await res.text();

    const hrefRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match: RegExpExecArray | null;
    const candidates: { href: string; score: number }[] = [];

    while ((match = hrefRegex.exec(html))) {
      const rawHref = match[1];
      const text = (match[2] ?? "").replace(/<[^>]+>/g, " ").trim().toLowerCase();
      if (!rawHref) continue;

      let href: string;
      try {
        href = new URL(rawHref, pageUrl).toString();
      } catch {
        continue;
      }

      const hrefHost = new URL(href).host;
      const isTrackingPath = OUTBOUND_LINK_HINTS.some((hint) => href.toLowerCase().includes(hint));
      const isHintedText = OUTBOUND_LINK_HINTS.some((hint) => text.includes(hint));
      const isOffsite = hrefHost !== sourceHost;

      if (!isTrackingPath && !isHintedText) continue;

      // Off-site + hinted text/path is the strongest signal; a same-host
      // tracking-path link (redirector living on the listing site) is next.
      const score = (isOffsite ? 2 : 0) + (isTrackingPath ? 1 : 0) + (isHintedText ? 1 : 0);
      candidates.push({ href, score });
    }

    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.href ?? null;
  } catch {
    return null;
  }
}
