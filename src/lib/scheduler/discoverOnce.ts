import { prisma } from "@/lib/db";
import { createRunLogger } from "@/lib/logger";
import { getAdapter } from "@/lib/automation/registry";
import { discoverySources } from "@/lib/discovery/registry";
import { acquireLock } from "@/lib/scheduler/lock";

/**
 * One discovery pass: ask every registered discovery source what's
 * currently open on its platform, and register anything not already
 * tracked. Idempotent — Competition.url is unique and known URLs are
 * filtered out before their pages are even fetched.
 *
 * Runs as its own Run row so the pass shows up in /runs alongside entry
 * runs, rather than only in whatever captured the process's stdout.
 */
export async function runPlatformDiscovery() {
  // Separate lock from the entry pass — the two are safe to run
  // concurrently, two discovery passes just duplicate each other's work.
  const lock = await acquireLock("discovery");
  if (!lock) {
    console.log("Another discovery pass is already running — leaving it to finish.");
    return;
  }

  const run = await prisma.run.create({ data: {} });
  const log = createRunLogger(run.id);
  let registered = 0;

  try {
    await log.info(`Discovery pass started across ${discoverySources.length} source(s).`);

    const tracked = await prisma.competition.findMany({ select: { url: true, adapterKey: true } });
    const known = new Set(tracked.map((c) => c.url));

    for (const source of discoverySources) {
      // Origins already proven to work for this platform, so a site added
      // by hand (or by the cloud research routine) is crawled from then on
      // without needing to be added to the source's seed list too.
      const extraOrigins = [
        ...new Set(
          tracked
            .filter((c) => c.adapterKey === source.key)
            .map((c) => {
              try {
                return new URL(c.url).origin;
              } catch {
                return "";
              }
            })
            .filter(Boolean),
        ),
      ];

      await log.info(`Source "${source.key}": ${source.describe}`);
      let found;
      try {
        found = await source.discover({ log: (m) => log.info(`  ${m}`), known }, extraOrigins);
      } catch (err) {
        await log.error(`Source "${source.key}" failed: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      for (const candidate of found) {
        // A source proposing a competition for an adapter that isn't
        // registered would create a permanently un-enterable row.
        if (!getAdapter(candidate.adapterKey)) {
          await log.warn(`Skipping "${candidate.name}" — no adapter registered for "${candidate.adapterKey}"`);
          continue;
        }
        if (known.has(candidate.url)) continue;
        try {
          const created = await prisma.competition.create({
            data: {
              name: candidate.name,
              url: candidate.url,
              adapterKey: candidate.adapterKey,
              closesAt: candidate.closesAt,
              maxEntries: candidate.maxEntries,
              entryIntervalHours: candidate.entryIntervalHours,
              notes: candidate.notes,
            },
          });
          known.add(candidate.url);
          registered += 1;
          await log.info(`Registered: ${candidate.name}`, created.id);
        } catch (err) {
          // Almost certainly the unique-url constraint racing another
          // pass; anything else is worth seeing but not worth aborting on.
          await log.warn(`Could not register "${candidate.name}": ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    await log.info(`Discovery finished — ${registered} new competition(s) registered.`);
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "COMPLETED", finishedAt: new Date(), candidateCount: registered },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.error(`Discovery failed: ${message}`);
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage: message },
    });
    throw err;
  } finally {
    await lock.release();
  }
}

// Also runnable directly (`npm run ...`) as well as from the worker's
// loop, so a pass can still be driven by hand for testing without
// starting the whole worker. `require.main` is undefined when this module
// is imported, so importing it never kicks off a pass as a side effect.
if (require.main === module) {
  runPlatformDiscovery()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
