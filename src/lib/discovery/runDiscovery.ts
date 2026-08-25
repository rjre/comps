import Parser from "rss-parser";
import { prisma } from "@/lib/db";
import { resolveEntryUrl } from "./resolveEntryUrl";
import { politeDelay, isAllowedByRobots } from "@/lib/net/politeness";

const parser = new Parser();

/**
 * One discovery pass: fetch every enabled FeedSource, resolve each new
 * item to its real off-site entry URL, and add it as a PENDING Competition
 * for the entry runner to pick up. Safe to call repeatedly — resolution
 * dedupes on Competition.url, and re-adding an existing item is a no-op.
 */
export async function runDiscovery() {
  const sources = await prisma.feedSource.findMany({ where: { enabled: true } });
  if (sources.length === 0) {
    console.log("No feed sources configured — add some at /sources.");
    return;
  }

  let added = 0;
  for (const source of sources) {
    try {
      if (!(await isAllowedByRobots(source.url))) {
        console.warn(`robots.txt disallows fetching feed ${source.url}, skipping`);
        continue;
      }
      await politeDelay(source.url);

      const feed = await parser.parseURL(source.url);
      for (const item of feed.items) {
        if (!item.link) continue;

        const alreadySeen = await prisma.competition.findFirst({
          where: { sourceListingUrl: item.link },
        });
        if (alreadySeen) continue;

        const entryUrl = await resolveEntryUrl(item.link);
        if (!entryUrl) {
          console.log(`Could not resolve an off-site entry URL for "${item.title}", skipping`);
          continue;
        }

        const existingByUrl = await prisma.competition.findUnique({ where: { url: entryUrl } });
        if (existingByUrl) continue;

        await prisma.competition.create({
          data: {
            name: item.title ?? entryUrl,
            url: entryUrl,
            sourceListingUrl: item.link,
            feedSourceId: source.id,
            adapterKey: "generic",
          },
        });
        added++;
      }

      await prisma.feedSource.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date(), lastError: null },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to fetch feed "${source.name}" (${source.url}): ${message}`);
      await prisma.feedSource.update({
        where: { id: source.id },
        data: { lastFetchedAt: new Date(), lastError: message },
      });
    }
  }

  console.log(`Discovery pass complete: ${added} new competition(s) added.`);
  return added;
}

if (require.main === module) {
  runDiscovery()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
