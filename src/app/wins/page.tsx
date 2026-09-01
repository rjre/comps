import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { isGmailConfigured } from "@/lib/gmail/client";
import { Pill } from "@/components/Pill";

// Read live on every request: this reflects an unattended service's current
// state, and a build-time snapshot of it would be permanently stale.
export const dynamic = "force-dynamic";

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
      <p className="lede">
        Emails matching a &ldquo;you&apos;ve won&rdquo;-shaped search, read-only — nothing here is ever
        replied to, marked read, or acted on automatically. Check each one yourself.
      </p>

      {!configured && (
        <p className="empty-state">
          Gmail isn&apos;t connected yet. Run <code>npm run gmail:auth</code> once you have your
          Google OAuth client set up (see README) and add the resulting profile/email details.
        </p>
      )}

      {configured && wins.length === 0 && <p className="empty-state">No matches yet.</p>}

      {wins.length > 0 && (
        <div className="table-wrap">
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
                    <div className="subtext">{w.snippet}</div>
                  </td>
                  <td className="mono">{w.receivedAt.toLocaleString()}</td>
                  <td>
                    <Pill status={w.reviewed ? "reviewed" : "new"} />
                  </td>
                  <td>
                    {!w.reviewed && (
                      <form action={markReviewed} className="inline-form">
                        <input type="hidden" name="id" value={w.id} />
                        <button type="submit" className="button-quiet">
                          Mark reviewed
                        </button>
                      </form>
                    )}
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
