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
