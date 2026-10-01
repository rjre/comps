import { archiveMessage, getGmailClient, isGmailConfigured, type GmailClient } from "./client";
import { sendMail } from "./sendMail";
import { isImapConfigured, openImapMailbox } from "./imapMailbox";

/**
 * The four things the mail pass does to a mailbox, behind one interface so
 * it doesn't care how it's connected.
 *
 * Two ways in, same Gmail account:
 *
 * - IMAP/SMTP with a Google app password (`GMAIL_ADDRESS` +
 *   `GMAIL_APP_PASSWORD`). Preferred when configured: an app password
 *   doesn't expire. The OAuth route's refresh token does, every 7 days,
 *   because the OAuth app is stuck in Google's "Testing" mode (publishing
 *   it wants an app domain this project doesn't have). That expiry is what
 *   silently stopped mail triage on 2026-09-29.
 * - The Gmail API over OAuth (`GOOGLE_CLIENT_ID` / `_SECRET` /
 *   `_REFRESH_TOKEN`, from `npm run gmail:auth`). Kept as the fallback.
 *
 * Message ids are the Gmail API's own in both cases. The IMAP side
 * converts X-GM-MSGID to the same hex string, so ProcessedEmail rows from
 * one backend still dedupe against the other.
 */
export interface MailMessage {
  id: string;
  from: string;
  subject: string;
  snippet: string;
  body: string;
  receivedAt: Date;
}

export interface Mailbox {
  kind: "imap" | "oauth";
  /** Inbox message ids matching a Gmail search query, newest first, at most `max`. */
  listIds(query: string, max: number): Promise<string[]>;
  read(id: string): Promise<MailMessage | null>;
  /** Removes the message from the inbox; never deletes, trashes or marks read. False on failure. */
  archive(id: string): Promise<boolean>;
  /** A new plain-text outbound message, never a reply. False on failure. */
  send(to: string, subject: string, body: string): Promise<boolean>;
  close(): Promise<void>;
}

export function isMailConfigured(): boolean {
  return isImapConfigured() || isGmailConfigured();
}

export function mailBackendName(): string {
  if (isImapConfigured()) return "IMAP (app password)";
  if (isGmailConfigured()) return "Gmail API (OAuth)";
  return "none";
}

export async function openMailbox(): Promise<Mailbox> {
  if (isImapConfigured()) return openImapMailbox();
  if (isGmailConfigured()) return oauthMailbox(getGmailClient());
  throw new Error(
    "Mail is not configured — set GMAIL_ADDRESS + GMAIL_APP_PASSWORD, or run `npm run gmail:auth` (see README).",
  );
}

function oauthMailbox(gmail: GmailClient): Mailbox {
  return {
    kind: "oauth",
    async listIds(query, max) {
      const list = await gmail.users.messages.list({ userId: "me", q: query, maxResults: max });
      return (list.data.messages ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    },
    async read(id) {
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
    },
    archive: (id) => archiveMessage(gmail, id),
    send: (to, subject, body) => sendMail(gmail, to, subject, body),
    async close() {},
  };
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
