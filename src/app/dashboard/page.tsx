import { prisma } from "@/lib/db";
import { decideSchedule } from "@/lib/scheduler/schedule";
import type { EntryStatus } from "@/lib/status";

// Always read live — this is the health page for an unattended service, so
// a cached snapshot of "when did it last run" would be worse than useless.
export const dynamic = "force-dynamic";

/** The service is meant to cycle hourly; a longer gap than this means something has stopped. */
const STALE_AFTER_MS = 2 * 60 * 60_000;

function ago(date: Date): string {
  const minutes = Math.round((Date.now() - date.getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export default async function Dashboard() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const [profile, byStatus, pending, lastRun, todaysEntries, recentEntries] = await Promise.all([
    prisma.profile.findFirst(),
    prisma.competition.groupBy({ by: ["status"], _count: true }),
    prisma.competition.findMany({
      where: { status: "PENDING" },
      include: { entries: { include: { run: true } } },
    }),
    prisma.run.findFirst({ where: { finishedAt: { not: null } }, orderBy: { startedAt: "desc" } }),
    prisma.entry.groupBy({ by: ["status"], _count: true, where: { attemptedAt: { gte: dayAgo } } }),
    prisma.entry.findMany({ orderBy: { attemptedAt: "desc" }, take: 15, include: { competition: true } }),
  ]);

  // The same decision the runner makes, so this page shows what will
  // actually happen next rather than a separate guess at it.
  const decisions = pending.map((competition) => ({
    competition,
    decision: decideSchedule(
      competition,
      competition.entries.map((e) => ({
        status: e.status as EntryStatus,
        attemptedAt: e.attemptedAt,
        dryRun: e.run?.dryRun ?? false,
      })),
      now,
    ),
  }));
  const dueNow = decisions.filter((d) => d.decision.action === "ENTER");
  const upNext = decisions
    .filter((d) => d.decision.action === "WAIT" && d.decision.readyAt)
    .sort((a, b) => a.decision.readyAt!.getTime() - b.decision.readyAt!.getTime())
    .slice(0, 8);

  const total = byStatus.reduce((sum, row) => sum + row._count, 0);
  const stale = !lastRun || now.getTime() - lastRun.startedAt.getTime() > STALE_AFTER_MS;

  return (
    <main>
      <h1>Dashboard</h1>

      {!profile && (
        <p>
          No profile yet. <a href="/profile">Set one up</a> before entries can run.
        </p>
      )}

      <h2>Service health</h2>
      {lastRun ? (
        <p>
          Last pass {ago(lastRun.startedAt)} ({lastRun.status.toLowerCase()}).{" "}
          {stale && <strong>That&apos;s longer than the hourly cycle should allow — check the timer.</strong>}
        </p>
      ) : (
        <p>
          <strong>No pass has ever completed.</strong>
        </p>
      )}
      <p>
        {total} competition(s) tracked —{" "}
        {byStatus
          .slice()
          .sort((a, b) => b._count - a._count)
          .map((row) => `${row._count} ${row.status.toLowerCase()}`)
          .join(", ")}
        .
      </p>
      <p>
        {dueNow.length} due to be entered on the next pass; {decisions.length - dueNow.length} waiting their turn.
      </p>

      <h2>Last 24 hours</h2>
      {todaysEntries.length === 0 ? (
        <p>No entry attempts in the last 24 hours.</p>
      ) : (
        <p>
          {todaysEntries
            .slice()
            .sort((a, b) => b._count - a._count)
            .map((row) => `${row._count} ${row.status.toLowerCase().replace(/_/g, " ")}`)
            .join(", ")}
          .
        </p>
      )}

      <h2>Coming up</h2>
      {upNext.length === 0 ? (
        <p>Nothing waiting on a timer.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Competition</th>
              <th>Due</th>
              <th>Why it&apos;s waiting</th>
            </tr>
          </thead>
          <tbody>
            {upNext.map(({ competition, decision }) => (
              <tr key={competition.id}>
                <td>{competition.name}</td>
                <td>{decision.readyAt!.toLocaleString()}</td>
                <td>{decision.reason.split(" — due again")[0]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Recent entry attempts</h2>
      {recentEntries.length === 0 ? (
        <p>None yet. Add competitions and run the entry job.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Competition</th>
              <th>Status</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {recentEntries.map((e) => (
              <tr key={e.id}>
                <td>{e.competition.name}</td>
                <td>{e.status}</td>
                <td>{e.attemptedAt.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p>
        <a href="/runs">View run history &amp; logs</a>
      </p>
    </main>
  );
}
