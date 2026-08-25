import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Verified (fetched and confirmed to return valid RSS/Atom, Aug 2026) UK/US
// giveaway-listing feeds. Re-verify before re-adding anything removed here —
// sites change.
//
// Deliberately excluded:
// - superlucky.me: /feed/ is behind a bot-challenge redirect
//   (/.well-known/sgcaptcha/...) — we don't defeat anti-bot measures.
// - freetvcompetitions.com: TLS cert doesn't match the hostname
//   (cert is for a different domain) — not safe to trust.
// - simplyprizes.com: competitions.php has no static listing content —
//   items are loaded dynamically (JS/AJAX), not scraped for now.
// - latestdeals.co.uk: returns an explicit AWS WAF bot challenge
//   (x-amzn-waf-action: challenge) — we don't defeat anti-bot measures.
// - freestuff.co.uk / latestfreestuff.co.uk: same publisher, mirrored
//   content. Checked freestuff.co.uk's actual items: alongside real
//   giveaways/samples it mixes in generic deals ("Pillows From £7"),
//   unrelated content ("Free NHS Prescription To Your Door"), and online
//   casino free-spins/no-deposit promos — that last category we actively
//   don't want to auto-fill personal details into (a different, more
//   sensitive kind of signup than a chocolate hamper giveaway). Dropped
//   both for this and the mirroring.
// - heyitsfree.net, gg.deals: real feeds, but mostly discount codes / free
//   game keys rather than forms this app can actually fill in.
// - ozbargain.com.au/freebies/feed (not /competition/feed, which IS
//   included below): that one's mostly discount codes, not entries.
// - reddit.com (r/sweepstakes etc.): real .rss endpoints exist, but Reddit
//   aggressively rate-limits (429s seen) and its ToS restricts automated
//   scraping outside their official API — not worth fighting.
// - aussiecomps.com: no RSS/autodiscovery found; would need an HTML
//   scraper like competitions.ie/allfreestuff — not built yet.
// - giveawaybandit.com/category/giveaways/feed/: valid RSS, "giveaways" in
//   the URL, but checked several items and most are unrelated lifestyle
//   posts (UV safety, movie trailers, home decor) with the word
//   "giveaway" only in the site's own branding/nav — real giveaways are a
//   small minority. Low enough precision it's not worth the wasted
//   resolution attempts.
// - joannedewberry.co.uk/giveaway/feed/: looked fine at a glance (valid
//   RSS, 200 OK) but the channel title is "Comments on: " and
//   /giveaway/ (no feed) 404s — this is a WordPress comments feed for a
//   single (now-gone) post, not the giveaway category at all. No working
//   URL for this site's giveaway content found; not worth guessing paths.
// (Both were seeded briefly; REMOVED_FEEDS below cleans up anyone who
// already ran db:seed with them.)
const SEED_FEEDS = [
  { name: "ThePrizeFinder — New Competitions", url: "https://www.theprizefinder.com/feed/new-competitions" },
  { name: "ThePrizeFinder — Top Prizes", url: "https://www.theprizefinder.com/feed/top-prizes" },
  { name: "ThePrizeFinder — Closing Soon", url: "https://www.theprizefinder.com/feed/closing-soon" },
  { name: "GiveawayBase", url: "https://giveawaybase.com/feed/" },
  { name: "The Review Wire — Current Giveaways", url: "https://thereviewwire.com/category/current-giveaways/feed/" },
  { name: "Dragon Blogger — Contests", url: "https://www.dragonblogger.com/category/contests/feed/" },
  { name: "Contest Corner", url: "https://www.contest-corner.com/feed/" },
  { name: "Free Samples — Free Competitions", url: "https://www.freesamples.co.uk/category/free-competitions/feed/" },
  { name: "OzBargain — Competitions", url: "https://www.ozbargain.com.au/competition/feed" },
  // Mixes free-to-enter giveaways with paid lottery/raffle promotions (e.g.
  // charity home lotteries) — the latter have no simple free-entry form and
  // the adapter should just fail cleanly on those, not a reason to exclude
  // the feed.
  { name: "Competitions.com.au", url: "https://www.competitions.com.au/rss.cfm" },
];

// Sites with no RSS feed but a scrapable static-HTML listing page — see
// src/lib/discovery/scrapers. url here is the listing page, not a feed.
const SEED_HTML_SOURCES = [
  {
    name: "Competitions.ie — New Competitions",
    url: "https://competitions.ie/new-competitions/",
    scraperKey: "competitions-ie",
  },
  {
    name: "AllFreeStuff — Free Competitions",
    url: "https://www.allfreestuff.co.uk/free-competitions",
    scraperKey: "allfreestuff",
  },
];

// Feeds seeded in the past that turned out to be low quality — removed
// from SEED_FEEDS above, and deleted here too for anyone re-running seed
// on a database that already has them.
const REMOVED_FEEDS = [
  "https://giveawaybandit.com/category/giveaways/feed/",
  "https://joannedewberry.co.uk/giveaway/feed/",
  "https://freestuff.co.uk/feed/",
];

async function main() {
  const removed = await prisma.feedSource.deleteMany({ where: { url: { in: REMOVED_FEEDS } } });
  if (removed.count > 0) console.log(`Removed ${removed.count} deprecated feed source(s).`);

  for (const feed of SEED_FEEDS) {
    await prisma.feedSource.upsert({
      where: { url: feed.url },
      update: { name: feed.name, kind: "rss" },
      create: { ...feed, kind: "rss" },
    });
  }
  for (const source of SEED_HTML_SOURCES) {
    await prisma.feedSource.upsert({
      where: { url: source.url },
      update: { name: source.name, kind: "html", scraperKey: source.scraperKey },
      create: { ...source, kind: "html" },
    });
  }
  console.log(`Seeded ${SEED_FEEDS.length} RSS feed(s) and ${SEED_HTML_SOURCES.length} HTML listing source(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
