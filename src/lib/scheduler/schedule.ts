import type { EntryStatus } from "@/lib/status";

/**
 * When to next attempt a given competition.
 *
 * The runner used to have no answer to this: every PENDING competition was
 * attempted on every pass. That was fine while every tracked competition
 * was one-shot (a success flipped it to ENTERED and it dropped out), but
 * the DMRI reader-comps sites are DAILY draws that stay PENDING for weeks.
 * With a 6-hourly timer, each of those was opened, logged into and
 * submitted 4x a day to be told "already entered today's draw" 3 of those
 * times — roughly a minute of real browser work per wasted attempt, and
 * the wasted attempts crowded out everything else in the run.
 *
 * The same gap applied to failures: a competition whose site had started
 * refusing us was retried at full rate forever, so one broken adapter
 * could eat most of a run indefinitely and bury the working entries in
 * failure noise.
 *
 * These are pure functions over the competition's own entry history, so
 * there's no scheduling state to keep in sync with reality (and nothing
 * to repair if a run dies half-way).
 */

/** How long to wait after N consecutive failures, capped so nothing is abandoned silently. */
const BACKOFF_HOURS = [1, 2, 4, 8, 16, 24];

/**
 * After this many consecutive failures with no success in between, stop
 * retrying and mark the competition FAILED. Deliberately generous: sites
 * do have bad days, and the muddy-stilettos row alone accumulated 39
 * failures interleaved with 21 real successes, which this must not
 * mistake for a dead competition (only *consecutive* failures count).
 */
export const GIVE_UP_AFTER_CONSECUTIVE_FAILURES = 12;

/**
 * How long to wait after an adapter declines to enter (SKIPPED_RULES) —
 * an unknown quiz answer, a rule the profile doesn't satisfy. These are
 * standing conditions rather than transient faults, so re-checking daily
 * is plenty; without this the runner would re-open and re-log-into the
 * site on every pass to reach the same conclusion.
 */
export const DECLINED_RECHECK_HOURS = 24;

/**
 * Fallback cadence for a competition that allows more than one entry but
 * doesn't say how often. Every repeatable draw this project has met is a
 * daily one, and a day is also the safe assumption for anything else —
 * erring towards under-entering rather than hammering someone's form.
 */
export const DEFAULT_REPEATABLE_INTERVAL_HOURS = 24;

export interface EntryHistoryItem {
  status: EntryStatus;
  attemptedAt: Date;
  /** Dry-run attempts are excluded by the caller; kept explicit so that stays visible here. */
  dryRun: boolean;
}

export interface SchedulableCompetition {
  maxEntries: number;
  entryIntervalHours: number | null;
  closesAt: Date | null;
}

export type ScheduleAction =
  /** Attempt it now. */
  | "ENTER"
  /** Open, but not due yet — leave PENDING and try on a later pass. */
  | "WAIT"
  /** Past its own closing date. */
  | "CLOSE"
  /** Its own per-person entry cap is already met. */
  | "CAP_REACHED"
  /** Failing consistently enough that retrying is just noise. */
  | "GIVE_UP";

export interface ScheduleDecision {
  action: ScheduleAction;
  /** Human-readable, and written straight into the run log. */
  reason: string;
  /** Set for WAIT — the earliest time this becomes due again. */
  readyAt?: Date;
}

/** Entry outcomes that mean "the site counted us this period" — a real success, or the site itself saying we already have one. */
function isCountedAttempt(status: EntryStatus): boolean {
  return status === "SUCCESS" || status === "SKIPPED_ALREADY_ENTERED";
}

/** The competition's own cadence, falling back to daily for anything repeatable that didn't say. */
export function effectiveIntervalHours(competition: SchedulableCompetition): number | null {
  if (competition.entryIntervalHours != null) return competition.entryIntervalHours;
  return competition.maxEntries > 1 ? DEFAULT_REPEATABLE_INTERVAL_HOURS : null;
}

function addHours(from: Date, hours: number): Date {
  return new Date(from.getTime() + hours * 3600_000);
}

/**
 * `history` must be this competition's non-dry-run entries. Order doesn't
 * matter — it's sorted here — so callers can pass Prisma's rows straight in.
 */
export function decideSchedule(
  competition: SchedulableCompetition,
  history: EntryHistoryItem[],
  now: Date = new Date(),
): ScheduleDecision {
  if (competition.closesAt && competition.closesAt <= now) {
    return { action: "CLOSE", reason: `closed on ${competition.closesAt.toISOString().slice(0, 10)}` };
  }

  const real = history
    .filter((e) => !e.dryRun)
    .slice()
    .sort((a, b) => b.attemptedAt.getTime() - a.attemptedAt.getTime());

  const successes = real.filter((e) => e.status === "SUCCESS").length;
  if (successes >= competition.maxEntries) {
    return { action: "CAP_REACHED", reason: `entry cap reached (${successes}/${competition.maxEntries})` };
  }

  // Consecutive failures, most recent first, stopping at the first attempt
  // that wasn't a failure. SKIPPED_RULES is excluded on purpose: it means
  // the adapter declined to enter (an unknown quiz answer, say), which is
  // a standing condition rather than a flaky site, and shouldn't decay
  // into an exponential retry curve — it gets its own flat recheck below.
  let consecutiveFailures = 0;
  for (const entry of real) {
    if (entry.status !== "FAILED") break;
    consecutiveFailures += 1;
  }

  if (consecutiveFailures >= GIVE_UP_AFTER_CONSECUTIVE_FAILURES) {
    return {
      action: "GIVE_UP",
      reason: `${consecutiveFailures} consecutive failures with no success in between`,
    };
  }

  // Two independent waits, whichever lands later wins: a failure part-way
  // through a daily draw's cooldown must not shorten that cooldown, and a
  // completed daily entry must not cancel a backoff.
  const waits: { readyAt: Date; reason: string }[] = [];

  if (consecutiveFailures > 0) {
    const hours = BACKOFF_HOURS[Math.min(consecutiveFailures, BACKOFF_HOURS.length) - 1] ?? 24;
    waits.push({
      readyAt: addHours(real[0]!.attemptedAt, hours),
      reason: `backing off ${hours}h after ${consecutiveFailures} consecutive failure(s)`,
    });
  }

  const intervalHours = effectiveIntervalHours(competition);
  const lastCounted = real.find((e) => isCountedAttempt(e.status));
  if (intervalHours != null && lastCounted) {
    waits.push({
      readyAt: addHours(lastCounted.attemptedAt, intervalHours),
      reason: `already entered within its ${intervalHours}h entry interval`,
    });
  }

  if (real[0]?.status === "SKIPPED_RULES") {
    waits.push({
      readyAt: addHours(real[0].attemptedAt, DECLINED_RECHECK_HOURS),
      reason: `adapter declined to enter last time — rechecking every ${DECLINED_RECHECK_HOURS}h`,
    });
  }

  const blocking = waits.filter((w) => w.readyAt > now).sort((a, b) => b.readyAt.getTime() - a.readyAt.getTime())[0];
  if (blocking) {
    return {
      action: "WAIT",
      reason: `${blocking.reason} — due again ${blocking.readyAt.toISOString().slice(0, 16).replace("T", " ")}Z`,
      readyAt: blocking.readyAt,
    };
  }

  return { action: "ENTER", reason: "due" };
}
