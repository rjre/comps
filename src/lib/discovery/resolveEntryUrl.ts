import { DISCOVERY_USER_AGENT } from "@/lib/net/fetchHtml";
import { politeDelay, isAllowedByRobots } from "@/lib/net/politeness";
import { isSafeExternalUrl } from "@/lib/net/ssrf";

/**
 * Listing sites (comping aggregators) publish an item per competition, but
 * the item's own link is usually a page *about* the competition, not the
 * sponsor's entry form — the real form is one click further, often behind
 * a tracking redirect. This follows that chain to the final off-site URL.
 *
 * Best-effort: HTTP-redirect and static-HTML based only (no JS execution) —
 * a listing page that only reveals its outbound link via client-side JS
 * (beyond the two patterns handled below) won't resolve here, and the
 * competition is skipped rather than guessed at.
 */
// "www.example.com" and "example.com" are the same site for our purposes —
// without this, a plain apex-domain link back to the listing site itself
// (e.g. a logo link) reads as a distinct "off-site" candidate and breaks
// the single-candidate fallback below.
function stripWww(host: string): string {
  return host.startsWith("www.") ? host.slice(4) : host;
}

function sameSite(hostA: string, hostB: string): boolean {
  return stripWww(hostA) === stripWww(hostB);
}

// Discovery follows links found inside third-party feed/page content — a
// malicious or compromised source could point one at this app's own host
// or another device on the same network instead of a real sponsor site.
// Every candidate is checked against isSafeExternalUrl before it's fetched
// and again on whatever a fetch's redirect chain actually landed on,
// since "follow redirects" can land somewhere the original URL didn't
// suggest. A resolved URL that fails this is never returned, stored, or
// (later, at entry time) opened with the user's real profile data.
export async function resolveEntryUrl(listingUrl: string): Promise<string | null> {
  if (!isSafeExternalUrl(listingUrl)) return null;
  if (!(await isAllowedByRobots(listingUrl))) return null;
  await politeDelay(listingUrl);

  const listingHost = new URL(listingUrl).host;

  let finalUrl = await followRedirects(listingUrl);
  if (!finalUrl || !isSafeExternalUrl(finalUrl)) return null;

  if (!sameSite(new URL(finalUrl).host, listingHost)) {
    return finalUrl;
  }

  // Same host after following redirects: the listing page itself is what we
  // landed on. Look inside it for the actual outbound "enter"/tracking link.
  const outboundLink = await findOutboundLink(finalUrl, listingHost);
  if (!outboundLink || !isSafeExternalUrl(outboundLink)) return null;

  await politeDelay(outboundLink);
  finalUrl = await followRedirects(outboundLink);
  if (!finalUrl || !isSafeExternalUrl(finalUrl) || sameSite(new URL(finalUrl).host, listingHost)) return null;

  return finalUrl;
}

async function followRedirects(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": DISCOVERY_USER_AGENT },
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
  // freesamples.co.uk uses more than one redirector path prefix across
  // posts ("/go-<slug>/", "/claim-<slug>/") — the leading slash matters on
  // both: a bare "go-"/"claim-" would false-match slugs like
  // "lego-competition" or "reclaim-your-prize".
  "/go-",
  "/claim-",
  "/out/",
  "redirect",
  "enter-now",
  "enter now",
  "enter competition",
  "view competition",
  "visit site",
  "get freebie", // the anchor text is consistent across freesamples.co.uk's path variants
];

// Infrastructure/social domains a competition detail page routinely links
// to that are never the entry form itself — excluded from the "only one
// plain off-site link" fallback so a footer Facebook icon doesn't win by
// being the sole off-site link found.
const NON_ENTRY_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "pinterest.com",
  "youtube.com",
  "tiktok.com",
  "linkedin.com",
  "wix.com",
  "wixstatic.com",
  "parastorage.com",
  "google.com",
  "googleapis.com",
  "gstatic.com",
  "play.google.com",
  "apps.apple.com",
  "landingmail.com", // email-subscribe widget, not an entry form
];

