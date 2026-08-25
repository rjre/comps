import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { adapterRegistry } from "@/lib/automation/registry";

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

export default async function CompetitionsPage() {
  const competitions = await prisma.competition.findMany({
    orderBy: { createdAt: "desc" },
    include: { entries: true },
  });
  const adapterKeys = [...adapterRegistry.keys()];

  return (
    <main>
      <h1>Competitions</h1>

      <h2>Add a competition</h2>
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

      <h2>Tracked competitions</h2>
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
              </td>
              <td>{c.status}</td>
              <td>{c.adapterKey}</td>
              <td>{c.entries.filter((e) => e.status === "SUCCESS").length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
