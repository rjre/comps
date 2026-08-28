import type { DiscoveredCompetition, DiscoveryContext, DiscoverySource } from "./types";

/**
 * Discovers competitions on the DMRI reader-comps platform (the
 * white-label engine behind comps.marieclaire.co.uk and its Future PLC
 * sibling magazine sites — see adapters/dmriComps.ts for the full
 * description of the platform).
 *
 * This platform is worth discovering automatically in a way one-off
 * competitions aren't: each site runs a couple of dozen concurrent DAILY
 * prize draws, rotating constantly as old ones close and new ones open,
 * and every single one of them is entered by the same existing adapter.
 * So finding them is pure gain — no new adapter code, no new site to
 * audit, just rows pointing at an adapter that already works.
 *
 * Only the platform's own index pages are read, and only the two facts a
 * Competition row needs are taken from each competition page: its real
 * title (the `<h1>`; the `<title>` tag is truncated with an ellipsis) and
 * its own stated closing date ("This competition ends on DD/MM/YYYY").
 * Both were confirmed directly against live pages.
 */

/** Sites this platform is known to run, confirmed directly. Tracked-competition origins are added on top at runtime. */
const SEED_ORIGINS = [
  "https://comps.marieclaire.co.uk",
  "https://comps.womanmagazine.co.uk",
  "https://competitions.womansweekly.com",
  "https://comps.whatsontv.co.uk",
];

/** The site 403s Playwright's default UA; be equally explicit here. */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Index pagination is `/index/index/page/N.php`; stop early when a page adds nothing new. */
const MAX_INDEX_PAGES = 12;

/** Courtesy gap between requests to the same site. */
const REQUEST_DELAY_MS = 700;

/** Upper bound on a discovered daily draw's entry cap, however far off its closing date is. */
const MAX_DAILY_ENTRIES = 60;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchText(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&pound;/g, "£");
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Competition hrefs on the index carry a stray trailing space in the attribute — trim before resolving. */
function competitionUrlsOn(html: string, origin: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/href="([^"]*\/competition\/[^"]+\.php)\s*"/g)) {
    const href = match[1]!.trim();
    try {
      found.add(new URL(href, origin).toString());
    } catch {
      // Malformed href; skip.
    }
  }
  return [...found];
}

/** "This competition ends on 21/09/2026." — the site's own DD/MM/YYYY, read as end-of-day UK time. */
function closingDateFrom(html: string): Date | null {
  const match = /competition ends on\s*(\d{2})\/(\d{2})\/(\d{4})/i.exec(html);
  if (!match) return null;
  const [, day, month, year] = match;
  const closes = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 23, 59, 0));
  return Number.isNaN(closes.getTime()) ? null : closes;
}

function titleFrom(html: string): string | null {
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = h1 ? stripTags(h1[1]!) : "";
  return title.length > 0 ? title : null;
}

/** "Win a ... | Marie Claire Competitions" — the part after the pipe names the magazine. */
function siteNameFrom(html: string, origin: string): string {
  const match = /<title>([\s\S]*?)<\/title>/i.exec(html);
  const parts = match ? stripTags(match[1]!).split("|") : [];
  const tail = parts.length > 1 ? parts[parts.length - 1]!.trim() : "";
  return tail || new URL(origin).hostname;
}

export const dmriDiscoverySource: DiscoverySource = {
  key: "dmri-comps",
  describe: "DMRI reader-competitions sites (daily prize draws, entered by the dmri-comps adapter)",

  async discover(ctx: DiscoveryContext, extraOrigins: string[]): Promise<DiscoveredCompetition[]> {
    const origins = [...new Set([...SEED_ORIGINS, ...extraOrigins])];
    const discovered: DiscoveredCompetition[] = [];

    for (const origin of origins) {
      const seen = new Set<string>();

      for (let pageNumber = 1; pageNumber <= MAX_INDEX_PAGES; pageNumber++) {
        const indexUrl = pageNumber === 1 ? `${origin}/` : `${origin}/index/index/page/${pageNumber}.php`;
        const html = await fetchText(indexUrl);
        await sleep(REQUEST_DELAY_MS);
        if (!html) {
          if (pageNumber === 1) await ctx.log(`${origin}: index not reachable, skipping this site`);
          break;
        }
        const urls = competitionUrlsOn(html, origin);
        const fresh = urls.filter((url) => !seen.has(url));
        if (fresh.length === 0) break; // pagination exhausted (or looping back on itself)
        fresh.forEach((url) => seen.add(url));
      }

      const candidates = [...seen].filter((url) => !ctx.known.has(url));
      await ctx.log(`${origin}: ${seen.size} competition(s) listed, ${candidates.length} not yet tracked`);

      for (const url of candidates) {
        const html = await fetchText(url);
        await sleep(REQUEST_DELAY_MS);
        if (!html) {
          await ctx.log(`  could not read ${url}, skipping`);
          continue;
        }
        const title = titleFrom(html);
        if (!title) {
          await ctx.log(`  no title found on ${url}, skipping`);
          continue;
        }
        const closesAt = closingDateFrom(html);
        if (closesAt && closesAt <= new Date()) {
          await ctx.log(`  "${title}" has already closed, skipping`);
          continue;
        }

        // Daily draw: allow one entry per remaining day. The scheduler's
        // 24h entry interval is what actually paces it; maxEntries is only
        // the backstop that retires the row if the closing date is wrong.
        const daysLeft = closesAt
          ? Math.ceil((closesAt.getTime() - Date.now()) / 86_400_000)
          : 30;
        discovered.push({
          name: `${siteNameFrom(html, origin)} — ${title}`,
          url,
          adapterKey: "dmri-comps",
          closesAt,
          maxEntries: Math.max(1, Math.min(daysLeft + 1, MAX_DAILY_ENTRIES)),
          entryIntervalHours: 24,
          notes:
            `Found automatically by the dmri-comps discovery source on ${new Date().toISOString().slice(0, 10)} ` +
            `from ${origin}'s own competition index. Daily prize draw; ` +
            `${closesAt ? `closes ${closesAt.toISOString().slice(0, 10)} per the page's own "ends on" line` : "no closing date stated on the page"}. ` +
            `No researched trivia answer — the adapter derives one from the page's own copy, and declines to enter if the copy doesn't settle it.`,
        });
      }
    }

    return discovered;
  },
};
