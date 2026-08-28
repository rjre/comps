import { prisma } from "@/lib/db";
import { archiveMessage, getGmailClient, isGmailConfigured, type GmailClient } from "./client";
import { categorise, type ExtractedLink } from "./triage";
import { notify, isNotifyConfigured } from "@/lib/notify";
import { resolveEntryUrl } from "@/lib/discovery/resolveEntryUrl";
import { isSafeExternalUrl } from "@/lib/net/ssrf";
import { acquireLock } from "@/lib/scheduler/lock";

/**
 * Reads the inbox, decides what each message is, acts on it, and archives
 * it once it's genuinely handled.
 *
 * "Handled" means something different per category, and the difference is
 * the whole design:
 *
 * - `WIN` — recorded, and a notification sent. Archived ONLY if that
 *   notification succeeded. An unnotified win stays in the inbox, because
 *   archiving it would move the one email that matters out of sight.
 * - `LEADS` — its competition links are resolved and registered for entry.
 *   Archived once they are. Note this means "queued for entry", not
 *   "entered": entry is the runner's job, with its own pacing and retry,
 *   and the email has nothing left to contribute once the links are
 *   tracked.
 * - `NOTHING` — assessed as neither. Archived immediately; that assessment
 *   is the handling.
 *
 * Every message it looks at gets a ProcessedEmail row, including ones it
 * couldn't archive and why, so "still in my inbox" always has an answer.
 */

const DEFAULT_QUERY = "in:inbox newer_than:30d";
const MAX_MESSAGES_PER_PASS = Number(process.env.MAIL_SCAN_MAX ?? 50);

export async function processMailbox(): Promise<{ wins: number; leads: number; archived: number }> {
  const empty = { wins: 0, leads: 0, archived: 0 };
  if (!isGmailConfigured()) {
    console.log("Gmail not configured — skipping mail pass (see README: npm run gmail:auth).");
    return empty;
  }

  const lock = await acquireLock("mailbox");
  if (!lock) {
    console.log("Another mailbox pass is already running — leaving it to finish.");
    return empty;
  }

  try {
    const gmail = getGmailClient();
    const query = process.env.MAIL_SCAN_QUERY || DEFAULT_QUERY;
    const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: MAX_MESSAGES_PER_PASS });
    const messages = list.data.messages ?? [];

    let wins = 0;
    let leads = 0;
    let archived = 0;

    for (const { id } of messages) {
      if (!id) continue;
      // Re-processing a message would re-notify and re-register its links.
      if (await prisma.processedEmail.findUnique({ where: { gmailMessageId: id } })) continue;

      const message = await readMessage(gmail, id);
      if (!message) continue;

      const { category, links } = categorise({
        from: message.from,
        subject: message.subject,
        body: message.body,
      });

      let heldReason: string | null = null;
      let linksRegistered = 0;

      if (category === "WIN") {
        wins++;
        await recordWin(message);
        heldReason = await handleWin(message);
      } else if (category === "LEADS") {
        leads++;
        linksRegistered = await registerLeads(links, message.subject);
      }

      const shouldArchive = heldReason === null;
      const didArchive = shouldArchive ? await archiveMessage(gmail, id) : false;
      if (didArchive) archived++;

      await prisma.processedEmail.create({
        data: {
          gmailMessageId: id,
          from: message.from,
          subject: message.subject,
          receivedAt: message.receivedAt,
          category,
          linksFound: links.length,
          linksRegistered,
          archivedAt: didArchive ? new Date() : null,
          heldReason: heldReason ?? (shouldArchive && !didArchive ? "archive call failed" : null),
        },
      });

      console.log(
        `${category}: "${message.subject}" — ${
          didArchive ? "archived" : `left in inbox (${heldReason ?? "archive failed"})`
        }${category === "LEADS" ? `, ${linksRegistered}/${links.length} link(s) registered` : ""}`,
      );
    }

    console.log(`Mail pass complete: ${wins} win(s), ${leads} lead email(s), ${archived} archived.`);
    return { wins, leads, archived };
  } finally {
    await lock.release();
  }
}

