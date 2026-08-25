import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";

async function addSource(formData: FormData) {
  "use server";

  const url = String(formData.get("url") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim() || url;
  if (!url) return;

  await prisma.feedSource.create({ data: { name, url } });
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

  return (
    <main>
      <h1>Feed sources</h1>
      <p>
        RSS/Atom feeds the discovery worker polls for new competitions. Each item&apos;s link is
        followed to try to resolve the real off-site entry form before it&apos;s added to{" "}
        <a href="/competitions">Competitions</a>.
      </p>

      <h2>Add a feed</h2>
      <form action={addSource}>
        <label>
          Feed URL
          <input name="url" type="url" required placeholder="https://example.com/feed" />
        </label>
        <label>
          Name (optional)
          <input name="name" placeholder="e.g. ThePrizeFinder — New Competitions" />
        </label>
        <button type="submit">Add</button>
      </form>

      <h2>Tracked feeds</h2>
      {sources.length === 0 ? (
        <p>No feeds yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Name</th>
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
                  {s.lastError && (
                    <div style={{ color: "#c33", fontSize: "0.8rem" }}>{s.lastError}</div>
                  )}
                </td>
                <td>{s.enabled ? "enabled" : "disabled"}</td>
                <td>{s._count.competitions}</td>
                <td>{s.lastFetchedAt ? s.lastFetchedAt.toLocaleString() : "never"}</td>
                <td>
                  <form action={toggleSource} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="enabled" value={String(s.enabled)} />
                    <button type="submit">{s.enabled ? "Disable" : "Enable"}</button>
                  </form>{" "}
                  <form action={deleteSource} style={{ display: "inline" }}>
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit">Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
