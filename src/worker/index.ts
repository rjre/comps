import { prisma } from "@/lib/db";
import { runDiscovery } from "@/lib/discovery/runDiscovery";
import { runPlatformDiscovery } from "@/lib/scheduler/discoverOnce";
import { runEntryPass } from "@/lib/scheduler/runOnce";
import { runNewsletterPass } from "@/lib/scheduler/subscribeNewsletters";
import { runPrune } from "@/lib/maintenance/prune";
import { processMailbox } from "@/lib/gmail/processMailbox";
import { isGmailConfigured } from "@/lib/gmail/client";

const minutes = (name: string, fallback: number) => Number(process.env[name] ?? fallback) * 60_000;

const FEED_DISCOVERY_INTERVAL_MS = minutes("DISCOVERY_INTERVAL_MINUTES", 30);
const PLATFORM_DISCOVERY_INTERVAL_MS = minutes("PLATFORM_DISCOVERY_INTERVAL_MINUTES", 60);
const ENTRY_INTERVAL_MS = minutes("ENTRY_INTERVAL_MINUTES", 10);
const NEWSLETTER_INTERVAL_MS = minutes("NEWSLETTER_INTERVAL_MINUTES", 180);
const MAIL_SCAN_INTERVAL_MS = minutes("MAIL_SCAN_INTERVAL_MINUTES", 60);
const PRUNE_INTERVAL_MS = minutes("PRUNE_INTERVAL_MINUTES", 360);

/**
 * Single long-running process meant to be the whole app on a Pi: no
 * external cron needed, no dependency on Claude or any other service.
 *
 * Independent loops so a slow or broken one never blocks the others —
 * which matters more than it sounds: feed discovery deliberately takes
 * tens of minutes (per-host politeness delays), and an entry pass can run
 * for the better part of an hour, so any design that ran them in sequence
 * would starve one of them.
 *
 * The entry loop's interval is how often it *checks*, not how often any
 * given competition is entered — src/lib/scheduler/schedule.ts decides
 * that per competition from its own history, so checking every 10 minutes
 * costs almost nothing when nothing is due.
 */
async function loop(name: string, intervalMs: number, fn: () => Promise<unknown>) {
  for (;;) {
    const startedAt = Date.now();
    try {
      await fn();
    } catch (err) {
      // Never let one bad pass end the loop — this process is the whole
      // service, and it's expected to survive individual sites, the
      // network, and its own bugs having a bad day.
      console.error(`[${name}] pass failed:`, err);
    }
    console.log(`[${name}] pass finished in ${Math.round((Date.now() - startedAt) / 1000)}s`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function main() {
  const loops = [
    loop("feed-discovery", FEED_DISCOVERY_INTERVAL_MS, runDiscovery),
    loop("platform-discovery", PLATFORM_DISCOVERY_INTERVAL_MS, runPlatformDiscovery),
    loop("entries", ENTRY_INTERVAL_MS, runEntryPass),
    loop("newsletters", NEWSLETTER_INTERVAL_MS, runNewsletterPass),
    loop("prune", PRUNE_INTERVAL_MS, runPrune),
  ];
  const schedule = [
    `feed discovery ${FEED_DISCOVERY_INTERVAL_MS / 60_000}min`,
    `platform discovery ${PLATFORM_DISCOVERY_INTERVAL_MS / 60_000}min`,
    `entries ${ENTRY_INTERVAL_MS / 60_000}min`,
    `newsletters ${NEWSLETTER_INTERVAL_MS / 60_000}min`,
    `prune ${PRUNE_INTERVAL_MS / 60_000}min`,
  ];

  if (isGmailConfigured()) {
    loops.push(loop("mailbox", MAIL_SCAN_INTERVAL_MS, processMailbox));
    schedule.push(`mail scan ${MAIL_SCAN_INTERVAL_MS / 60_000}min`);
  } else {
    console.log("Gmail not configured — skipping mail scanning (see README: npm run gmail:auth).");
  }

  console.log(`Starting worker — ${schedule.join(", ")}.`);
  await Promise.all(loops);
}

async function shutdown() {
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
