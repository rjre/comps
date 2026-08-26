import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { newsletterAdapterRegistry } from "@/lib/newsletters/registry";

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
      <p>
        First-party newsletter signups — explicitly opted into at your request. Never bundles in a
        broader &quot;share my data with partners&quot; consent.
      </p>

      <h2>Add a newsletter source</h2>
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

      <h2>Tracked newsletter sources</h2>
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
              <td>{s.status}</td>
              <td>{s.adapterKey}</td>
              <td>{s.attempts.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
