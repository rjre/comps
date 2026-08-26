import type { Page } from "playwright";
import type { Profile } from "@prisma/client";
import type { RunLogger } from "@/lib/logger";

export type SubscriptionOutcome =
  | { status: "SUCCESS"; message?: string; credentials?: { username?: string; password?: string } }
  | { status: "FAILED"; message: string };

export interface NewsletterAdapterContext {
  page: Page;
  sourceUrl: string;
  profile: Profile;
  log: RunLogger;
  dryRun: boolean;
}

/**
 * One adapter per newsletter source, mirroring the competition adapter
 * pattern in src/lib/automation. Explicitly opt-in only — this exists
 * because the user directly asked to be signed up for these organisations'
 * own newsletters, not because an adapter decided to tick a box on their
 * behalf. Scoped to a first-party newsletter; a broader "share my data
 * with our partners" checkbox is a different kind of consent and should
 * stay unticked even here.
 */
export interface NewsletterAdapter {
  key: string;
  siteName: string;
  subscribe(ctx: NewsletterAdapterContext): Promise<SubscriptionOutcome>;
}
