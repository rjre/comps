/**
 * Competition discovery: the "search" half of search → enter → search →
 * enter.
 *
 * Until now this half didn't run on this machine at all. New competitions
 * only arrived when a cloud research routine wrote them into
 * prisma/pending-competitions.json and pushed, which scripts/
 * syncCompetitions.ts then turned into rows. That works, but it means the
 * local service isn't self-sufficient: if the cloud routine stops, the
 * queue drains to nothing and the runner has nothing left to enter.
 *
 * A discovery source closes that gap for platforms this project already
 * has a working adapter for. It is deliberately NOT a generic crawler —
 * it enumerates a known site's own competition index, which is the same
 * discipline as the per-site adapters (README: "Per-site adapters, not
 * generic scraping"). Nothing it finds gets entered by some new code path;
 * everything routes through the existing adapter for that platform.
 */
export interface DiscoveredCompetition {
  name: string;
  url: string;
  adapterKey: string;
  closesAt: Date | null;
  maxEntries: number;
  entryIntervalHours: number | null;
  notes: string;
}

export interface DiscoveryContext {
  log: (message: string) => Promise<void>;
  /**
   * Competition URLs already in the database. Sources use this to skip
   * fetching detail pages they'd only discard — the index pages are
   * mostly competitions we're already tracking.
   */
  known: Set<string>;
}

export interface DiscoverySource {
  key: string;
  /** Human-readable, for the run log. */
  describe: string;
  /** Extra origins to crawl beyond the source's own seeds — the runner passes in origins already in the DB. */
  discover(ctx: DiscoveryContext, extraOrigins: string[]): Promise<DiscoveredCompetition[]>;
}
