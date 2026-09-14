import { prisma } from "@/lib/db";
import { ENTRY_INTERVAL_MS, PLATFORM_DISCOVERY_INTERVAL_MS, NEWSLETTER_INTERVAL_MS } from "@/lib/scheduler/intervals";

/**
 * Only entries, platform-discovery and newsletters create Run rows (see
 * their prisma.run.create calls) — feed-discovery, mail-scan and prune
 * don't, so this can't just watch "any Run at all" at a fixed cadence.
 * Using the fastest of the three as a heartbeat, with a 50% grace period,
 * means a live worker always looks "ok" (its fastest loop refreshes
 * lastRun well inside the threshold) while a dead one is still caught
 * promptly — rather than a hardcoded interval that assumed every loop ran
 * roughly hourly, which stopped being true once entries/platform-discovery
 * moved to daily/weekly cadences.
 */
const STALE_AFTER_MS = Math.min(ENTRY_INTERVAL_MS, PLATFORM_DISCOVERY_INTERVAL_MS, NEWSLETTER_INTERVAL_MS) * 1.5;

export function ago(date: Date): string {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export interface ServiceHealth {
  lastRun: Awaited<ReturnType<typeof prisma.run.findFirst>>;
  stale: boolean;
}

export async function getServiceHealth(): Promise<ServiceHealth> {
  const lastRun = await prisma.run.findFirst({
    where: { finishedAt: { not: null } },
    orderBy: { startedAt: "desc" },
  });
  const stale = !lastRun || Date.now() - lastRun.startedAt.getTime() > STALE_AFTER_MS;
  return { lastRun, stale };
}
