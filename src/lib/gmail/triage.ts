/**
 * Deciding what a scanned email *is*, and what competition links it
 * offers, kept as pure functions so the judgement calls are testable
 * without a mailbox — the Gmail-touching code around them can't be.
 *
 * Three outcomes, in priority order:
 *
 * - `WIN` — looks like a prize notification. These are the whole point of
 *   scanning, and the one case a human has to see.
 * - `LEADS` — a promotional/newsletter mail carrying competition links
 *   worth tracking.
 * - `NOTHING` — neither; handled by being archived, nothing else.
 *
 * WIN wins ties on purpose: a newsletter that both announces a winner and
 * links to more competitions should be looked at by a person, not quietly
 * filed.
 */

export type EmailCategory = "WIN" | "LEADS" | "NOTHING";

export interface TriageInput {
  from: string;
  subject: string;
  /** Plain-text body, or the snippet when the body isn't available. */
  body: string;
}

/**
 * Phrases that indicate *this recipient* has won, as opposed to the far
 * more common "congratulations to our winner" / "you could win" marketing
 * copy that every competition newsletter is full of.
 */
const WIN_PATTERNS: RegExp[] = [
  /\byou(?:'ve| have)\s+won\b/i,
  /\byou\s+are\s+(?:a|our|the)\s+winner\b/i,
  /\bcongratulations[!,.\s].{0,40}\byou(?:'ve| have|'re| are)\b/i,
  /\bclaim\s+your\s+prize\b/i,
  /\bwinner\s+announcement\b.{0,60}\byou\b/i,
  /\byour\s+prize\s+(?:is|has|awaits)\b/i,
  /\bwe(?:'re| are)\s+delighted\s+to\s+(?:tell|inform)\s+you\b.{0,60}\bwon\b/i,
];

/**
 * Marketing copy that *looks* win-shaped but isn't. Checked first, because
 * "you could win" contains none of the patterns above but "congratulations,
 * you can win" would trip the third one.
 */
const NOT_A_WIN_PATTERNS: RegExp[] = [
  /\byou\s+(?:could|can|might|may)\s+win\b/i,
  /\bchance\s+to\s+win\b/i,
  /\benter\s+(?:now|today|for\s+a\s+chance)\b/i,
  /\bwin\s+a\b/i,
];

export function looksLikeWin({ subject, body }: TriageInput): boolean {
  const haystack = `${subject}\n${body}`;
  const hasWinPhrase = WIN_PATTERNS.some((re) => re.test(haystack));
  if (!hasWinPhrase) return false;

  // A genuine win notification can still contain "win a" further down (a
  // footer promoting the next draw), so a marketing phrase only overrides
  // when there's no win phrase in the subject line itself — the subject is
  // where a real notification says so.
  const subjectSaysWon = WIN_PATTERNS.some((re) => re.test(subject));
  if (subjectSaysWon) return true;

  return !NOT_A_WIN_PATTERNS.some((re) => re.test(haystack));
}

/** Link-shortener and tracking hosts whose targets we can't judge without following them. */
const TRACKING_HOSTS =
  /^(?:www\.)?(?:bit\.ly|tinyurl\.com|t\.co|goo\.gl|ow\.ly|buff\.ly|lnkd\.in|trk\.|click\.|links?\.|email\.|mailchi\.mp|list-manage\.com)/i;

/** Paths that are never a competition entry: unsubscribes, preference centres, social, images. */
const NON_COMPETITION_PATH =
  /(unsubscribe|preferences|privacy|terms|opt[-_]?out|profile|\.(?:png|jpe?g|gif|css|js|svg|webp)$)/i;

const SOCIAL_HOSTS =
  /^(?:www\.)?(?:facebook|twitter|x|instagram|linkedin|tiktok|youtube|pinterest|threads)\.com$/i;

/**
 * Competition-ish link text/URLs. Deliberately narrow: an email's links are
 * mostly navigation and tracking, and every false positive here becomes a
 * Competition row that the generic adapter then tries to fill in.
 */
const COMPETITION_HINT = /(competition|giveaway|sweepstake|prize[-_ ]?draw|win[-_]|\/win\b|enter[-_]?now|reader[-_ ]?treat)/i;

export interface ExtractedLink {
  url: string;
  /** Which signal matched, for the log. */
  reason: string;
}

/**
 * Competition links worth resolving, from an email's HTML or text body.
 *
 * This only *proposes* URLs — everything downstream (robots.txt, SSRF
 * checks, entry-URL resolution, the fillable-form check) still applies,
 * because these go through the same pipeline as a feed item.
 */
export function extractCompetitionLinks(body: string, limit = 20): ExtractedLink[] {
  const found = new Map<string, string>();

  const hrefs = [...body.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((m) => m[1]!);
  const bare = [...body.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)].map((m) => m[0]);

  for (const raw of [...hrefs, ...bare]) {
    const candidate = raw.trim().replace(/[.,;)]+$/, "");
    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      continue;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") continue;
    if (SOCIAL_HOSTS.test(parsed.hostname)) continue;
    if (TRACKING_HOSTS.test(parsed.hostname)) continue;
    if (NON_COMPETITION_PATH.test(parsed.pathname)) continue;
    if (!COMPETITION_HINT.test(parsed.href)) continue;

    // Strip the tracking query string: the same competition arrives with a
    // different utm_* every send, and Competition.url is unique, so keeping
    // them would register the same competition over and over.
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(utm_|mc_|_hs|fbclid|gclid|ref|source|campaign)/i.test(key)) parsed.searchParams.delete(key);
    }
    const normalised = parsed.toString();
    if (!found.has(normalised)) found.set(normalised, "URL matches a competition pattern");
    if (found.size >= limit) break;
  }

  return [...found.entries()].map(([url, reason]) => ({ url, reason }));
}

export function categorise(input: TriageInput): { category: EmailCategory; links: ExtractedLink[] } {
  if (looksLikeWin(input)) return { category: "WIN", links: [] };
  const links = extractCompetitionLinks(input.body);
  return { category: links.length > 0 ? "LEADS" : "NOTHING", links };
}
