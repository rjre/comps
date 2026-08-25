import { prisma } from "@/lib/db";

export default async function Dashboard() {
  const [profile, competitionCount, recentEntries] = await Promise.all([
    prisma.profile.findFirst(),
    prisma.competition.count(),
    prisma.entry.findMany({
      orderBy: { attemptedAt: "desc" },
      take: 10,
      include: { competition: true },
    }),
  ]);

  return (
    <main>
      <h1>Dashboard</h1>
      {!profile && (
        <p>
          No profile yet. <a href="/profile">Set one up</a> before entries can run.
        </p>
      )}
      <p>{competitionCount} competition(s) tracked.</p>

      <p>
        <a href="/runs">View run history &amp; logs</a>
      </p>

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
