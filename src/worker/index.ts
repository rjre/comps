import { prisma } from "@/lib/db";
import { runDiscovery } from "@/lib/discovery/runDiscovery";
import { runEntryPass } from "@/lib/scheduler/runOnce";
import { scanForWins } from "@/lib/gmail/scanForWins";
import { isGmailConfigured } from "@/lib/gmail/client";

const DISCOVERY_INTERVAL_MS = Number(process.env.DISCOVERY_INTERVAL_MINUTES ?? 30) * 60_000;
const ENTRY_INTERVAL_MS = Number(process.env.ENTRY_INTERVAL_MINUTES ?? 10) * 60_000;
const MAIL_SCAN_INTERVAL_MS = Number(process.env.MAIL_SCAN_INTERVAL_MINUTES ?? 60) * 60_000;

/**
 * Single long-running process meant to be the whole app on a Pi: no
 * external cron needed, no dependency on Claude or any other service.
 * Independent loops (discovery, entries, and mail-scan if configured) so
 * a slow/broken one never blocks the others.
 */
async function loop(name: string, intervalMs: number, fn: () => Promise<unknown>) {
  while (true) {
    try {
      await fn();
    } catch (err) {
      console.error(`[${name}] pass failed:`, err);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

async function main() {
  console.log(
    `Starting worker — discovery every ${DISCOVERY_INTERVAL_MS / 60_000}min, entries every ${ENTRY_INTERVAL_MS / 60_000}min`,
  );

  const loops = [
    loop("discovery", DISCOVERY_INTERVAL_MS, runDiscovery),
    loop("entries", ENTRY_INTERVAL_MS, runEntryPass),
  ];

  if (isGmailConfigured()) {
    console.log(`Gmail configured — scanning for wins every ${MAIL_SCAN_INTERVAL_MS / 60_000}min`);
    loops.push(loop("mail-scan", MAIL_SCAN_INTERVAL_MS, scanForWins));
  } else {
    console.log("Gmail not configured — skipping mail scanning (see README: npm run gmail:auth).");
  }

  await Promise.all(loops);
}

process.on("SIGTERM", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
