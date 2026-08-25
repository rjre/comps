import { prisma } from "@/lib/db";

const levelColor: Record<string, string> = {
  INFO: "inherit",
  WARN: "#b45309",
  ERROR: "#b91c1c",
};

export default async function RunsPage() {
  const runs = await prisma.run.findMany({
    orderBy: { startedAt: "desc" },
    take: 20,
    include: {
      logLines: { orderBy: { createdAt: "asc" } },
      entries: { include: { competition: true } },
    },
  });

  return (
    <main>
      <h1>Runs</h1>
      <p>
        Each row is one invocation of <code>npm run run:entries</code>. Expand a run to see its
        full log — this is the place to look when an adapter needs fixing.
      </p>

      {runs.length === 0 ? (
        <p>No runs yet. Run `npm run run:entries` (optionally with `DRY_RUN=1`) to see one here.</p>
      ) : (
        runs.map((run) => (
          <details key={run.id} style={{ marginBottom: "1rem" }} open={run === runs[0]}>
            <summary>
              <strong>{run.startedAt.toLocaleString()}</strong> — {run.status}
              {run.dryRun ? " (dry run)" : ""} — {run.candidateCount ?? 0} candidate(s),{" "}
              {run.entries.length} entry attempt(s)
              {run.errorMessage ? ` — ${run.errorMessage}` : ""}
            </summary>
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Level</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {run.logLines.map((line) => (
                  <tr key={line.id}>
                    <td>{line.createdAt.toLocaleTimeString()}</td>
                    <td style={{ color: levelColor[line.level] }}>{line.level}</td>
                    <td>{line.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ))
      )}
    </main>
  );
}
