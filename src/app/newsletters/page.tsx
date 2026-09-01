import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { newsletterAdapterRegistry } from "@/lib/newsletters/registry";
import { Pill } from "@/components/Pill";

// Read live on every request: this reflects an unattended service's current
// state, and a build-time snapshot of it would be permanently stale.
export const dynamic = "force-dynamic";

async function addNewsletterSource(formData: FormData) {
  "use server";

  await prisma.newsletterSource.create({
    data: {
      name: String(formData.get("name") ?? ""),
      url: String(formData.get("url") ?? ""),
      adapterKey: String(formData.get("adapterKey") ?? ""),
    },
  });

  revalidatePath("/newsletters");
}

export default async function NewslettersPage() {
  const sources = await prisma.newsletterSource.findMany({
    orderBy: { createdAt: "desc" },
    include: { attempts: true },
  });
  const adapterKeys = [...newsletterAdapterRegistry.keys()];

  return (
    <main>
      <h1>Newsletters</h1>
      <p className="lede">
        First-party newsletter signups — explicitly opted into at your request. Never bundles in a
        broader &quot;share my data with partners&quot; consent.
      </p>

      <div className="card">
        <h2 style={{ marginTop: 0 }}>Add a newsletter source</h2>
        <form action={addNewsletterSource}>
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
            <select name="adapterKey" required>
              {adapterKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </select>
          </label>
          <button type="submit">Add</button>
        </form>
      </div>

      <h2>Tracked newsletter sources</h2>
      {sources.length === 0 ? (
        <p className="empty-state">No newsletter sources yet.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Adapter</th>
                <th>Attempts</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id}>
                  <td>
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.name}
                    </a>
                  </td>
                  <td>
                    <Pill status={s.status} />
                  </td>
                  <td className="mono">{s.adapterKey}</td>
                  <td className="mono">{s.attempts.length}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
