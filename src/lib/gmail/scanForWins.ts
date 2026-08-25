import { prisma } from "@/lib/db";
import { getGmailClient, isGmailConfigured } from "./client";

const DEFAULT_QUERY =
  '(subject:("you\'ve won" OR "you have won" OR congratulations OR winner OR "you won") OR "claim your prize") newer_than:30d';

/**
 * Read-only: lists and reads message metadata/snippets matching a
 * win-shaped search, and records anything new as a PotentialWin for a
 * human to check in the dashboard. Never marks read, labels, replies to,
 * or deletes anything — the gmail.readonly scope can't do any of that
 * even if this code tried to.
 */
export async function scanForWins(): Promise<{ found: number }> {
  if (!isGmailConfigured()) {
    console.log("Gmail not configured — skipping mail scan (see README: npm run gmail:auth).");
    return { found: 0 };
  }

  const gmail = getGmailClient();
  const query = process.env.MAIL_SCAN_QUERY || DEFAULT_QUERY;

  const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: 50 });
  const messages = list.data.messages ?? [];

  let found = 0;
  for (const { id } of messages) {
    if (!id) continue;

    const exists = await prisma.potentialWin.findUnique({ where: { gmailMessageId: id } });
    if (exists) continue;

    const msg = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });

    const headers = msg.data.payload?.headers ?? [];
    const from = headers.find((h) => h.name === "From")?.value ?? "(unknown sender)";
    const subject = headers.find((h) => h.name === "Subject")?.value ?? "(no subject)";
    const dateHeader = headers.find((h) => h.name === "Date")?.value;

    await prisma.potentialWin.create({
      data: {
        gmailMessageId: id,
        from,
        subject,
        snippet: msg.data.snippet ?? "",
        receivedAt: dateHeader ? new Date(dateHeader) : new Date(),
      },
    });
    found++;
  }

  console.log(`Mail scan complete: ${found} new potential win(s).`);
  return { found };
}

if (require.main === module) {
  scanForWins()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
