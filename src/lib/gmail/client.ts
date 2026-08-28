import { google } from "googleapis";

/**
 * `gmail.modify`, not `gmail.readonly`.
 *
 * Readonly was the right scope while the mail scan only surfaced possible
 * wins for a human to look at. Archiving a handled message needs to remove
 * its INBOX label, which readonly structurally cannot do — so this is the
 * narrowest scope that supports the job.
 *
 * What `modify` grants that readonly didn't: changing labels (which is how
 * archiving works), and marking read. What it still does NOT grant:
 * sending mail, and permanently deleting it (`gmail.send` and
 * `mail.google.com` respectively). This code additionally never trashes
 * anything, never marks anything read, and never replies — the only
 * mailbox mutation anywhere in it is removing the INBOX label.
 *
 * Changing this constant invalidates any existing refresh token: the token
 * carries the scopes it was granted with, so `npm run gmail:auth` has to be
 * run again after a change here.
 */
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

export function isGmailConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GOOGLE_REFRESH_TOKEN);
}

export function getGmailClient() {
  if (!isGmailConfigured()) {
    throw new Error("Gmail is not configured — run `npm run gmail:auth` first (see README).");
  }

  const auth = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });

  return google.gmail({ version: "v1", auth });
}

export type GmailClient = ReturnType<typeof getGmailClient>;

/**
 * Archive: remove the INBOX label, leaving the message searchable and
 * intact in All Mail. Nothing here deletes, trashes or marks read.
 *
 * Returns false rather than throwing so one un-archivable message (an
 * insufficient-scope token, a message deleted between listing and now)
 * doesn't abort the rest of the pass.
 */
export async function archiveMessage(gmail: GmailClient, messageId: string): Promise<boolean> {
  try {
    await gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { removeLabelIds: ["INBOX"] },
    });
    return true;
  } catch (err) {
    console.error(`Could not archive message ${messageId}:`, err instanceof Error ? err.message : err);
    return false;
  }
}
