import { prisma } from "@/lib/db";

/** The service is meant to cycle hourly; a longer gap than this means something has stopped. */
const STALE_AFTER_MS = 2 * 60 * 60_000;

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
