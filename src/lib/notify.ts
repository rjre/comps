/**
 * Getting a message to the human, from a headless box.
 *
 * This exists because of one specific rule in the mail triage: a win
 * notification is only archived once someone has actually been told about
 * it. Archiving an unnotified win would take the one email that matters
 * out of the inbox and put it somewhere nobody is looking — so this
 * function's return value is load-bearing, not fire-and-forget.
 *
 * `WIN_NOTIFY_EMAIL` sends through the same Gmail account the mailbox pass
 * already reads (needs the `gmail.send` scope; see GMAIL_SCOPES), so it
 * requires the `gmail` client the caller already has rather than a
 * separate credential.
 *
 * With nothing configured, notification always fails — deliberately, so
 * the caller keeps the mail in the inbox rather than silently filing it.
 */

import type { GmailClient } from "./gmail/client";
import { sendMail } from "./gmail/sendMail";

export interface Notification {
  title: string;
  text: string;
}

export function isNotifyConfigured(): boolean {
  return Boolean(process.env.WIN_NOTIFY_EMAIL);
}

export async function notify({ title, text }: Notification, gmail?: GmailClient): Promise<boolean> {
  const to = process.env.WIN_NOTIFY_EMAIL;
  if (!to || !gmail) return false;
  return sendMail(gmail, to, title, text);
}
