import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "../src/lib/db";

/**
 * Mirrors scripts/syncCompetitions.ts for newsletter sources — turns
 * prisma/pending-newsletters.json entries (proposed by the cloud research
 * routine) into real NewsletterSource rows. Idempotent on url.
 */

interface PendingNewsletter {
  name: string;
  url: string;
  adapterKey: string;
  notes?: string;
}

async function main() {
  const file = path.join(process.cwd(), "prisma", "pending-newsletters.json");
  const raw = await readFile(file, "utf-8").catch(() => "[]");
  const pending: PendingNewsletter[] = JSON.parse(raw);

  if (pending.length === 0) {
    console.log("No pending newsletter sources to sync.");
    return;
  }

  for (const item of pending) {
    const existing = await prisma.newsletterSource.findUnique({ where: { url: item.url } });
    if (existing) {
      console.log(`Already tracked, skipping: ${item.name}`);
      continue;
    }
    await prisma.newsletterSource.create({
      data: { name: item.name, url: item.url, adapterKey: item.adapterKey, notes: item.notes },
    });
    console.log(`Registered new newsletter source: ${item.name} (adapter: ${item.adapterKey})`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
