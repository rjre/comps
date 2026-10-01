import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";
import type { Mailbox, MailMessage } from "./mailbox";

/**
 * Gmail over IMAP (read, archive) and SMTP (send), authenticated with a
 * Google app password. An app password doesn't expire the way the OAuth
 * route's testing-mode refresh token does (see ./mailbox).
 *
 * Gmail specifics this relies on:
 * - X-GM-RAW search, so MAIL_SCAN_QUERY keeps meaning exactly what it means
 *   to the Gmail API ("in:inbox newer_than:30d").
 * - X-GM-MSGID, which is the Gmail API message id in decimal. Converting it
 *   to hex gives the same id the OAuth backend uses.
 * - Archiving means removing the \Inbox label (X-GM-LABELS), the same
 *   operation as the API's removeLabelIds: ["INBOX"]. Never an EXPUNGE:
 *   depending on the account's IMAP settings, that can delete for real.
 */

export function isImapConfigured(): boolean {
  return Boolean(process.env.GMAIL_ADDRESS && process.env.GMAIL_APP_PASSWORD);
}

/** X-GM-MSGID (decimal) → the Gmail API's hex message id. */
export function gmailApiId(xGmMsgId: string): string {
  return BigInt(xGmMsgId).toString(16);
}

export async function openImapMailbox(): Promise<Mailbox> {
  const user = process.env.GMAIL_ADDRESS!;
  // Google shows app passwords as four space-separated groups; either form works for login.
  const pass = process.env.GMAIL_APP_PASSWORD!.replace(/\s+/g, "");

  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");

  // listIds() fills this in. read() and archive() need the IMAP UID behind each API-style id.
  const uidById = new Map<string, number>();

  const smtp = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user, pass },
  });

  const uidFor = (id: string) => {
    const uid = uidById.get(id);
    if (uid === undefined) throw new Error(`message ${id} wasn't in this pass's listing`);
    return uid;
  };

  return {
    kind: "imap",
    async listIds(query, max) {
      const uids = (await client.search({ gmraw: query }, { uid: true })) || [];
      // UIDs only ever increase, so the highest are the newest. That's the same order the API lists in.
      const newest = [...uids].sort((a, b) => b - a).slice(0, max);
      const ids: string[] = [];
      if (newest.length === 0) return ids;
      // emailId (X-GM-MSGID) comes back on every fetch from Gmail without being asked for.
      for await (const msg of client.fetch(newest, { uid: true }, { uid: true })) {
        if (!msg.emailId) continue;
        const id = gmailApiId(msg.emailId);
        uidById.set(id, msg.uid);
        ids.push(id);
      }
      return ids.sort((a, b) => uidById.get(b)! - uidById.get(a)!);
    },

    async read(id): Promise<MailMessage | null> {
      try {
        const msg = await client.fetchOne(String(uidFor(id)), { source: true }, { uid: true });
        if (!msg || !msg.source) throw new Error("no message source returned");
        const parsed = await simpleParser(msg.source);
        const text = parsed.text ?? "";
        const html = typeof parsed.html === "string" ? parsed.html : "";
        return {
          id,
          from: parsed.from?.text || "(unknown sender)",
          subject: parsed.subject || "(no subject)",
          snippet: (text || html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim().slice(0, 200),
          // Both parts, same as the API backend: link extraction wants the HTML's hrefs.
          body: [text, html].filter(Boolean).join("\n"),
          receivedAt: parsed.date ?? new Date(),
        };
      } catch (err) {
        console.error(`Could not read message ${id}:`, err instanceof Error ? err.message : err);
        return null;
      }
    },

    async archive(id) {
      try {
        const ok = await client.messageFlagsRemove(String(uidFor(id)), ["\\Inbox"], { uid: true, useLabels: true });
        if (!ok) throw new Error("server rejected the label change");
        return true;
      } catch (err) {
        console.error(`Could not archive message ${id}:`, err instanceof Error ? err.message : err);
        return false;
      }
    },

    async send(to, subject, body) {
      try {
        await smtp.sendMail({ from: user, to, subject, text: body });
        return true;
      } catch (err) {
        console.error(`Could not send email to ${to}:`, err instanceof Error ? err.message : err);
        return false;
      }
    },

    async close() {
      lock.release();
      smtp.close();
      await client.logout().catch(() => {});
    },
  };
}
