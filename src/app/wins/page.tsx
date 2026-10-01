import { prisma } from "@/lib/db";
import { revalidatePath } from "next/cache";
import { isMailConfigured } from "@/lib/gmail/mailbox";
import { readMailStatus } from "@/lib/gmail/mailStatus";
import { ago } from "@/lib/health";
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
  const configured = isMailConfigured();
  const mailStatus = configured ? readMailStatus() : null;
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
          Mail isn&apos;t connected yet. Set <code>GMAIL_ADDRESS</code> and{" "}
          <code>GMAIL_APP_PASSWORD</code> in <code>.env</code>, or run <code>npm run gmail:auth</code>{" "}
          (see README).
        </p>
      )}

      {mailStatus && !mailStatus.ok && (
        <p className="empty-state">
          <strong>Mail triage is failing</strong> (last tried {ago(new Date(mailStatus.at))}
          {mailStatus.lastOkAt ? `, last worked ${ago(new Date(mailStatus.lastOkAt))}` : ""}) — new wins
          aren&apos;t being picked up and win alerts can&apos;t be sent. {mailStatus.error}
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
