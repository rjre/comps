import "@/lib/loadEnv";
import { prisma } from "@/lib/db";
import { isMailConfigured, mailBackendName, openMailbox, type Mailbox, type MailMessage } from "./mailbox";
import { recordMailPass } from "./mailStatus";
import { describeError } from "@/lib/describeError";
import { categorise, type ExtractedLink } from "./triage";
import { notify, isNotifyConfigured } from "@/lib/notify";
import { resolveEntryUrl } from "@/lib/discovery/resolveEntryUrl";
import { isSafeExternalUrl } from "@/lib/net/ssrf";
import { acquireLock } from "@/lib/scheduler/lock";
import { detectAdapterKey } from "@/lib/automation/registry";

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
  if (!isMailConfigured()) {
    console.log("Mail not configured — skipping mail pass (see README: GMAIL_APP_PASSWORD or npm run gmail:auth).");
    return empty;
  }

  const lock = await acquireLock("mailbox");
  if (!lock) {
    console.log("Another mailbox pass is already running — leaving it to finish.");
    return empty;
  }

  const backend = mailBackendName();
  let mailbox: Mailbox | undefined;
  try {
    mailbox = await openMailbox();
    const query = process.env.MAIL_SCAN_QUERY || DEFAULT_QUERY;
    const ids = await mailbox.listIds(query, MAX_MESSAGES_PER_PASS);

    let wins = 0;
    let leads = 0;
    let archived = 0;

    for (const id of ids) {
      // Re-processing a message would re-notify and re-register its links.
      if (await prisma.processedEmail.findUnique({ where: { gmailMessageId: id } })) continue;

      const message = await mailbox.read(id);
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
        heldReason = await handleWin(message, mailbox);
      } else if (category === "LEADS") {
        leads++;
        linksRegistered = await registerLeads(links, message.subject);
      }

      const shouldArchive = heldReason === null;
      const didArchive = shouldArchive ? await mailbox.archive(id) : false;
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

    console.log(`Mail pass complete (${backend}): ${wins} win(s), ${leads} lead email(s), ${archived} archived.`);
    recordMailPass(backend);
    return { wins, leads, archived };
  } catch (err) {
    recordMailPass(backend, describeError(err));
    throw err;
  } finally {
    await mailbox?.close();
    await lock.release();
  }
}

async function recordWin(message: MailMessage): Promise<void> {
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
async function handleWin(message: MailMessage, mailbox: Mailbox): Promise<string | null> {
  if (!isNotifyConfigured()) {
    return "possible win, and WIN_NOTIFY_EMAIL isn't configured to tell anyone — left in the inbox on purpose";
  }
  const sent = await notify(
    {
      title: "Possible competition win",
      text: `${message.subject}\n\nFrom: ${message.from}\nReceived: ${message.receivedAt.toISOString()}\n\n${message.snippet}`,
    },
    mailbox,
  );
  if (!sent) return "possible win, but the notification email failed to send — left in the inbox until someone is told";

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

    // A link this can't resolve is never stored as-is: `link.url` itself
    // is very often the sender's own tracking-redirect, not a real entry
    // page (confirmed directly: news.giveawaytreasures-mail.co.uk sends a
    // fresh per-recipient tracking link on every send, and disallows all
    // crawling in its own robots.txt, so resolution correctly always
    // declines it). Falling back to that raw link used to still create a
    // Competition row from it — measured directly, 0 of 189 rows created
    // this way, across every host it happened on, ever produced a single
    // successful entry, only repeated HTTP-403s until the row expired.
    const entryUrl = await resolveEntryUrl(link.url).catch(() => null);
    if (!entryUrl || !isSafeExternalUrl(entryUrl)) {
      console.log(`  could not resolve a real entry URL for ${link.url}, skipping`);
      continue;
    }
    if (await prisma.competition.findUnique({ where: { url: entryUrl } })) continue;

    try {
      await prisma.competition.create({
        data: {
          name: `From email: ${subject}`.slice(0, 200),
          url: entryUrl,
          adapterKey: detectAdapterKey(entryUrl),
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
      console.error(describeError(err));
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
