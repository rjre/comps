import Parser from "rss-parser";
import { prisma } from "@/lib/db";
import { resolveEntryUrl } from "./resolveEntryUrl";
import { getScraper } from "./scrapers/registry";
import type { ListingItem } from "./scrapers/types";
import { politeDelay, isAllowedByRobots } from "@/lib/net/politeness";
import { DISCOVERY_USER_AGENT } from "@/lib/net/fetchHtml";
import { isSafeExternalUrl } from "@/lib/net/ssrf";
import { acquireLock } from "@/lib/scheduler/lock";
import type { FeedSource } from "@prisma/client";

const parser = new Parser();

// Resolved entry URLs on these hosts can't actually be entered by this app:
// social platforms require logged-in like/follow/comment actions (a
// deliberately separate, riskier undertaking than filling a web form — see
// README), and these are plain marketing signups, not competition entries.
// Recorded as SKIPPED (not re-attempted, not re-resolved every pass) rather
// than silently dropped, so /competitions still shows what was found.
const NON_ENTERABLE_HOSTS = [
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "pinterest.com",
  "youtube.com",
  "linkedin.com",
  "mailchi.mp",
  "campaign-archive.com",
  "linktr.ee",
];

function isNonEnterableHost(host: string): boolean {
  return NON_ENTERABLE_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

/**
 * One discovery pass: fetch every enabled FeedSource (RSS feed, or an
 * HTML listing page for sites with no feed — see src/lib/discovery/scrapers),
 * resolve each new item to its real off-site entry URL, and add it as a
 * PENDING Competition for the entry runner to pick up. Safe to call
 * repeatedly — resolution dedupes on Competition.url, and re-adding an
 * existing item is a no-op.
 */
export async function runDiscovery() {
  // The other passes each take one (see lock.ts); this is the last that
  // didn't. A pass takes tens of minutes because of the per-host
  // politeness delays, so a hand-started one overlapping the worker's is
  // easy to cause and just doubles the requests every source sees.
  const lock = await acquireLock("feed-discovery");
  if (!lock) {
    console.log("Another feed-discovery pass is already running — leaving it to finish.");
    return;
  }
  try {
    const sources = await prisma.feedSource.findMany({ where: { enabled: true } });
    if (sources.length === 0) {
      console.log("No feed sources configured — add some at /sources.");
      return;
    }

    let added = 0;
    for (const source of sources) {
      try {
        const items = source.kind === "html" ? await fetchHtmlListingItems(source) : await fetchRssItems(source);

        for (const item of items) {
          added += (await processListingItem(item, source)) ? 1 : 0;
        }

        await prisma.feedSource.update({
          where: { id: source.id },
          data: { lastFetchedAt: new Date(), lastError: null },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Failed to fetch source "${source.name}" (${source.url}): ${message}`);
        await prisma.feedSource.update({
          where: { id: source.id },
          data: { lastFetchedAt: new Date(), lastError: message },
        });
      }
    }

    console.log(`Discovery pass complete: ${added} new fillable competition(s) added.`);
    return added;
  } finally {
    await lock.release();
  }
}

async function fetchRssItems(source: FeedSource): Promise<ListingItem[]> {
  if (!(await isAllowedByRobots(source.url, DISCOVERY_USER_AGENT))) {
    console.warn(`robots.txt disallows fetching feed ${source.url}, skipping`);
    return [];
  }
  await politeDelay(source.url);

  const feed = await parser.parseURL(source.url);
  return feed.items
    .filter((item): item is typeof item & { link: string } => Boolean(item.link))
    .map((item) => ({ title: item.title ?? item.link, link: item.link }));
}

async function fetchHtmlListingItems(source: FeedSource): Promise<ListingItem[]> {
  const scraper = source.scraperKey ? getScraper(source.scraperKey) : undefined;
  if (!scraper) {
    console.warn(`No scraper registered for "${source.scraperKey}" (source "${source.name}"), skipping`);
    return [];
  }
  return scraper.fetchItems(source.url);
}

/** Returns true if a new Competition was created. */
async function processListingItem(item: ListingItem, source: FeedSource): Promise<boolean> {
  const alreadySeen = await prisma.competition.findFirst({ where: { sourceListingUrl: item.link } });
  if (alreadySeen) return false;

  const entryUrl = await resolveEntryUrl(item.link);
  if (!entryUrl) {
    console.log(`Could not resolve an off-site entry URL for "${item.title}", skipping`);
    return false;
  }
  // resolveEntryUrl already rejects private/local hosts — this is a second
  // gate right at the boundary before anything gets stored as a
  // Competition.url that the entry pass will later navigate to with the
  // user's real profile data.
  if (!isSafeExternalUrl(entryUrl)) {
    console.log(`"${item.title}" resolved to a private/local address (${entryUrl}), refusing to track it`);
    return false;
  }

  const existingByUrl = await prisma.competition.findUnique({ where: { url: entryUrl } });
  if (existingByUrl) return false;

  const host = new URL(entryUrl).host;
  const nonEnterable = isNonEnterableHost(host);
  if (nonEnterable) {
    console.log(`"${item.title}" resolves to ${host} — not a fillable form, recording as skipped`);
  }

  await prisma.competition.create({
    data: {
      name: item.title || entryUrl,
      url: entryUrl,
      sourceListingUrl: item.link,
      feedSourceId: source.id,
      adapterKey: "generic",
      status: nonEnterable ? "SKIPPED" : "PENDING",
      notes: nonEnterable ? `Entry lives on ${host} — a social-account action or newsletter signup, not a fillable form.` : undefined,
    },
  });
  return !nonEnterable;
}

if (require.main === module) {
  runDiscovery()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
