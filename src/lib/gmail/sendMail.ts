import type { GmailClient } from "./client";

/**
 * Sends a plain-text email through the same OAuth-authorized Gmail account
 * the mailbox pass reads from — no separate SMTP/API credential to manage.
 * Needs the `gmail.send` scope (see GMAIL_SCOPES in ./client), which a
 * token issued before that scope existed won't have; `npm run gmail:auth`
 * has to be re-run once to pick it up.
 */
export async function sendMail(
  gmail: GmailClient,
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  try {
    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: buildRawMessage(to, subject, body) },
    });
    return true;
  } catch (err) {
    console.error(`Could not send email to ${to}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

/** RFC 2822 message, base64url-encoded the way the Gmail API's `raw` field requires. */
export function buildRawMessage(to: string, subject: string, body: string): string {
  const lines = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject, "utf-8").toString("base64")}?=`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ];
  return Buffer.from(lines.join("\r\n"), "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