interface ParsedMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  body: string;
  receivedAt: Date;
}

async function readMessage(gmail: GmailClient, id: string): Promise<ParsedMessage | null> {
  try {
    const msg = await gmail.users.messages.get({ userId: "me", id, format: "full" });
    const headers = msg.data.payload?.headers ?? [];
    const header = (name: string) =>
      headers.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
    const dateHeader = header("Date");
    return {
      id,
      from: header("From") || "(unknown sender)",
      subject: header("Subject") || "(no subject)",
      snippet: msg.data.snippet ?? "",
      // Body first, snippet as the fallback — link extraction needs the
      // real body, and the snippet is only ~200 characters of it.
      body: extractBody(msg.data.payload) || msg.data.snippet || "",
      receivedAt: dateHeader && !Number.isNaN(Date.parse(dateHeader)) ? new Date(dateHeader) : new Date(),
    };
  } catch (err) {
    console.error(`Could not read message ${id}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

/** Walks the MIME tree for text/plain and text/html parts, concatenated. */
function extractBody(payload: unknown, depth = 0): string {
  if (!payload || depth > 10) return "";
  const part = payload as {
    mimeType?: string | null;
    body?: { data?: string | null } | null;
    parts?: unknown[] | null;
  };
  const pieces: string[] = [];
  if (part.body?.data && /^text\//i.test(part.mimeType ?? "")) {
    pieces.push(Buffer.from(part.body.data, "base64url").toString("utf-8"));
  }
  for (const child of part.parts ?? []) pieces.push(extractBody(child, depth + 1));
  return pieces.join("\n");
}

async function recordWin(message: ParsedMessage): Promise<void> {
  await prisma.potentialWin.upsert({
    where: { gmailMessageId: message.id },
    update: {},
    create: {
      gmailMessageId: message.id,
      from: message.from,
      subject: message.subject,
      snippet: message.snippet,
      receivedAt: message.receivedAt,
    },
  });
}

/** Returns null when the win was notified (so it can be archived), or the reason it's being held. */
async function handleWin(message: ParsedMessage): Promise<string | null> {
  if (!isNotifyConfigured()) {
    return "possible win, and no NOTIFY_WEBHOOK is configured to tell anyone — left in the inbox on purpose";
  }
  const sent = await notify({
    title: "Possible competition win",
    text: `${message.subject}\n\nFrom: ${message.from}\nReceived: ${message.receivedAt.toISOString()}\n\n${message.snippet}`,
  });
  if (!sent) return "possible win, but the notification webhook failed — left in the inbox until someone is told";

  await prisma.potentialWin.update({
    where: { gmailMessageId: message.id },
    data: { notifiedAt: new Date() },
  });
  return null;
}

/**
 * Puts an email's competition links through exactly the same pipeline a
 * feed item goes through — entry-URL resolution, the SSRF check, the
 * unique-url constraint — rather than trusting an email's markup.
 */
async function registerLeads(links: ExtractedLink[], subject: string): Promise<number> {
  let registered = 0;
  for (const link of links) {
    if (!isSafeExternalUrl(link.url)) {
      console.log(`  ${link.url} is not a safe external URL, skipping`);
      continue;
    }
    if (await prisma.competition.findUnique({ where: { url: link.url } })) continue;

    const entryUrl = (await resolveEntryUrl(link.url).catch(() => null)) ?? link.url;
    if (!isSafeExternalUrl(entryUrl)) continue;
    if (await prisma.competition.findUnique({ where: { url: entryUrl } })) continue;

    try {
      await prisma.competition.create({
        data: {
          name: `From email: ${subject}`.slice(0, 200),
          url: entryUrl,
          adapterKey: "generic",
          sourceListingUrl: link.url,
          notes: `Found in an email (${link.reason}). Entry URL resolved from ${link.url}.`,
        },
      });
      registered++;
    } catch {
      // Unique-url race with another pass; nothing to do.
    }
  }
  return registered;
}

if (require.main === module) {
  processMailbox()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
