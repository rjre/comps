import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { isGmailConfigured } from "@/lib/gmail/client";

async function markReviewed(formData: FormData) {
  "use server";

  const id = String(formData.get("id"));
  await prisma.potentialWin.update({ where: { id }, data: { reviewed: true } });
  revalidatePath("/wins");
}

export default async function WinsPage() {
  const configured = isGmailConfigured();
  const wins = configured
    ? await prisma.potentialWin.findMany({ orderBy: { receivedAt: "desc" } })
    : [];

  return (
    <main>
      <h1>Possible wins</h1>
      <p>
        Emails matching a &ldquo;you&apos;ve won&rdquo;-shaped search, read-only — nothing here is ever
        replied to, marked read, or acted on automatically. Check each one yourself.
      </p>

      {!configured && (
        <p>
          Gmail isn&apos;t connected yet. Run <code>npm run gmail:auth</code> once you have your
          Google OAuth client set up (see README) and add the resulting profile/email details.
        </p>
      )}

      {configured && wins.length === 0 && <p>No matches yet.</p>}

      {wins.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>From</th>
              <th>Subject</th>
              <th>Received</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {wins.map((w) => (
              <tr key={w.id}>
                <td>{w.from}</td>
                <td>
                  {w.subject}
                  <div style={{ fontSize: "0.8rem", color: "#666" }}>{w.snippet}</div>
                </td>
                <td>{w.receivedAt.toLocaleString()}</td>
                <td>{w.reviewed ? "reviewed" : "new"}</td>
                <td>
                  {!w.reviewed && (
                    <form action={markReviewed}>
                      <input type="hidden" name="id" value={w.id} />
                      <button type="submit">Mark reviewed</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
