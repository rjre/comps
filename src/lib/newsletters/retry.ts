/**
 * Whether a PENDING newsletter source is worth another attempt this pass.
 *
 * Without this, every PENDING source was retried on every pass forever. By
 * 2026-10-01 four of them (two Mailchimp hosted pages whose POST is reset at
 * the connection level, a dotdigital page that never responds, and a Kit
 * form now behind a reCAPTCHA) had ~300 failed attempts each, costing about
 * 80s of browser time per pass to learn nothing new.
 *
 * Same shape as the competition backoff in ../scheduler/schedule.ts:
 * exponential waits after consecutive failures, then give up and mark the
 * source FAILED. To retry one after fixing its adapter, set it back to
 * PENDING and delete its SubscriptionAttempt rows.
 */
const BACKOFF_HOURS = [0, 1, 4, 12, 24];
export const GIVE_UP_AFTER_CONSECUTIVE_FAILURES = 8;

export type NewsletterDecision =
  | { action: "ATTEMPT" }
  | { action: "WAIT"; until: Date }
  | { action: "GIVE_UP"; reason: string };

export function decideNewsletterAttempt(
  attempts: { status: string; attemptedAt: Date }[],
  now: Date = new Date(),
): NewsletterDecision {
  const newestFirst = [...attempts].sort((a, b) => b.attemptedAt.getTime() - a.attemptedAt.getTime());
  let consecutiveFailures = 0;
  for (const attempt of newestFirst) {
    if (attempt.status !== "FAILED") break;
    consecutiveFailures += 1;
  }
  if (consecutiveFailures === 0) return { action: "ATTEMPT" };
  if (consecutiveFailures >= GIVE_UP_AFTER_CONSECUTIVE_FAILURES) {
    return { action: "GIVE_UP", reason: `${consecutiveFailures} consecutive failed attempts with no success` };
  }
  const hours = BACKOFF_HOURS[Math.min(consecutiveFailures - 1, BACKOFF_HOURS.length - 1)] ?? 24;
  const until = new Date(newestFirst[0]!.attemptedAt.getTime() + hours * 3_600_000);
  return until > now ? { action: "WAIT", until } : { action: "ATTEMPT" };
}
