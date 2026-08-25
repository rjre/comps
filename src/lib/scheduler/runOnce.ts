import { chromium } from "playwright";
import { prisma } from "@/lib/db";
import { getAdapter } from "@/lib/automation/registry";
import { politeDelay } from "@/lib/net/politeness";

const ENTRY_CONCURRENCY = Number(process.env.ENTRY_CONCURRENCY ?? 2);

/**
 * Runs one pass over eligible competitions: open, not already at their own
 * entry cap, and have a registered adapter. A small worker pool processes
 * them concurrently (bounded — a Pi has limited RAM/CPU for headless
 * Chromium instances), while politeDelay still throttles repeat hits to
 * any single host regardless of how many workers are running.
 */
export async function runEntryPass(): Promise<{ processed: number }> {
  const profileOrNull = await prisma.profile.findFirst();
  if (!profileOrNull) {
    console.error("No profile configured yet — set one up at /profile first.");
    return { processed: 0 };
  }
  const profile = profileOrNull;

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
    return { processed: 0 };
  }

  const browser = await chromium.launch();
  let index = 0;
  let processed = 0;

  async function worker() {
    while (index < candidates.length) {
      const competition = candidates[index++];
      if (!competition) return;

      const alreadyEntered = competition.entries.filter((e) => e.status === "SUCCESS").length;
      if (alreadyEntered >= competition.maxEntries) {
        await prisma.entry.create({
          data: { competitionId: competition.id, status: "SKIPPED_ALREADY_ENTERED" },
        });
        continue;
      }

      const adapter = getAdapter(competition.adapterKey);
      if (!adapter) {
        console.warn(`No adapter registered for "${competition.adapterKey}", skipping ${competition.name}`);
        continue;
      }

      await politeDelay(competition.url);

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
        processed++;
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
  }

  try {
    await Promise.all(Array.from({ length: ENTRY_CONCURRENCY }, () => worker()));
  } finally {
    await browser.close();
  }

  return { processed };
}

if (require.main === module) {
  runEntryPass()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
