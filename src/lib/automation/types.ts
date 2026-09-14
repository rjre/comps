import type { Page } from "playwright";
import type { Profile } from "@prisma/client";
import type { EntryStatus } from "@/lib/status";
import type { RunLogger } from "@/lib/logger";

export type EntryOutcome =
  | { status: Extract<EntryStatus, "SUCCESS">; message?: string; credentials?: { username?: string; password?: string } }
  | { status: Extract<EntryStatus, "FAILED">; message: string }
  | { status: Extract<EntryStatus, "SKIPPED_ALREADY_ENTERED">; message?: string }
  | { status: Extract<EntryStatus, "SKIPPED_RULES">; message: string };

/** One of this competition's own earlier attempts, newest first — see AdapterContext.previousOutcomes. */
export interface PreviousOutcome {
  status: EntryStatus;
  message: string | null;
  attemptedAt: Date;
}

export interface AdapterContext {
  page: Page;
  competitionUrl: string;
  profile: Profile;
  /**
   * This competition's earlier real (non-dry-run) attempts, newest first,
   * so an adapter can avoid repeating something the site already rejected.
   * The DMRI adapter uses it to stop re-submitting a quiz answer that was
   * marked wrong on a previous day's draw. Empty on a first attempt.
   */
  previousOutcomes: PreviousOutcome[];
  /**
   * Recent outcomes recorded on OTHER competitions this same adapter
   * handles, newest first.
   *
   * The DMRI platform runs one competition concurrently across its sibling
   * magazine sites — the identical question and options, on up to eleven
   * domains at once, each drawing its own winners. Establishing the answer
   * on one of them therefore establishes it on all of them, and a wrong
   * answer rejected by one site is wrong on all of them too. Without this
   * every sibling re-derived the same question from scratch and, when the
   * derivation couldn't settle it, declined all eleven.
   *
   * Empty for adapters whose sites have nothing in common; it's up to each
   * adapter to decide what, if anything, a peer's outcome tells it.
   */
  peerOutcomes: PreviousOutcome[];
  /**
   * An answer to this competition's own question, established outside the
   * adapter — see Competition.quizAnswer and src/lib/answers. Null when
   * nothing has been established, which is the normal case for a
   * competition nobody publishes an answer for.
   */
  knownAnswer: string | null;
  /** Log to the current run — use liberally, this is what makes an adapter debuggable later. */
  log: RunLogger;
  /**
   * When true, the adapter must fill the form but stop short of the final
   * submit action, returning what it *would* have done. Lets a new adapter
   * be checked against a real page without spending one of the
   * competition's limited entries.
   */
  dryRun: boolean;
}

/**
 * One adapter per competition site. Adapters map the profile's fields onto
 * that site's specific form — no generic "guess the form" automation, so
 * behavior per site stays predictable and easy to audit against that site's
 * own rules (one entry per person, required disclosures, etc).
 */
export interface CompetitionAdapter {
  key: string;
  /** Human-readable name of the site/platform this adapter targets. */
  siteName: string;
  enterCompetition(ctx: AdapterContext): Promise<EntryOutcome>;
}
