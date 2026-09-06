import { chromium } from "playwright";
import { prisma } from "../src/lib/db";
import { getAdapter } from "../src/lib/automation/registry";
import type { RunLogger } from "../src/lib/logger";

/**
 * Ad-hoc adapter check against a real live page, without creating a Run
 * row or touching Entry history — for validating a new/changed adapter
 * before trusting it to the scheduled worker. Always dry-run.
 *
 * Usage: npx tsx scripts/testAdapter.ts <adapterKey> <competitionUrl>
 */
const consoleLogger: RunLogger = {
  info: async (m) => console.log(`[INFO] ${m}`),
  warn: async (m) => console.log(`[WARN] ${m}`),
  error: async (m) => console.log(`[ERROR] ${m}`),
};

async function main() {
  const [adapterKey, url] = process.argv.slice(2);
  if (!adapterKey || !url) {
    console.error("Usage: npx tsx scripts/testAdapter.ts <adapterKey> <competitionUrl>");
    process.exitCode = 1;
    return;
  }
  const adapter = getAdapter(adapterKey);
  if (!adapter) throw new Error(`No adapter registered for "${adapterKey}"`);

  const profile = await prisma.profile.findFirst();
  if (!profile) throw new Error("No profile configured");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const outcome = await adapter.enterCompetition({
      page,
      competitionUrl: url,
      profile,
      log: consoleLogger,
      dryRun: true,
      previousOutcomes: [],
    });
    console.log("\nOUTCOME:", JSON.stringify(outcome, null, 2));
  } finally {
    await browser.close();
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
