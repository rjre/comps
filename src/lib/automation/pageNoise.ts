/**
 * Competition pages on ad-funded magazine sites throw a torrent of console
 * errors that have nothing to do with our entry: blocked third-party
 * trackers, mixed-content ad frames, CORS-refused pixel syncs, 451s from
 * ad servers that won't serve the UK. Every one of those used to be
 * written to the DB as a WARN LogLine, which made the run log unreadable
 * (a single DMRI entry produced ~40 of them around 5 useful lines) and was
 * the bulk of the database's growth.
 *
 * They're not worthless, though — when an entry *does* fail, a page error
 * from the site's own code is often the explanation. So the runner buffers
 * them per competition and only writes a deduplicated summary when the
 * attempt didn't succeed.
 */

/** Errors that are definitionally about someone else's ad/tracking stack, not the entry form. */
const THIRD_PARTY_NOISE: RegExp[] = [
  /^Failed to load resource/i,
  /^Mixed Content:/i,
  /blocked by CORS policy/i,
  /net::ERR_/i,
  /Refused to display .* in a frame/i,
  /X-Frame-Options/i,
  /Content Security Policy/i,
  /googlesyndication|doubleclick|googletagmanager|adservice|pubmatic|onetag|prebid|criteo|taboola|outbrain/i,
  /bordeaux\.futurecdn|ATS-DROPMATCH|PixelID is not configured|pubx bid floors/i,
  /third-party cookie|SameSite|deprecat/i,
];

export function isPageNoise(text: string): boolean {
  return THIRD_PARTY_NOISE.some((re) => re.test(text));
}

/**
 * Collects a competition attempt's page-level errors, dropping the
 * third-party noise and collapsing repeats (the same ad script can fire
 * the identical error dozens of times per page load).
 */
export class PageIssueCollector {
  private readonly counts = new Map<string, number>();
  private droppedNoise = 0;

  record(kind: "console" | "pageerror", text: string): void {
    const full = text.trim().replace(/\s+/g, " ");
    if (!full) return;
    // Match against the whole message, then truncate. Ad-script errors
    // often only identify themselves in the stack trace at the end (a
    // "%c BORDEAUX ... Error getting pubx bid floors" line names
    // bordeaux.futurecdn.net 300 characters in), so truncating first let
    // them through as if they were the site's own errors.
    if (isPageNoise(full)) {
      this.droppedNoise += 1;
      return;
    }
    const message = full.slice(0, 300);
    const key = `${kind === "pageerror" ? "Page error" : "Console error"}: ${message}`;
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }

  get noiseCount(): number {
    return this.droppedNoise;
  }

  /** Deduplicated, most-frequent-first, capped — for logging after a failed attempt. */
  summary(limit = 8): string[] {
    return [...this.counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([message, count]) => (count > 1 ? `${message} (x${count})` : message));
  }
}