function isNonEntryDomain(host: string): boolean {
  return NON_ENTRY_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

// Third-party widget platforms many blog/small-site giveaways embed
// instead of building their own form — a link to one of these is a much
// stronger "this is the entry" signal than hint text/path matching, and
// crucially lets us pick it out even when the surrounding page is full of
// unrelated off-site links (ad/referral/social widgets) that would
// otherwise make the page look ambiguous. Found via giveawaybase.com: a
// real gleam.io entry link was being drowned out by sidebar crypto/
// referral links, so the plain-single-candidate fallback correctly (but
// unhelpfully) bailed as ambiguous.
const KNOWN_WIDGET_HOSTS = [
  "gleam.io",
  "rafflecopter.com",
  "kingsumo.com",
  "woobox.com",
  "punchtab.com",
  "viralsweep.com",
  "shortstack.com",
  "sweepwidget.com",
  "upviral.com",
];

function isKnownWidgetHost(host: string): boolean {
  return KNOWN_WIDGET_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

async function findOutboundLink(pageUrl: string, sourceHost: string): Promise<string | null> {
  // Already past the robots/rate-limit check for this URL's host at the
  // call site (politeDelay/isAllowedByRobots run in resolveEntryUrl before
  // getting here) — this is the raw fetch, not re-checked.
  const html = await fetchRaw(pageUrl);
  if (!html) return null;

  const embedded = findEmbeddedUrlProp(html, sourceHost);
  if (embedded) return embedded;

  const labeled = findLabeledUrl(html, sourceHost);
  if (labeled) return labeled;

  const hrefRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  const widgetLinks = new Set<string>();
  const hinted: { href: string; score: number }[] = [];
  const plainOffsite = new Set<string>();

  while ((match = hrefRegex.exec(html))) {
    const rawHref = match[1];
    const text = (match[2] ?? "").replace(/<[^>]+>/g, " ").trim().toLowerCase();
    if (!rawHref) continue;

    let href: string;
    let parsed: URL;
    try {
      href = new URL(rawHref, pageUrl).toString();
      parsed = new URL(href);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue; // skip mailto:, tel:, etc.
    if (!isSafeExternalUrl(href)) continue;

    const hrefHost = parsed.host;
    const isOffsite = !sameSite(hrefHost, sourceHost);
    if (isOffsite && isNonEntryDomain(hrefHost)) continue;

    if (isOffsite && isKnownWidgetHost(hrefHost)) {
      widgetLinks.add(href);
      continue;
    }

    const isTrackingPath = OUTBOUND_LINK_HINTS.some((hint) => href.toLowerCase().includes(hint));
    const isHintedText = OUTBOUND_LINK_HINTS.some((hint) => text.includes(hint));

    if (isTrackingPath || isHintedText) {
      // A same-host tracking link (e.g. the site's own /link-track?id=...
      // redirector) still counts — resolveEntryUrl follows its redirect
      // afterwards to find where it actually leads off-site.
      hinted.push({ href, score: (isOffsite ? 2 : 0) + (isTrackingPath ? 1 : 0) + (isHintedText ? 1 : 0) });
    } else if (isOffsite) {
      plainOffsite.add(href);
    }
  }

  // A known widget platform is a strong enough signal to trust even when
  // multiple appear (rare) — unlike the plain-off-site fallback below,
  // where an unrecognized domain being merely singular is the only signal
  // we have.
  if (widgetLinks.size > 0) {
    return [...widgetLinks][0]!;
  }

  if (hinted.length > 0) {
    hinted.sort((a, b) => b.score - a.score);
    return hinted[0]!.href;
  }

  // No hinted link found: if there's exactly one distinct off-site URL on
  // the page at all, it's a confident guess (a sponsor product/entry link
  // with plain anchor text, e.g. the site's own name rather than "Enter").
  // More than one candidate and we don't know which — skip rather than guess.
  return plainOffsite.size === 1 ? [...plainOffsite][0]! : null;
}

// Some JS-framework sites (e.g. Astro islands) server-render the real
// outbound URL into a component's hydration props rather than a plain <a
// href>. Looks for a JSON-ish "...urlLikeKey":[_,"https://..."] pattern
// with an off-site value — HTML-entity-decoded first since these are
// typically embedded as an HTML attribute.
function findEmbeddedUrlProp(html: string, sourceHost: string): string | null {
  const decoded = html.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const propRegex = /"[a-zA-Z]*url[a-zA-Z]*"\s*:\s*\[[^,\]]*,\s*"(https?:\/\/[^"]+)"/gi;
  let match: RegExpExecArray | null;
  while ((match = propRegex.exec(decoded))) {
    try {
      const candidate = match[1]!;
      const host = new URL(candidate).host;
      if (!sameSite(host, sourceHost) && !isNonEntryDomain(host) && isSafeExternalUrl(candidate)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

// Some sites publish the real entry URL as plain labeled text (found in an
// og:description meta tag on contest-corner.com: `Giveaway URL:
// https://...`) — a much more explicit signal than inferring one from
// anchor structure, when it's there.
function findLabeledUrl(html: string, sourceHost: string): string | null {
  const decoded = html.replace(/&amp;/g, "&");
  const labeledUrlRegex = /(?:giveaway|contest|entry|competition)\s*url\s*:?\s*(https?:\/\/[^\s"'<>&]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = labeledUrlRegex.exec(decoded))) {
    try {
      const candidate = match[1]!;
      const host = new URL(candidate).host;
      if (!sameSite(host, sourceHost) && !isNonEntryDomain(host) && isSafeExternalUrl(candidate)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

async function fetchRaw(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": DISCOVERY_USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
