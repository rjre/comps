import { google } from "googleapis";

// gmail.readonly only — this app can never send, delete, modify, or mark
// mail as read with this scope. That's deliberate: it should be able to
// surface possible wins, not act on the mailbox.
export const GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

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
