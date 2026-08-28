import { readdir, stat, unlink } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";

/**
 * Housekeeping for an unattended, indefinitely-running install.
 *
 * Both of the things this trims were genuinely unbounded: after three days
 * of running, data/screenshots held 281MB (full-page PNGs of ad-heavy
 * pages, 1-4MB each) on a Raspberry Pi's SD card, and over half of the
 * LogLine table was third-party ad-script console noise. Neither is fatal
 * on day three and both are fatal on day three hundred, which is the
 * timescale this is supposed to run on.
 *
 * Entry and Run rows are deliberately never pruned: the scheduler decides
 * what's due purely from entry history, so deleting entries would make a
 * daily draw look never-entered and re-enter it immediately.
 */

const SCREENSHOT_DIR = path.join(process.cwd(), "data", "screenshots");

const SCREENSHOT_MAX_AGE_DAYS = Number(process.env.SCREENSHOT_MAX_AGE_DAYS ?? 14);
const SCREENSHOT_MAX_TOTAL_MB = Number(process.env.SCREENSHOT_MAX_TOTAL_MB ?? 200);
const LOG_MAX_AGE_DAYS = Number(process.env.LOG_MAX_AGE_DAYS ?? 30);

/**
 * Page-level console/pageerror lines the old runner wrote straight to the
 * DB. New runs buffer and filter these (see automation/pageNoise.ts), so
 * this only has historic rows to clear — but it's kept unconditional so a
 * future adapter that logs the same way can't quietly refill the table.
 */
const NOISE_PREFIXES = ["Page console error:", "Page error:"];

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86_400_000);
}

async function pruneScreenshots(): Promise<void> {
  let names: string[];
  try {
    names = await readdir(SCREENSHOT_DIR);
  } catch {
    console.log("No screenshot directory yet, nothing to prune.");
    return;
  }

  const files = [];
  for (const name of names) {
    const full = path.join(SCREENSHOT_DIR, name);
    try {
      const info = await stat(full);
      if (info.isFile()) files.push({ full, name, mtime: info.mtimeMs, size: info.size });
    } catch {
      // Raced with something else deleting it — nothing to do.
    }
  }

  const cutoff = daysAgo(SCREENSHOT_MAX_AGE_DAYS).getTime();
  const doomed = new Set(files.filter((f) => f.mtime < cutoff).map((f) => f.full));

  // Then, if what's left is still over the size cap, drop oldest-first
  // until it isn't. Age alone isn't enough of a guard: a run that fails
  // every competition writes ~40MB in one pass.
  const budget = SCREENSHOT_MAX_TOTAL_MB * 1024 * 1024;
  const survivors = files.filter((f) => !doomed.has(f.full)).sort((a, b) => b.mtime - a.mtime);
  let kept = 0;
  for (const file of survivors) {
    kept += file.size;
    if (kept > budget) doomed.add(file.full);
  }

  let freed = 0;
  for (const file of files) {
    if (!doomed.has(file.full)) continue;
    try {
      await unlink(file.full);
      freed += file.size;
    } catch {
      // Already gone; fine.
    }
  }
  console.log(
    `Screenshots: removed ${doomed.size} of ${files.length} file(s), freed ${(freed / 1024 / 1024).toFixed(1)}MB ` +
      `(keeping ${SCREENSHOT_MAX_AGE_DAYS} days, max ${SCREENSHOT_MAX_TOTAL_MB}MB).`,
  );
}

async function pruneLogLines(): Promise<void> {
  const noise = await prisma.logLine.deleteMany({
    where: { OR: NOISE_PREFIXES.map((prefix) => ({ message: { startsWith: prefix } })) },
  });
  const old = await prisma.logLine.deleteMany({ where: { createdAt: { lt: daysAgo(LOG_MAX_AGE_DAYS) } } });
  console.log(
    `Log lines: removed ${noise.count} third-party page-noise line(s) and ${old.count} line(s) older than ${LOG_MAX_AGE_DAYS} days.`,
  );
}

async function main() {
  await pruneScreenshots();
  await pruneLogLines();
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
