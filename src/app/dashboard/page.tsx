import { prisma } from "@/lib/db";

export default async function Dashboard() {
  const [profile, competitionsByStatus, entriesByStatus, bySource, recentEntries] = await Promise.all([
    prisma.profile.findFirst(),
    prisma.competition.groupBy({ by: ["status"], _count: true }),
    prisma.entry.groupBy({ by: ["status"], _count: true }),
    prisma.feedSource.findMany({
      orderBy: { createdAt: "desc" },
      include: { _count: { select: { competitions: true } } },
    }),
    prisma.entry.findMany({
      orderBy: { attemptedAt: "desc" },
      take: 10,
      include: { competition: true },
    }),
  ]);

  const competitionTotal = competitionsByStatus.reduce((sum, s) => sum + s._count, 0);
  const entryTotal = entriesByStatus.reduce((sum, s) => sum + s._count, 0);

  return (
    <main>
      <h1>Dashboard</h1>
      {!profile && (
        <p>
          No profile yet. <a href="/profile">Set one up</a> before entries can run.
        </p>
      )}

      <h2>Competitions ({competitionTotal})</h2>
      {competitionTotal === 0 ? (
        <p>None yet. Add sources at /sources or competitions at /competitions.</p>
      ) : (
        <ul>
          {competitionsByStatus.map((s) => (
            <li key={s.status}>
              {s.status}: {s._count}
            </li>
          ))}
        </ul>
      )}

      <h2>Entry attempts ({entryTotal})</h2>
      {entryTotal === 0 ? (
        <p>None yet.</p>
      ) : (
        <ul>
          {entriesByStatus.map((s) => (
            <li key={s.status}>
              {s.status}: {s._count}
            </li>
          ))}
        </ul>
      )}

      <h2>Yield by source</h2>
      {bySource.length === 0 ? (
        <p>No sources configured — add some at /sources.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Source</th>
              <th>Kind</th>
              <th>Competitions found</th>
              <th>Last fetch</th>
            </tr>
          </thead>
          <tbody>
            {bySource.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.kind === "html" ? `html (${s.scraperKey})` : "rss"}</td>
                <td>{s._count.competitions}</td>
                <td>
                  {s.lastFetchedAt ? s.lastFetchedAt.toLocaleString() : "never"}
                  {s.lastError && <div style={{ color: "#c33", fontSize: "0.8rem" }}>{s.lastError}</div>}
                </td>
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
    </main>
  );
}
