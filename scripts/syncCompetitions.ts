import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "../src/lib/db";

/**
 * A cloud-scheduled routine researches new competitions and writes adapter
 * code, but runs in an isolated sandbox with no access to this machine's
 * Prisma DB (and no access to the real profile it would need to actually
 * enter anything). Instead it appends candidates to
 * prisma/pending-competitions.json and pushes. This script — run locally,
 * on the real DB, before each run:entries — turns those candidates into
 * real Competition rows. Idempotent: Competition.url is unique, so
 * re-running a synced entry is a no-op.
 */

interface PendingCompetition {
  name: string;
  url: string;
  adapterKey: string;
  closesAt?: string | null;
  maxEntries?: number;
  /** For repeatable draws: minimum hours between counted entries (24 for a daily draw). */
  entryIntervalHours?: number | null;
  notes?: string;
}

async function main() {
  const file = path.join(process.cwd(), "prisma", "pending-competitions.json");
  const raw = await readFile(file, "utf-8").catch(() => "[]");
  const pending: PendingCompetition[] = JSON.parse(raw);

  if (pending.length === 0) {
    console.log("No pending competitions to sync.");
    return;
  }

  for (const item of pending) {
    const existing = await prisma.competition.findUnique({ where: { url: item.url } });
    if (existing) {
      console.log(`Already tracked, skipping: ${item.name}`);
      continue;
    }
    await prisma.competition.create({
      data: {
        name: item.name,
        url: item.url,
        adapterKey: item.adapterKey,
        closesAt: item.closesAt ? new Date(item.closesAt) : null,
        maxEntries: item.maxEntries ?? 1,
        entryIntervalHours: item.entryIntervalHours ?? null,
        notes: item.notes,
      },
    });
    console.log(`Registered new competition: ${item.name} (adapter: ${item.adapterKey})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
