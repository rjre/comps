import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { adapterRegistry } from "@/lib/automation/registry";
import { Pill } from "@/components/Pill";

// Read live on every request: this reflects an unattended service's current
// state, and a build-time snapshot of it would be permanently stale.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const STATUSES = ["PENDING", "ENTERED", "SKIPPED", "FAILED", "CLOSED"] as const;

async function addCompetition(formData: FormData) {
  "use server";

  await prisma.competition.create({
    data: {
      name: String(formData.get("name") ?? ""),
      url: String(formData.get("url") ?? ""),
      adapterKey: String(formData.get("adapterKey") ?? ""),
      maxEntries: Number(formData.get("maxEntries") ?? 1),
    },
  });

  revalidatePath("/competitions");
}

export default async function CompetitionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const statusFilter = STATUSES.includes(status as (typeof STATUSES)[number]) ? status : undefined;

  const [total, competitions] = await Promise.all([
    prisma.competition.count({ where: statusFilter ? { status: statusFilter } : undefined }),
    prisma.competition.findMany({
      where: statusFilter ? { status: statusFilter } : undefined,
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
      include: { entries: true },
    }),
  ]);
  const adapterKeys = [...adapterRegistry.keys()];

  return (
    <main>
      <h1>Competitions</h1>
      <p className="lede">Everything the service is tracking, and what it decided to do with each one.</p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add a competition</h2>
        <form action={addCompetition}>
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            URL
            <input name="url" type="url" required />
          </label>
          <label>
            Adapter
            <select name="adapterKey" required defaultValue="generic">
              {adapterKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <label>
            Max entries allowed (per that competition&apos;s own rules)
            <input name="maxEntries" type="number" min={1} defaultValue={1} />
          </label>
          <button type="submit">Add</button>
        </form>
      </div>

      <h2>
        Tracked competitions ({total}
        {statusFilter ? ` — ${statusFilter}` : ""})
      </h2>
      <nav className="tabs">
        <a href="/competitions" data-active={!statusFilter}>
          all
        </a>
        {STATUSES.map((s) => (
          <a key={s} href={`/competitions?status=${s}`} data-active={statusFilter === s}>
            {s.toLowerCase()}
          </a>
        ))}
      </nav>
      {total > PAGE_SIZE && (
        <p>
          Showing the most recent {PAGE_SIZE} of {total}.
        </p>
      )}
      {competitions.length === 0 ? (
        <p className="empty-state">No competitions match this filter.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Adapter</th>
                <th>Entries so far</th>
              </tr>
            </thead>
            <tbody>
              {competitions.map((c) => (
                <tr key={c.id}>
                  <td>
                    <a href={c.url} target="_blank" rel="noreferrer">
                      {c.name}
                    </a>
                    {c.notes && <div className="subtext">{c.notes}</div>}
                  </td>
                  <td>
                    <Pill status={c.status} />
                  </td>
                  <td className="mono">{c.adapterKey}</td>
                  <td className="mono">{c.entries.filter((e) => e.status === "SUCCESS").length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
