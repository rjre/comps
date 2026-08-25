import type { Page } from "playwright";
import type { Profile } from "@prisma/client";
import type { EntryStatus } from "@/lib/status";

export type EntryOutcome =
  | { status: Extract<EntryStatus, "SUCCESS">; message?: string }
  | { status: Extract<EntryStatus, "FAILED">; message: string }
  | { status: Extract<EntryStatus, "SKIPPED_ALREADY_ENTERED">; message?: string }
  | { status: Extract<EntryStatus, "SKIPPED_RULES">; message: string };

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
  enterCompetition(page: Page, competitionUrl: string, profile: Profile): Promise<EntryOutcome>;
}
