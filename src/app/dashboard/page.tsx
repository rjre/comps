import { prisma } from "@/lib/db";
import { decideSchedule } from "@/lib/scheduler/schedule";
import type { EntryStatus } from "@/lib/status";
import { getServiceHealth, ago } from "@/lib/health";
import { Pill } from "@/components/Pill";

// Always read live — this is the health page for an unattended service, so
// a cached snapshot of "when did it last run" would be worse than useless.
export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const now = new Date();
  const dayAgo = new Date(now.getTime() - 86_400_000);

  const [profile, byStatus, pending, health, todaysEntries, recentEntries] = await Promise.all([
    prisma.profile.findFirst(),
    prisma.competition.groupBy({ by: ["status"], _count: true }),
    prisma.competition.findMany({
      where: { status: "PENDING" },
      include: { entries: { include: { run: true } } },
    }),
    getServiceHealth(),
    prisma.entry.groupBy({ by: ["status"], _count: true, where: { attemptedAt: { gte: dayAgo } } }),
    prisma.entry.findMany({ orderBy: { attemptedAt: "desc" }, take: 15, include: { competition: true } }),
  ]);
  const { lastRun, stale } = health;

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
  const countOf = (rows: { status: string; _count: number }[], status: string) =>
    rows.find((r) => r.status === status)?._count ?? 0;
  const enteredToday = countOf(todaysEntries, "SUCCESS");
  const failedToday = countOf(todaysEntries, "FAILED");

  return (
    <main>
      <h1>Dashboard</h1>
      <p className="lede">At-a-glance status for the unattended entry service.</p>

      {!profile && (
        <p className="empty-state">
          No profile yet. <a href="/profile">Set one up</a> before entries can run.
        </p>
      )}

      <div className="stat-grid">
        <div className={`stat-card${stale ? " alert" : ""}`}>
          <h3>Service health</h3>
          <div className="stat-value">
            <span className={`pill pill-${stale || !lastRun ? "bad" : "good"}`}>
              {stale || !lastRun ? "stalled" : "healthy"}
            </span>
          </div>
          <div className="stat-detail">
            {lastRun
              ? `Last pass ${ago(lastRun.startedAt)} (${lastRun.status.toLowerCase()})`
              : "No pass has ever completed"}
            {stale && lastRun && " — that's longer than the hourly cycle should allow, check the timer."}
          </div>
        </div>

        <div className="stat-card">
          <h3>Tracked competitions</h3>
          <div className="stat-value">{total}</div>
          <div className="stat-detail">
            {byStatus
              .slice()
              .sort((a, b) => b._count - a._count)
              .map((row) => `${row._count} ${row.status.toLowerCase()}`)
              .join(" · ") || "none yet"}
          </div>
        </div>

        <div className="stat-card">
          <h3>Up next</h3>
          <div className="stat-value">{dueNow.length}</div>
          <div className="stat-detail">
            due on the next pass · {decisions.length - dueNow.length} waiting their turn
          </div>
        </div>

        <div className="stat-card">
          <h3>Last 24 hours</h3>
          <div className="stat-value">
            {enteredToday} <span style={{ fontSize: "0.85rem", color: "var(--muted-solid)" }}>entered</span>
          </div>
          <div className="stat-detail">
            {todaysEntries.filter((r) => r.status !== "SUCCESS").length === 0
              ? failedToday === 0 && enteredToday === 0
                ? "no attempts"
                : "nothing else to report"
              : todaysEntries
                  .filter((r) => r.status !== "SUCCESS")
                  .slice()
                  .sort((a, b) => b._count - a._count)
                  .map((row) => `${row._count} ${row.status.toLowerCase().replace(/_/g, " ")}`)
                  .join(" · ")}
          </div>
        </div>
      </div>

      <hr className="tear" />

      <h2>Coming up</h2>
      {upNext.length === 0 ? (
        <p className="empty-state">Nothing waiting on a timer.</p>
      ) : (
        <div className="table-wrap">
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
                  <td className="mono">{decision.readyAt!.toLocaleString()}</td>
                  <td>{decision.reason.split(" — due again")[0]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>Recent entry attempts</h2>
      {recentEntries.length === 0 ? (
        <p className="empty-state">None yet. Add competitions and run the entry job.</p>
      ) : (
        <div className="table-wrap">
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
                  <td>
                    <Pill status={e.status} />
                  </td>
                  <td className="mono">{e.attemptedAt.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ marginTop: "1.5rem" }}>
        <a href="/runs">View run history &amp; logs →</a>
      </p>
    </main>
  );
}
