import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { scraperRegistry } from "@/lib/discovery/scrapers/registry";
import { Pill } from "@/components/Pill";
import { ConfirmButton } from "@/components/ConfirmButton";

// Read live on every request: this reflects an unattended service's current
// state, and a build-time snapshot of it would be permanently stale.
export const dynamic = "force-dynamic";

async function addSource(formData: FormData) {
  "use server";

  const url = String(formData.get("url") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim() || url;
  const scraperKey = String(formData.get("scraperKey") ?? "");
  if (!url) return;

  await prisma.feedSource.create({
    data: scraperKey
      ? { name, url, kind: "html", scraperKey }
      : { name, url, kind: "rss" },
  });
  revalidatePath("/sources");
}

async function toggleSource(formData: FormData) {
  "use server";

  const id = String(formData.get("id"));
  const enabled = String(formData.get("enabled")) === "true";
  await prisma.feedSource.update({ where: { id }, data: { enabled: !enabled } });
  revalidatePath("/sources");
}

async function deleteSource(formData: FormData) {
  "use server";

  const id = String(formData.get("id"));
  await prisma.feedSource.delete({ where: { id } });
  revalidatePath("/sources");
}

export default async function SourcesPage() {
  const sources = await prisma.feedSource.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { competitions: true } } },
  });
  const scraperKeys = [...scraperRegistry.keys()];

  return (
    <main>
      <h1>Sources</h1>
      <p className="lede">
        RSS/Atom feeds, or HTML listing pages for sites with no feed (via a scraper in{" "}
        <code>src/lib/discovery/scrapers</code>), that the discovery worker polls for new
        competitions. Each item&apos;s link is followed to try to resolve the real off-site entry
        form before it&apos;s added to <a href="/competitions">Competitions</a>.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add a source</h2>
        <form action={addSource}>
          <label>
            URL (feed URL, or listing page URL for a scraper)
            <input name="url" type="url" required placeholder="https://example.com/feed" />
          </label>
          <label>
            Name (optional)
            <input name="name" placeholder="e.g. ThePrizeFinder — New Competitions" />
          </label>
          <label>
            Scraper (leave as RSS/Atom unless this site has no feed)
            <select name="scraperKey" defaultValue="">
              <option value="">RSS/Atom feed</option>
              {scraperKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Add</button>
        </form>
      </div>

      <h2>Tracked sources</h2>
      {sources.length === 0 ? (
        <p className="empty-state">No sources yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Found</th>
                <th>Last fetch</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.name}
                    </a>
                    {s.lastError && <div className="subtext" style={{ color: "var(--bad)" }}>{s.lastError}</div>}
                  </td>
                  <td className="mono">{s.kind === "html" ? `html (${s.scraperKey})` : "rss"}</td>
                  <td>
                    <Pill status={s.enabled ? "enabled" : "disabled"} />
                  </td>
                  <td className="mono">{s._count.competitions}</td>
                  <td className="mono">{s.lastFetchedAt ? s.lastFetchedAt.toLocaleString() : "never"}</td>
                  <td>
                    <form action={toggleSource} className="inline-form">
                      <input type="hidden" name="id" value={s.id} />
                      <input type="hidden" name="enabled" value={String(s.enabled)} />
                      <button type="submit" className="button-quiet">
                        {s.enabled ? "Disable" : "Enable"}
                      </button>
                    </form>{" "}
                    <form action={deleteSource} className="inline-form">
                      <input type="hidden" name="id" value={s.id} />
                      <ConfirmButton
                        message={`Delete "${s.name}"? This can't be undone.`}
                        className="button-danger"
                      >
                        Delete
                      </ConfirmButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
