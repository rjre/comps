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
const SEED_FEEDS = [
  { name: "ThePrizeFinder — New Competitions", url: "https://www.theprizefinder.com/feed/new-competitions" },
  { name: "ThePrizeFinder — Top Prizes", url: "https://www.theprizefinder.com/feed/top-prizes" },
  { name: "ThePrizeFinder — Closing Soon", url: "https://www.theprizefinder.com/feed/closing-soon" },
  { name: "GiveawayBase", url: "https://giveawaybase.com/feed/" },
  { name: "The Review Wire — Current Giveaways", url: "https://thereviewwire.com/category/current-giveaways/feed/" },
  { name: "Giveaway Bandit", url: "https://giveawaybandit.com/category/giveaways/feed/" },
  { name: "Dragon Blogger — Contests", url: "https://www.dragonblogger.com/category/contests/feed/" },
  { name: "Contest Corner", url: "https://www.contest-corner.com/feed/" },
];

async function main() {
  for (const feed of SEED_FEEDS) {
    await prisma.feedSource.upsert({
      where: { url: feed.url },
      update: { name: feed.name },
      create: feed,
    });
  }
  console.log(`Seeded ${SEED_FEEDS.length} feed source(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
