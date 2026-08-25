import { chromium } from "playwright";
import { prisma } from "@/lib/db";
import { getAdapter } from "@/lib/automation/registry";

/**
 * Runs one pass over eligible competitions: open, not already at their own
 * entry cap, and have a registered adapter. Intended to be invoked on a
 * schedule (cron/task scheduler) for "low touch" operation — see README.
 */
async function runOnce() {
  const profile = await prisma.profile.findFirst();
  if (!profile) {
    console.error("No profile configured yet — set one up at /profile first.");
    return;
  }

  const now = new Date();
  const candidates = await prisma.competition.findMany({
    where: {
      status: "PENDING",
      OR: [{ closesAt: null }, { closesAt: { gt: now } }],
    },
    include: { entries: true },
  });

  if (candidates.length === 0) {
    console.log("No eligible competitions to enter.");
    return;
  }

  const browser = await chromium.launch();
  try {
    for (const competition of candidates) {
      const alreadyEntered = competition.entries.filter((e) => e.status === "SUCCESS").length;
      if (alreadyEntered >= competition.maxEntries) {
        await prisma.entry.create({
          data: {
            competitionId: competition.id,
            status: "SKIPPED_ALREADY_ENTERED",
          },
        });
        continue;
      }

      const adapter = getAdapter(competition.adapterKey);
      if (!adapter) {
        console.warn(`No adapter registered for "${competition.adapterKey}", skipping ${competition.name}`);
        continue;
      }

      const page = await browser.newPage();
      try {
        const outcome = await adapter.enterCompetition(page, competition.url, profile);
        await prisma.entry.create({
          data: {
            competitionId: competition.id,
            status: outcome.status,
            message: "message" in outcome ? outcome.message : undefined,
          },
        });
        if (outcome.status === "SUCCESS") {
          console.log(`Entered: ${competition.name}`);
        } else {
          console.log(`${outcome.status}: ${competition.name} — ${outcome.message ?? ""}`);
        }
      } catch (err) {
        await prisma.entry.create({
          data: {
            competitionId: competition.id,
            status: "FAILED",
            message: err instanceof Error ? err.message : String(err),
          },
        });
        console.error(`Failed: ${competition.name}`, err);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

runOnce()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
