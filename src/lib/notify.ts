/**
 * Getting a message to the human, from a headless box.
 *
 * This exists because of one specific rule in the mail triage: a win
 * notification is only archived once someone has actually been told about
 * it. Archiving an unnotified win would take the one email that matters
 * out of the inbox and put it somewhere nobody is looking — so this
 * function's return value is load-bearing, not fire-and-forget.
 *
 * Configured with a single env var, `NOTIFY_WEBHOOK`:
 *
 * - An ntfy.sh topic URL (https://ntfy.sh/your-topic) gets a plain-text
 *   body with ntfy's Title/Priority/Tags headers, which is what its apps
 *   render nicely. This is the least-setup option: pick a topic name,
 *   install the app, done.
 * - Anything else gets a JSON POST with both a ready-made `text` field and
 *   the structured fields, which suits Slack/Discord-style webhooks and
 *   home automation alike.
 *
 * With nothing configured, notification always fails — deliberately, so
 * the caller keeps the mail in the inbox rather than silently filing it.
 */

export interface Notification {
  title: string;
  text: string;
}

export function isNotifyConfigured(): boolean {
  return Boolean(process.env.NOTIFY_WEBHOOK);
}

export async function notify({ title, text }: Notification): Promise<boolean> {
  const webhook = process.env.NOTIFY_WEBHOOK;
  if (!webhook) return false;

  const isNtfy = /(^|\.)ntfy\.sh$/i.test(safeHostname(webhook));
  const request: RequestInit = isNtfy
    ? {
        method: "POST",
        headers: { Title: title, Priority: "high", Tags: "tada" },
        body: text,
      }
    : {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, text, content: `${title}\n\n${text}` }),
      };

  try {
    const response = await fetch(webhook, { ...request, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      console.error(`Notification webhook returned ${response.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Notification webhook failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
