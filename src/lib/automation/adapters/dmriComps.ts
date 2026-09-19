import { createHash } from "crypto";
import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";
import type { EntryStatus } from "@/lib/status";

/**
 * DMRI reader-competitions club sites — a white-label platform Future PLC
 * uses across several of its own magazine brands (confirmed directly:
 * comps.marieclaire.co.uk, comps.womanmagazine.co.uk and
 * comps.whatsontv.co.uk all run the identical UI/flow, sometimes even the
 * same individual competition "concurrently" across sites — but each
 * domain has its own separate account database, a real login on one
 * doesn't carry over to another, confirmed directly). This adapter is
 * written generically against that shared platform (deriving the site's
 * own origin from whatever competition URL it's given, never hardcoding
 * one magazine's domain), so a single adapter key covers every DMRI site
 * this project tracks a competition on — adding a new one is just a new
 * `TRIVIA_ANSWERS` entry plus a Competition row pointing at this same
 * adapterKey, not a new file. Found via aggregators (competitionstoday.co.uk
 * for the Marie Claire one) used only as lead sources and for their
 * pre-researched trivia answers — entry always happens on the organiser's
 * own domain. Genuinely no purchase necessary, real registered UK
 * publisher.
 *
 * Unlike a one-shot competition, this platform runs DAILY prize draws —
 * its own confirmation text says "you can enter this prize draw once each
 * day so enter again tomorrow to increase your chances". Competition rows
 * using this adapter should be given a high `maxEntries` (not the default
 * 1) so the scheduler keeps re-querying them as PENDING and re-entering
 * daily until they close, rather than marking ENTERED after the first win.
 *
 * Entering requires a free Marie Claire competitions-club account — this
 * is the organiser's own official membership system, not an unrelated
 * third-party lead-gen hub (distinct from the earlier Cruise Collective
 * skip), so building an account-creation flow here is in scope. Since
 * AdapterContext doesn't hand back a previously-stored credential on
 * retry, the password is derived deterministically from profile.email (a
 * fixed salt + sha256, formatted to satisfy the site's own password rule:
 * starts with a letter, 8+ characters, at least one number) so every
 * run — whether registering for the first time or logging back in on a
 * later day — computes the same password without needing it fed back in.
 *
 * This domain returns a hard 403 for Playwright's default Chromium user
 * agent string specifically (confirmed directly: the exact same request
 * succeeds with a realistic desktop Chrome UA) — set explicitly before
 * navigating, unlike every other adapter in this project which has never
 * needed to.
 *
 * Confirmed directly, live, that the login endpoint silently creates a
 * minimal account on its very first successful attempt with a brand-new
 * email — no separate "you must register first" step. That minimal
 * account has no address or personal details saved yet, and a competition
 * page's in-page "complete your profile" modal for supplying them turned
 * out to be unreliable (transient/stale frame references, a duplicate
 * `#submit-comp-button` id colliding with an unrelated "Continue" button,
 * and fields that appeared to fill successfully but never actually
 * persisted — confirmed directly by checking /account afterwards and
 * finding them still blank). The dedicated /account page is a real,
 * stable, non-modal form for the exact same fields and reliably persists
 * them ("Thank you. We have successfully updated your account."), so
 * profile completion always goes through that page instead, whether this
 * is a brand-new account or one that's missing details from an earlier
 * silent auto-creation.
 *
 * Each competition here poses its own multiple-choice trivia question — a
 * couple of genuinely factual, independently verifiable options rather
 * than a fill-in-the-blank or subjective prompt (e.g. "How many rooms does
 * Tewkesbury Park have?", answered from the competition page's own
 * descriptive copy). `TRIVIA_ANSWERS` maps each competition URL to its
 * researched correct answer text, matched against the option labels
 * actually rendered (their underlying ids/values are dynamically
 * generated per competition, so matching is done by visible label text).
 *
 * The quiz form itself can carry the entry platform's own always-present
 * "would you like to hear about future offers" opt-in
 * (`CompetitionEntryForm[optin]`, confirmed directly: same field name every
 * time, so matched directly by id rather than by label text), and both that
 * page and (more often) the pages reached after submitting can also carry a
 * rotating third-party "more info from <some comping/tips newsletter>"
 * opt-in (seen offering "Across the Leagues EXTRA", "Coffee Break Winner",
 * and a HealthWindow insurance-quote partner on different runs) zero or
 * more times before the entry is actually confirmed. Every one of these —
 * the organiser's own opt-in included — is answered "no"/declined:
 * README's "No auto-consent" rule doesn't carve out an exception for the
 * organiser's own marketing, only for the specific newsletter signups this
 * project's user deliberately requested elsewhere. Its exact wording is NOT
 * stable enough to match reliably — the same HealthWindow offer alone
 * rendered its decline option as "No Thanks", "No thanks", and "No, Thanks"
 * on different runs (confirmed directly, live) — so answers are chosen by
 * which named `QB[...]` radio group(s) are present each round, matched by
 * whichever option's label contains "no", not literal value/label text.
 * This can repeat across more than one partner in a row, so it's handled in
 * a loop until no offer remains and a "Confirm Entry" step appears, which
 * is what actually finalises the entry.
 *
 * Every checkbox/radio interaction anywhere on this site (opt-ins, quiz
 * answers, the partner-offer radio) is done via direct DOM property
 * assignment + a dispatched `change` event rather than a Playwright click
 * — native clicks on these particular controls were confirmed, repeatedly
 * and live, to hang indefinitely for a reason never fully isolated
 * (stability checks pass, then nothing — no "intercepts pointer events"
 * message, just a timeout).
 */
const TRIVIA_ANSWERS: Record<string, string> = {
  "https://comps.marieclaire.co.uk/competition/a_two_night_stay_at_tewkesbury_park_marieclaire/122613.php": "93",
  // Answer sourced from ThePrizeFinder.com (an aggregator, used only as a
  // lead/answer source — entry itself happens on Woman Magazine's own
  // domain). Confirmed via the same content run "concurrently" on multiple
  // sibling DMRI sites (Life Death Prizes, Woman's Own, etc.) each drawing
  // independent winners per site (seen directly on a different, now-closed
  // sibling competition's own winners list) — so this is a genuinely
  // separate prize draw, not a duplicate entry into a shared one.
  "https://comps.womanmagazine.co.uk/competition/the-original-tour-win%E2%80%93family-tickets-two-day-hop-on-hop-off-bus-tour-london_network/122957.php":
    "The Festival of Britain",
  // Same content, same verified answer, genuinely separate draw on Woman's
  // Weekly's own sibling DMRI site (independent winners per site, per the
  // comment above).
  "https://competitions.womansweekly.com/competition/the-original-tour-win%E2%80%93family-tickets-two-day-hop-on-hop-off-bus-tour-london_network/122958.php":
    "The Festival of Britain",
  // The following 10 entries were sourced from competitions-whale.co.uk (a
  // dedicated Marie Claire "competitions & answers" aggregator, same
  // lead/answer-source-only role as ThePrizeFinder above — entry always
  // happens on comps.marieclaire.co.uk itself). Confidence note: unlike the
  // three entries above, these were NOT independently cross-checked against
  // a second source or the competition's own descriptive copy — the one
  // exception is Tewkesbury Park (122613) just above, where this same
  // aggregator's "Suggested Answer: 93" exactly matches the already-verified
  // "93" pinned above, which is reassuring about this source's general
  // reliability but doesn't independently confirm each individual answer
  // below. If any of these get marked wrong by the site, don't assume the
  // aggregator is bad across the board — re-check that one specifically.
  "https://comps.marieclaire.co.uk/competition/a_threenight_stay_at_daisy_bank_camp_marieclaire/122656.php":
    "West Yorkshire",
  "https://comps.marieclaire.co.uk/competition/a_nights_stay_in_a_stunning_cotswold_cottage__co_marieclaire/122449.php":
    "6",
  "https://comps.marieclaire.co.uk/competition/_a__aureous_gift_card__marieclaire/122457.php": "Aureous",
  "https://comps.marieclaire.co.uk/competition/a_magical_christmas_experience_at_blenheim_palace_marieclaire/122508.php":
    "Cinderella",
  "https://comps.marieclaire.co.uk/competition/_the_high_tide_cowshed_spa_getaway_at_st_moritz_hotel_marieclaire/122687.php":
    "Cornwall",
  "https://comps.marieclaire.co.uk/competition/a_wild_keeper_retreat_stay_at_safari_lodges_marieclaire/122559.php":
    "Elephant and Cheetah",
  "https://comps.marieclaire.co.uk/competition/slaybae_marieclaire/122387.php": "Renting designer dresses",
  // Question is "Who plays Alexa's bad boy brother Will?" — the aggregator's
  // scrape ran the question and answer together; "Martin Henderson" is the
  // answer portion.
  "https://comps.marieclaire.co.uk/competition/my_life_is_murder_series_5_dvd_marieclaire/122606.php":
    "Martin Henderson",
  "https://comps.marieclaire.co.uk/competition/a_years_free_membership_with_traininpink_marieclaire/122611.php":
    "Carlotta Gagna",
  "https://comps.marieclaire.co.uk/competition/a_stellar_trip_with_spring_hotels_to_starmus_viii__marieclaire/123002.php":
    "Brian May",
};

/**
 * Number words the platform's questions and copy swap between freely —
 * "three distinctive interior styles" in the prose, "3" as an option.
 */
const NUMBER_WORDS: Record<string, string> = {
  "0": "zero", "1": "one", "2": "two", "3": "three", "4": "four", "5": "five",
  "6": "six", "7": "seven", "8": "eight", "9": "nine", "10": "ten",
  "11": "eleven", "12": "twelve",
};

/**
 * Punctuation and connectives the option label and the prose spell
 * differently for the same thing — the copy's "Waffi Space Saver Cot &
 * Mattress" against the option's "A Waffi Space Saver Cot and Mattress",
 * or a curly apostrophe against a straight one. Normalising both sides is
 * a like-for-like comparison, not a loosening of the match.
 */
function normaliseText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/&/g, " and ")
    .replace(/\s+/g, " ")
    .trim();
}

function answerVariants(option: string): string[] {
  const base = normaliseText(option);
  const variants = new Set([base]);
  // "A Waffi Space Saver Cot" is the same answer as the copy's plain
  // "Waffi Space Saver Cot" — the article belongs to the option list's
  // phrasing, not to the answer.
  const withoutArticle = base.replace(/^(a|an|the)\s+/, "");
  if (withoutArticle !== base) variants.add(withoutArticle);
  const asWord = NUMBER_WORDS[base];
  if (asWord) variants.add(asWord);
  for (const [digit, word] of Object.entries(NUMBER_WORDS)) {
    if (word === base) variants.add(digit);
  }
  return [...variants].filter((variant) => variant.length > 0);
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Recognises the DMRI platform's own URL shape
 * (`/competition/<slug>/<numeric-id>.php`), independent of which magazine's
 * domain it's on. Future PLC/Hearst run this exact same white-label
 * platform under dozens of sibling brand domains (confirmed directly:
 * marieclaire, womanmagazine, womansweekly, whatsontv, madeformums,
 * topsante, womensfitness, olivemagazine, and more all share it), and
 * feed-discovery keeps finding new ones this project has never seen before
 * — there's no fixed list of domains to maintain. Used both to fix
 * misclassified rows (see scripts/backfillAdapterKeys.ts) and to stop
 * feed-discovery creating a new one as `generic` in the first place (see
 * runDiscovery.ts), so a competition on this platform is never entered by
 * the heuristic form-filler, which cannot get past its login wall.
 */
export function looksLikeDmriUrl(url: string): boolean {
  try {
    return /^\/competition\/[^/]+\/\d+\.php$/.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/** Does `needle` occur in `haystack` as a whole word/phrase rather than inside a longer one? */
function occursAsWord(needle: string, haystack: string): boolean {
  return new RegExp(`(^|[^a-z0-9])${escapeForRegex(needle)}([^a-z0-9]|$)`, "i").test(haystack);
}

/** Does `option` appear in the competition's own descriptive copy, as a whole word/phrase? */
export function appearsInCopy(option: string, copy: string): boolean {
  const haystack = normaliseText(copy);
  return answerVariants(option).some((variant) => occursAsWord(variant, haystack));
}

/**
 * Words that carry no information about which option is which — matching
 * on them would make every option look partly present.
 */
const OPTION_STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "with", "for", "from", "by",
  "its", "it", "is", "are", "was", "were", "be", "plus", "your", "you", "our", "we",
]);

/** An option's distinguishing words, normalised and de-duplicated. */
function contentTokens(option: string): string[] {
  const tokens = normaliseText(option)
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/[\s-]+/)
    .map((token) => token.replace(/^'+|'+$/g, ""))
    .filter((token) => token.length > 0 && !OPTION_STOPWORDS.has(token));
  return [...new Set(tokens)];
}

/** A token and the forms the copy might spell it in — "3" for "three", and back. */
function tokenVariants(token: string): string[] {
  const variants = new Set([token]);
  const asWord = NUMBER_WORDS[token];
  if (asWord) variants.add(asWord);
  for (const [digit, word] of Object.entries(NUMBER_WORDS)) {
    if (word === token) variants.add(digit);
  }
  return [...variants];
}

/**
 * What fraction of an option's distinguishing words the copy actually
 * contains, 0..1.
 *
 * Exact whole-phrase matching alone was declining draws whose answer is
 * plainly in the copy, just not worded identically — confirmed live on a
 * Neutradol draw offering "Fresh Pink, Original and Super Fresh" against
 * copy reading "available from Neutradol in Original and Pink Fresh
 * fragrances". The answer is there; the option list just reorders and
 * extends it. Scoring the overlap instead of demanding the exact string
 * reads that correctly (0.75 against 0.2 and 0.17 for the two wrong
 * options) without loosening anything into a guess — see
 * deriveAnswerFromCopy for the thresholds that keep it honest.
 */
export function copyOverlap(option: string, copy: string): number {
  const tokens = contentTokens(option);
  if (tokens.length === 0) return 0;
  const haystack = normaliseText(copy);
  const present = tokens.filter((token) => tokenVariants(token).some((v) => occursAsWord(v, haystack)));
  return present.length / tokens.length;
}

/**
 * How much of the winning option the copy must contain, and by how much it
 * must beat the runner-up, before an overlap score counts as having
 * settled the answer.
 *
 * Both are needed, and both are deliberately strict. On the Holiday Inn
 * Oxford draw — options "The City of Dreaming Spires" (the true answer,
 * general knowledge, absent from the page) against "The City of Seven
 * Hills" and "The Emerald City" — the top score is "The Emerald City" on
 * 0.5, purely because both it and the copy contain the word "city". The
 * floor rejects it for being mostly absent, and the margin rejects it for
 * being barely ahead of a rival. Either one alone would have submitted a
 * wrong answer; together they decline, which is the correct outcome for a
 * question the copy genuinely doesn't answer.
 */
export const OVERLAP_FLOOR = 0.6;
export const OVERLAP_MARGIN = 0.3;

/**
 * Answers a competition's quiz question from the competition page's own
 * descriptive copy, for competitions that have no hand-researched entry in
 * TRIVIA_ANSWERS.
 *
 * This platform's questions are deliberately answerable from the prose
 * immediately above the form ("Each spacious Spa Suite ... features three
 * distinctive interior styles" / "How many interior styles..."), which is
 * the whole point of the format — it's a read-the-advertiser's-copy check,
 * not a general-knowledge test. So: take the page's text with the entry
 * form itself removed, and see which of the offered options actually
 * appears in it.
 *
 * Deliberately conservative — it returns an answer only when EXACTLY ONE
 * option appears in the copy. Two matches, or none, means the copy doesn't
 * settle it, and the adapter declines rather than guessing (README's "fail
 * loudly" rule). Options the site has already rejected on an earlier day's
 * draw are excluded first, so a wrong derivation self-corrects over the
 * following days instead of repeating forever.
 */
export function deriveAnswerFromCopy(
  options: string[],
  copy: string,
  rejected: Set<string>,
): { answer: string; how: string } | { answer: null; reason: string } {
  const usable = options.filter((option) => !rejected.has(option.trim().toLowerCase()));
  if (usable.length === 0) {
    return { answer: null, reason: "every offered option has already been rejected as incorrect by the site" };
  }
  const matches = usable.filter((option) => appearsInCopy(option, copy));
  if (matches.length === 1) return { answer: matches[0]!, how: "it is the only option quoted in the copy" };
  if (matches.length > 1) {
    // Two options both quoted verbatim means the copy mentions both and
    // the question is what separates them — which this doesn't read. Still
    // a decline; the overlap score below would only be picking between two
    // phrases the copy equally contains.
    return { answer: null, reason: `the copy is ambiguous — ${matches.join(" and ")} all appear in it` };
  }

  // No option is quoted word-for-word. Fall back to which option the copy
  // most nearly contains — see copyOverlap, OVERLAP_FLOOR, OVERLAP_MARGIN.
  const scored = usable
    .map((option) => ({ option, score: copyOverlap(option, copy) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  const runnerUp = scored[1];
  const margin = runnerUp ? top.score - runnerUp.score : 1;
  if (top.score >= OVERLAP_FLOOR && margin >= OVERLAP_MARGIN) {
    return {
      answer: top.option,
      how:
        `the copy contains ${Math.round(top.score * 100)}% of it` +
        `${runnerUp ? `, against ${Math.round(runnerUp.score * 100)}% for the next closest option` : ""}`,
    };
  }
  return {
    answer: null,
    reason:
      `none of the options (${usable.join(" / ")}) appear in the competition's own copy` +
      ` (closest was "${top.option}" at ${Math.round(top.score * 100)}%` +
      `${runnerUp ? `, next ${Math.round(runnerUp.score * 100)}%` : ""})`,
  };
}

/**
 * Reads the rendered quiz: the options on offer, and the page's own
 * descriptive copy with everything that could match an option *because
 * it's an option* stripped out (all `label` elements, plus chrome and
 * scripts). Without that subtraction every option trivially "appears in
 * the copy" and derivation would be meaningless.
 *
 * Quiz radios are identified by exclusion — this platform's other radio
 * groups are its own `optIn*` opt-in and the rotating `QB[...]` partner
 * offers, both already handled by answerOffersAndOptin. Whichever
 * remaining radio group is largest is the quiz.
 */
async function readQuiz(page: { evaluate: Function }): Promise<{ options: string[]; copy: string; question: string }> {
  return (await page.evaluate(() => {
    const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(
      (radio) => !/^optIn/i.test(radio.id || "") && !/^QB\[/.test(radio.name || ""),
    );
    const groups = new Map<string, HTMLInputElement[]>();
    for (const radio of radios) {
      const key = radio.name || radio.id;
      const group = groups.get(key);
      if (group) group.push(radio);
      else groups.set(key, [radio]);
    }
    const largest = [...groups.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    const options = largest
      .map((radio) => document.querySelector(`label[for="${radio.id}"]`)?.textContent?.trim() ?? "")
      .filter((text) => text.length > 0);

    // The question itself, read from the nearest text above the quiz
    // radios (a <legend>, or whatever block element precedes the group).
    // Nothing in the entry flow needs it — the derivation matches options
    // against the copy and never looks at the question — but a decline
    // that doesn't record what was actually being asked leaves no way to
    // research the answer afterwards, and 158 of the 245 open daily draws
    // are currently declined on exactly this. Recording it turns that
    // backlog into a list someone (or a future answer source) can work
    // through.
    const first = largest[0] ?? null;
    let question = "";
    if (first) {
      const legend = first.closest("fieldset")?.querySelector("legend");
      if (legend) question = legend.textContent?.trim() ?? "";
      if (!question) {
        let node: Element | null = first.closest("div, p, li, fieldset, form") ?? first;
        for (let hop = 0; hop < 4 && node && !question; hop++) {
          let sibling = node.previousElementSibling;
          while (sibling && !question) {
            const text = (sibling.textContent ?? "").replace(/\s+/g, " ").trim();
            if (/\?/.test(text) && text.length <= 300) question = text;
            sibling = sibling.previousElementSibling;
          }
          node = node.parentElement;
        }
      }
    }

    const clone = document.body.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll("script, style, noscript, label, nav, header, footer, select")
      .forEach((node) => node.remove());
    const copy = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
    return { options, copy, question: question.slice(0, 200) };
  })) as { options: string[]; copy: string; question: string };
}

/**
 * A question's identity, for recognising the same competition running on a
 * sibling site.
 *
 * The option set, normalised and sorted: sorted because sibling sites do
 * not render the options in a fixed order, and normalised so a curly
 * apostrophe or an "&" against an "and" doesn't make the same question
 * look like two. Three identical free-text options occurring together by
 * coincidence on two unrelated competitions isn't a real risk, and if it
 * ever did happen the wrong answer would be rejected once and then
 * excluded on both — the same self-correction that already covers a wrong
 * derivation.
 */
export function questionKey(options: string[]): string {
  return options
    .map((option) => normaliseText(option))
    .filter((option) => option.length > 0)
    .sort()
    .join(" / ");
}

/** How an outcome message records the answer it used, so a sibling site can read it back. */
const ANSWER_NOTE = /\[answer "(.+?)" from options: (.+?)\]/;
const REJECTED_NOTE = /^Answer "(.+?)" was rejected as incorrect \(options: (.+?)\)/;

/** Renders the note the two patterns above parse. Kept next to them so the pair can't drift apart. */
export function answerNote(answer: string, options: string[]): string {
  return `[answer "${answer}" from options: ${options.join(" / ")}]`;
}

/**
 * What sibling sites have already established about this same question:
 * an answer one of them had confirmed correct, and every answer any of
 * them has had rejected.
 *
 * A confirmed answer is only taken from a real SUCCESS — the site itself
 * saying "your answer was correct" — never from another site merely
 * having tried something.
 */
export function sharedAnswerFor(
  options: string[],
  peers: { status: EntryStatus; message: string | null }[],
): { confirmed: string | null; rejected: Set<string> } {
  const key = questionKey(options);
  const rejected = new Set<string>();
  let confirmed: string | null = null;

  for (const peer of peers) {
    const message = peer.message ?? "";
    const wrong = REJECTED_NOTE.exec(message);
    if (wrong && questionKey(wrong[2]!.split(" / ")) === key) {
      rejected.add(wrong[1]!.trim().toLowerCase());
      continue;
    }
    if (peer.status !== "SUCCESS") continue;
    const right = ANSWER_NOTE.exec(message);
    if (right && questionKey(right[2]!.split(" / ")) === key && !confirmed) {
      confirmed = right[1]!;
    }
  }

  // A sibling confirming an answer that another sibling later had rejected
  // is contradictory; trust neither rather than submitting a known-bad one.
  if (confirmed && rejected.has(confirmed.trim().toLowerCase())) confirmed = null;
  return { confirmed, rejected };
}

/**
 * Which answer to submit, given everything established outside the page
 * itself, or null when the page's own copy has to settle it.
 *
 * Order: a hand-researched TRIVIA_ANSWERS entry, then an answer published
 * for this exact competition (Competition.quizAnswer), then one a sibling
 * site has had confirmed correct for this same question.
 *
 * The rejection check applies to all three, which it previously did not: a
 * researched answer was submitted unconditionally, so an answer the site
 * had already graded wrong went back in every single day. That was
 * tolerable while the map was thirteen hand-checked entries; it is not
 * once answers are being read off an aggregator in bulk, where a wrong one
 * would otherwise burn that draw's daily entry for the rest of its life.
 */
export function chooseEstablishedAnswer(
  candidates: { researched?: string; published?: string | null; confirmedBySibling?: string | null },
  rejected: Set<string>,
): { answer: string; how: string } | null {
  const ordered: Array<[string | null | undefined, string]> = [
    [candidates.researched, "hand-researched for this competition"],
    [candidates.published, "published for this competition by an answer source"],
    [candidates.confirmedBySibling, "already confirmed correct by a sibling site running this same question"],
  ];
  for (const [answer, how] of ordered) {
    if (!answer) continue;
    if (rejected.has(answer.trim().toLowerCase())) continue;
    return { answer, how };
  }
  return null;
}

/**
 * Maps an answer established elsewhere onto the exact option label the
 * page is rendering, or null if it doesn't clearly correspond to one.
 *
 * An answer from outside the page is free text and won't necessarily be
 * spelled the way the option is: "12 months" against "12 Months", "Sub 1G"
 * against "Sub-1G", "Café" against "Cafe". Selecting the option works by
 * matching its visible label, so without this the answer is simply
 * reported missing and the entry fails — having had the right answer all
 * along.
 *
 * The containment fallback is deliberately only taken when exactly one
 * option matches: an answer of "5" against options "5", "15" and "25"
 * matches all three and settles nothing, so it declines rather than
 * picking one.
 */
export function resolveToOption(answer: string, options: string[]): string | null {
  // Punctuation collapsed to spaces on both sides, so the separator an
  // answer source happens to use doesn't decide the match — the live case
  // was "Sub 1G" against the page's "Sub-1G".
  const key = (value: string) =>
    normaliseText(value)
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const want = key(answer);
  if (!want) return null;
  const exact = options.filter((option) => key(option) === want);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const overlapping = options.filter((option) => {
    const label = key(option);
    return label.includes(want) || want.includes(label);
  });
  if (overlapping.length === 1) return overlapping[0]!;

  // Last resort, for an answer source that transcribed the option
  // slightly wrong: "Your favourite picture or videos" against the page's
  // "Your favourite pictures or videos" — one character, and the draw ran
  // on eight sibling sites. Scored with the same overlap measure and the
  // same thresholds used to read an answer out of the page's copy, so a
  // near-miss is taken only when one option is clearly the intended one
  // and the rest are nowhere near. An answer belonging to some other
  // question entirely ("Winchester" against Seen / Scene / Scenic, seen
  // live) scores zero on every option and is still refused.
  const scored = options
    .map((option) => ({ option, score: copyOverlap(option, answer) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const runnerUp = scored[1];
  if (!top) return null;
  const margin = runnerUp ? top.score - runnerUp.score : 1;
  return top.score >= OVERLAP_FLOOR && margin >= OVERLAP_MARGIN ? top.option : null;
}

/** Answers the site has already told us are wrong for this competition, from earlier entry records. */
export function rejectedAnswers(previousOutcomes: { message: string | null }[]): Set<string> {
  const rejected = new Set<string>();
  for (const outcome of previousOutcomes) {
    const match = /^Answer "(.+)" was rejected as incorrect/.exec(outcome.message ?? "");
    if (match?.[1]) rejected.add(match[1].trim().toLowerCase());
  }
  return rejected;
}

function derivedPassword(email: string): string {
  // Deliberately NOT salted per-domain: each DMRI site has its own
  // separate account database anyway (confirmed directly — a login on one
  // domain doesn't work on another), so reusing the same derived password
  // across sites doesn't create any cross-site collision risk, and
  // changing this formula would silently break the login for the
  // already-registered live Marie Claire account.
  const hash = createHash("sha256").update(`marie-claire-comps:${email}`).digest("hex");
  return `Mc${hash.slice(0, 10)}9`;
}

// Registration's #loginOptIns container bundles the required T&Cs checkbox
// together with marketing opt-ins (confirmed directly). Ticking every
// checkbox in it — as this used to do — ticks the marketing ones too,
// which README's "No auto-consent" rule doesn't allow. Only tick a
// checkbox whose own label reads as genuine required terms (not
// marketing/offers/partner language); anything ambiguous is left unticked
// rather than guessed, even if that risks leaving an optional box unticked
// that turns out to have been required — the safer failure mode here is
// "adapter fails loudly at the T&Cs check below", not "ticked a marketing
// box".
async function tickRequiredTermsOnly(frameOrPage: { evaluate: Function }, selector: string) {
  await frameOrPage.evaluate((sel: string) => {
    document.querySelectorAll<HTMLInputElement>(sel).forEach((el) => {
      const label = (
        el.closest("label")?.textContent ||
        document.querySelector(`label[for="${el.id}"]`)?.textContent ||
        ""
      ).toLowerCase();
      const isMarketing = /market|offer|partner|newsletter|third.?part|promot/.test(label);
      const isTerms = el.required || /terms|conditions|privacy policy|\bagree\b/.test(label);
      if (isTerms && !isMarketing) {
        el.checked = true;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
  }, selector);
}

// This page is heavily ad-laden (dozens of ad-network calls observed live)
// and can take noticeably longer than a short wait to settle into whatever
// comes next after a submit — confirmed directly: a fixed 2.5s wait left
// the offer-loop's very first check seeing nothing yet, skipping it
// entirely, even though the exact same offer was fully rendered moments
// later with a longer wait. A race between several "has it settled yet"
// checks was tried and made things worse, not better — confirmed directly:
// one of them (most likely "Confirm Entry") can apparently resolve on some
// transient/flickering render before the real next state has actually
// settled, so the race returns too early nearly every time. A plain
// generous fixed wait is what's actually reliable here.
async function waitForNextStep(page: { waitForTimeout: (ms: number) => Promise<void> }) {
  await page.waitForTimeout(6000);
}

// Declines whatever marketing consent controls are currently on the page —
// both the entry form's own always-present, non-rotating
// `CompetitionEntryForm[optin]` field (confirmed directly: same name every
// time, organiser's own "would you like to hear about future offers"
// consent) and any number of rotating third-party `QB[...]` partner-offer
// groups (confirmed directly: these can appear on the initial quiz page
// itself, not only after a first submit). Per README's "No auto-consent"
// rule, every one is declined regardless of how many appear at once — not
// just the multi-group HealthWindow-style underwriting cases.
async function answerOffersAndOptin(page: { evaluate: Function }) {
  await page.evaluate(() => {
    // "optInYes" implies a same-name radio pair — a standalone
    // "optInNo" sibling is the standard counterpart, but fall back to
    // scanning the same radio group by label text in case the site's own
    // id doesn't follow that convention. Either way, never touch
    // optInYes itself.
    const optIn = document.getElementById("optInYes") as HTMLInputElement | null;
    if (!optIn) return;
    let decline = document.getElementById("optInNo") as HTMLInputElement | null;
    if (!decline) {
      decline =
        Array.from(document.querySelectorAll<HTMLInputElement>(`input[name="${optIn.name}"]`)).find((r) => {
          const label = (
            r.closest("label")?.textContent ||
            document.querySelector(`label[for="${r.id}"]`)?.textContent ||
            r.value ||
            ""
          ).toLowerCase();
          return /\bno\b/.test(label);
        }) ?? null;
    }
    if (decline) {
      decline.checked = true;
      decline.dispatchEvent(new Event("change", { bubbles: true }));
    }
  });

  const groupNames: string[] = await page.evaluate(() => {
    const names = new Set<string>();
    document.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((el) => {
      if (el.name.startsWith("QB[")) names.add(el.name);
    });
    return Array.from(names);
  });
  if (groupNames.length === 0) return groupNames.length;

  await page.evaluate((groupNames: string[]) => {
    for (const name of groupNames) {
      const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="radio"]')).filter(
        (r) => r.name === name,
      );
      const target = radios.find((r) => {
        const label = (
          r.closest("label")?.textContent ||
          document.querySelector(`label[for="${r.id}"]`)?.textContent ||
          r.value ||
          ""
        ).toLowerCase();
        return /\bno\b/.test(label);
      });
      if (target) {
        target.checked = true;
        target.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }, groupNames);
  return groupNames.length;
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const LOG_OUT_TEXT = /log\s*out/i;

/**
 * Most DMRI sibling sites run the Sourcepoint consent CMP — but not all
 * of them do, and the ones that don't are handled by
 * dismissQuantcastConsent / dismissConsentManagerConsent below. Of the
 * Sourcepoint ones, confirmed directly: not all serve its iframe from
 * privacy-mgmt.com — topsante.co.uk (and, going by the same pattern,
 * presumably other siblings) proxies it from its own `consent.<site>`
 * subdomain instead (e.g. `consent.topsante.co.uk/index.html`, no
 * privacy-mgmt.com anywhere in it). Matching on the `consentUUID` query
 * param Sourcepoint's own loader URL always carries, rather than one
 * specific hosting domain, catches both.
 *
 * Confirmed directly, on marieclaire.co.uk: this modal doesn't only
 * appear once on initial page load — a second instance (a different
 * `message_id`, so not simply the same one lingering) can render again
 * later, specifically inside the login popup, and sits on top of its
 * "Log In Now" button indefinitely, timing out every click on it. That's
 * why this is called again right before that click (and registration's
 * equivalent "Next" click) rather than only once up front.
 *
 * Confirmed directly, on madeformums.com (and reproduced the same way on
 * trustedreviews/recombu/pickmypostcode/olivemagazine): the button's own
 * rendered text is "AGREE", all caps — the case-sensitive match below was
 * silently never finding it, leaving the modal up forever and timing out
 * every click behind it (this is what every "Log In Now" click-timeout
 * failure on those sites actually was). Matching case-insensitively is
 * confirmed live to dismiss it correctly.
 */
async function dismissSourcepointConsent(page: import("playwright").Page, log: AdapterContext["log"]) {
  const spFrame = page.frames().find((f) => /privacy-mgmt\.com|[?&]consentUUID=/.test(f.url()));
  if (!spFrame) return;
  // "Agree"/"AGREE" (marieclaire.co.uk, madeformums.com, ...) and "Accept
  // All" (topsante.co.uk) are both this same CMP's top-level accept
  // action — neither site offers a one-click reject at this level, only
  // an "Options" drill-down.
  const agree = spFrame.getByRole("button", { name: /^(Agree|Accept All)$/i }).first();
  const clicked = await agree
    .click({ timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (clicked) await log.info("Dismissed consent modal (Agree/Accept All — no one-click reject-all offered)");
}

/**
 * Not every DMRI sibling runs Sourcepoint. Measured over seven days, 104
 * of the 189 "Log In Now" click-timeouts came from three siblings —
 * comps.recombu.com, comps.trustedreviews.com and comps.pickmypostcode.com
 * — whose intercepting overlay is Quantcast Choice, and another 23 from
 * competitions.houseofcoco.net, whose is consentmanager.net. Neither is a
 * Sourcepoint frame, so dismissSourcepointConsent returned without doing
 * anything and every retry below met the same overlay: the entry was lost
 * on a site we hold a working account for and would otherwise have
 * entered. Each is handled here in its own right.
 *
 * Quantcast renders into the main document (`#qc-cmp2-ui` inside
 * `#qc-cmp2-container`), not an iframe — which is exactly why the
 * frame-based lookup above never saw it.
 */
async function dismissQuantcastConsent(page: import("playwright").Page, log: AdapterContext["log"]) {
  const dialog = page.locator("#qc-cmp2-ui");
  if (!(await dialog.isVisible().catch(() => false))) return;
  // Unlike Sourcepoint, Quantcast's summary screen often does carry a
  // one-click refusal ("DISAGREE"), so prefer it — clicking Agree is the
  // fallback for the configurations that offer only "MORE OPTIONS"
  // alongside it, the same choice dismissSourcepointConsent already makes.
  const rejected = await clickFirst(dialog, /^(Disagree|Reject All|Do Not Consent)$/i);
  if (rejected) {
    await log.info("Dismissed consent modal (Disagree)");
    return;
  }
  if (await clickFirst(dialog, /^(Agree|Accept All)$/i)) {
    await log.info("Dismissed consent modal (Agree/Accept All — no one-click reject-all offered)");
  }
}

/**
 * consentmanager.net, which renders its box inside `#cmpwrapper` — often
 * behind an open shadow root, which Playwright's CSS engine pierces.
 * Observed live on houseofcoco: the wrapper can stay in the document,
 * still intercepting pointer events, after its box has gone, so the
 * removal in clickThroughConsent matters here as much as this click does.
 */
async function dismissConsentManagerConsent(page: import("playwright").Page, log: AdapterContext["log"]) {
  const wrapper = page.locator("#cmpwrapper");
  if ((await wrapper.count()) === 0) return;
  // This CMP does offer a one-click refusal of its own (`.cmpboxbtnno`).
  const reject = wrapper.locator(".cmpboxbtnno").first();
  if (await reject.click({ timeout: 3000 }).then(() => true).catch(() => false)) {
    await log.info("Dismissed consent modal (Reject all)");
    return;
  }
  const accept = wrapper.locator(".cmpboxbtnyes").first();
  if (await accept.click({ timeout: 3000 }).then(() => true).catch(() => false)) {
    await log.info("Dismissed consent modal (Accept all — no one-click reject-all offered)");
  }
}

/** Clicks the first button under `root` whose accessible name matches, reporting whether it did. */
function clickFirst(root: import("playwright").Locator, name: RegExp): Promise<boolean> {
  return root
    .getByRole("button", { name })
    .first()
    .click({ timeout: 3000 })
    .then(() => true)
    .catch(() => false);
}

/**
 * Every consent overlay known to sit on top of this platform's own
 * buttons. Called wherever one of those buttons is clicked, because which
 * CMP a given sibling site runs isn't knowable from the URL.
 */
async function dismissConsent(page: import("playwright").Page, log: AdapterContext["log"]) {
  await dismissSourcepointConsent(page, log);
  await dismissQuantcastConsent(page, log);
  await dismissConsentManagerConsent(page, log);
}

/**
 * Confirmed directly, on marieclaire.co.uk: the consent modal can
 * re-render more than the twice already anticipated above — the exact
 * same click, re-attempted moments later with no other change, can meet a
 * freshly re-rendered instance of it and time out again. A single
 * dismiss-then-click is a race, not a fix. This retries the click once,
 * dismissing the modal again in between, before giving up for real —
 * same "remove the overlay and retry" shape generic.ts already uses for
 * its own submit click.
 */
async function clickThroughConsent(
  locator: import("playwright").Locator,
  page: import("playwright").Page,
  log: AdapterContext["log"],
): Promise<void> {
  // Three attempts, not two: the modal re-rendering once was already
  // known, and a single dismiss-then-retry still left this the largest
  // single cause of DMRI failures (87 of 835 attempts over three days,
  // all of them "waiting for getByText('Log In Now')" timing out on a
  // button that had resolved). Each retry is only paid on a page that
  // would otherwise have failed outright.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await locator.click({ timeout: 8000 });
      return;
    } catch (err) {
      if (attempt === 3) throw err;
      await dismissConsent(page, log);
      // The CMP can leave its own container in the DOM, still intercepting
      // pointer events, after its Agree button has gone — remove what's
      // left rather than dismiss-and-hope a third time. Same shape as
      // generic.ts's overlay removal before its submit retry.
      await page
        .evaluate(() => {
          document
            .querySelectorAll(
              "[id^='sp_message_container'], .sp-message-open, #qc-cmp2-container, .qc-cmp-cleanslate, #cmpwrapper",
            )
            .forEach((el) => el.remove());
          document.documentElement.style.overflow = "";
          document.body.style.overflow = "";
        })
        .catch(() => {});
      await page.waitForTimeout(500);
    }
  }
}

export const dmriCompsAdapter: CompetitionAdapter = {
  key: "dmri-comps",
  siteName: "DMRI Reader Competitions (Future PLC)",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun, previousOutcomes, peerOutcomes, knownAnswer }: AdapterContext): Promise<EntryOutcome> {
    // A hand-researched answer always wins. Where there isn't one — which
    // is every competition the discovery pass finds on its own — the
    // answer is derived from the competition page's own copy further down,
    // once the quiz is actually rendered (it only appears after login).
    const researchedAnswer = TRIVIA_ANSWERS[competitionUrl];
    const origin = new URL(competitionUrl).origin;

    await page.setExtraHTTPHeaders({ "User-Agent": USER_AGENT });
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1500);

    await dismissConsent(page, log);
    await page.waitForTimeout(500);

    const password = derivedPassword(profile.email);

    const loginLink = page.getByText("Log In Now", { exact: true });
    if ((await loginLink.count()) === 0) {
      await log.warn("Expected 'Log In Now' prompt not found — page may have changed");
      return { status: "FAILED", message: "Login prompt not found on page" };
    }
    await clickThroughConsent(loginLink, page, log);
    await page.waitForTimeout(1500);
    const loginFrame = page.frames().find((f) => f.url().includes("existingMember"));
    if (!loginFrame) {
      await log.warn("Expected login iframe (existingMember) not found");
      return { status: "FAILED", message: "Login form not found on page" };
    }
    await loginFrame.locator("#Login_email").fill(profile.email);
    await loginFrame.locator("#Login_password").fill(password);
    // Clicking #action-login triggers a real navigation of its own — waiting
    // for it (rather than checking in place, or racing it with a manual
    // reload) is what's reliable; confirmed directly, both alternatives
    // produced false negatives.
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 15000 }).catch(() => {}),
      clickThroughConsent(loginFrame.locator("#action-login"), page, log),
    ]);
    await page.waitForTimeout(1000);
    const loggedIn = await page.getByText(LOG_OUT_TEXT).first().isVisible().catch(() => false);

    if (!loggedIn) {
      await log.info("Login didn't succeed (no account yet) — registering a new DMRI competitions account");
      // On some DMRI sites (confirmed directly on Woman Magazine, not seen
      // on Marie Claire) a failed login leaves its own #loginModal open,
      // showing "Your password or username is incorrect" — its backdrop
      // intercepts clicks on the page's own nav "Create Free Account" link
      // behind it. Its own "Create one for Free!" alternative lives inside
      // that modal's iframe, out of reach of a plain page-level getByText,
      // so the modal is closed via its dedicated #loginModalExit icon
      // instead (confirmed directly by inspecting the modal's real DOM).
      await page
        .locator("#loginModalExit")
        .click({ timeout: 3000 })
        .catch(() => {});
      await page.waitForTimeout(500);
      const createLink = page.getByText("Create Free Account", { exact: true });
      if ((await createLink.count()) === 0) {
        await log.warn("Expected 'Create Free Account' link not found — page may have changed");
        return { status: "FAILED", message: "Registration entry point not found on page" };
      }
      await createLink.first().click();
      await page.waitForTimeout(2000);

      const step1 = page.frames().find((f) => f.url().includes("login/step1"));
      if (!step1) return { status: "FAILED", message: "Registration step 1 (password) did not load" };
      await step1.locator("#Register_email").fill(profile.email);
      await step1.locator("#Register_password").fill(password);
      await tickRequiredTermsOnly(step1, "#loginOptIns input[type=checkbox]");
      await log.info("Filled email/password and ticked required T&Cs only (marketing opt-ins left unticked)");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "load", timeout: 15000 }).catch(() => {}),
        clickThroughConsent(step1.locator("#loginNextButton"), page, log),
      ]);
      await page.waitForTimeout(1000);
    } else {
      await log.info("Logged in with existing account");
    }

    // The account may still be missing address/name/DOB — either a brand
    // new signup (which only just did step 1 above) or an account that was
    // implicitly created by a bare login attempt on some earlier run.
    // /account is the stable, reliable place to check and fill these (see
    // the file-level comment for why the in-page wizard isn't used).
    await page.goto(`${origin}/account`, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1000);
    const firstNameField = page.locator("#AccountFormUpdate_firstname");
    // Confirmed directly (Woman Magazine, not Marie Claire): name/phone/DOB
    // can already be prefilled here even for a brand-new account — Future
    // PLC apparently shares that profile data across its DMRI sites even
    // though login/authentication itself is separate per domain (confirmed
    // separately, the same login credentials don't work cross-domain). The
    // address specifically is NOT shared, and on some sites (again, seen on
    // Woman Magazine but not Marie Claire) its input is hidden behind a
    // "Change Address?" toggle rather than always visible. So completeness
    // is judged by the address field, not the name field.
    const changeAddressLink = page.getByText("Change Address?", { exact: true });
    if (await changeAddressLink.isVisible({ timeout: 2000 }).catch(() => false)) {
      await changeAddressLink.click();
      await page.waitForTimeout(500);
    }
    const address1Field = page.locator("#paf_address1");
    const currentAddress1 = await address1Field.inputValue().catch(() => "");
    if (!currentAddress1) {
      if (!profile.addressLine1 || !profile.city || !profile.postalCode) {
        await log.warn("Profile is missing address/city/postcode — required by this form");
        return { status: "FAILED", message: "Profile missing required address fields" };
      }
      const currentFirstName = await firstNameField.inputValue().catch(() => "");
      if (!currentFirstName) {
        if (!profile.dateOfBirth) {
          await log.warn("Profile is missing a date of birth — required by this form");
          return { status: "FAILED", message: "Profile missing date of birth" };
        }
        if (profile.title) {
          await page
            .locator("#AccountFormUpdate_title")
            .selectOption({ label: profile.title.replace(/\.$/, "") })
            .catch(() => {});
        }
        await firstNameField.fill(profile.firstName);
        await page.locator("#AccountFormUpdate_surname").fill(profile.lastName);
        if (profile.phone) await page.locator("#AccountFormUpdate_telephone").fill(profile.phone);
        const dob = new Date(profile.dateOfBirth);
        await page.locator("#dobDay").fill(String(dob.getUTCDate()));
        await page.locator("#dobMonth").fill(String(dob.getUTCMonth() + 1));
        await page.locator("#dobYear").fill(String(dob.getUTCFullYear()));
      }
      await address1Field.fill(profile.addressLine1);
      if (profile.addressLine2) await page.locator("#paf_address2").fill(profile.addressLine2);
      await page.locator("#paf_city").fill(profile.city);
      if (profile.region) await page.locator("#paf_region").fill(profile.region);
      await page.locator("#paf_postcode").fill(profile.postalCode);
      await log.info("Filled account details (address, plus name/phone/DOB where not already prefilled)");

      if (dryRun) {
        await log.info("Dry run — account details filled but not submitted");
        return { status: "SUCCESS", message: "Dry run: would have completed profile and entered" };
      }
      await clickThroughConsent(page.locator("#register-button"), page, log);
      await page.waitForTimeout(2000);
      const updateConfirmed = await page
        .getByText(/successfully updated your account/i)
        .first()
        .isVisible()
        .catch(() => false);
      if (!updateConfirmed) {
        await log.warn("Account details update did not show its usual confirmation — may not have saved");
        return { status: "FAILED", message: "Could not confirm account details were saved" };
      }
      await log.info("Account details saved");
    } else if (dryRun) {
      await log.info("Dry run — account already complete, not entering");
      return { status: "SUCCESS", message: "Dry run: would have entered" };
    }

    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1500);

    const alreadyDoneToday = await page
      .getByText(/already entered|come back tomorrow|entered today|entered this competition before/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (alreadyDoneToday) {
      await log.info("Already entered this competition's daily draw today");
      return { status: "SKIPPED_ALREADY_ENTERED", message: "Already entered today's draw" };
    }

    // Read unconditionally, not only when an answer has to be derived: the
    // option set is this question's identity across sibling sites, and a
    // researched answer that goes on to be confirmed is exactly the answer
    // most worth handing to the other ten sites running the same draw.
    const { options, copy, question } = await readQuiz(page);

    const shared = sharedAnswerFor(options, peerOutcomes);
    const rejected = rejectedAnswers(previousOutcomes);
    for (const wrong of shared.rejected) rejected.add(wrong);
    if (rejected.size > 0) {
      await log.info(
        `Excluding ${rejected.size} option(s) already marked wrong here or on a sibling site: ${[...rejected].join(", ")}`,
      );
    }

    const established = chooseEstablishedAnswer(
      { researched: researchedAnswer, published: knownAnswer, confirmedBySibling: shared.confirmed },
      rejected,
    );
    let answer: string | undefined;
    if (established) {
      // Resolved against the options actually on the page, not used raw —
      // see resolveToOption. Falls through to deriving from the copy if it
      // doesn't correspond to anything on offer, which is a better outcome
      // than failing the entry on an answer that may simply be spelled
      // differently.
      const resolved = options.length > 0 ? resolveToOption(established.answer, options) : established.answer;
      if (resolved) {
        answer = resolved;
        await log.info(`Using answer "${resolved}" — ${established.how}`);
      } else {
        await log.warn(
          `An answer was established for this competition ("${established.answer}", ${established.how}) but it doesn't ` +
            `match any option on offer (${options.join(" / ")}) — deriving from the page's own copy instead`,
        );
      }
    }

    if (!answer) {
      if (options.length === 0) {
        await log.warn("No quiz options found on the entry form — page structure may have changed");
        return { status: "FAILED", message: "Quiz options not found on the entry form" };
      }
      const derived = deriveAnswerFromCopy(options, copy, rejected);
      if (derived.answer === null) {
        await log.warn(
          `No researched answer for this competition and could not derive one — ${derived.reason}. ` +
            `Question: ${question || "(not found on the page)"} — options offered: ${options.join(" / ")}`,
        );
        // The question goes in the Entry message, not only the run log:
        // LogLine rows are pruned, Entry rows are kept forever, and this
        // is the record someone researching a TRIVIA_ANSWERS entry for
        // this competition actually needs.
        return {
          status: "SKIPPED_RULES",
          message:
            `No verified answer available (${derived.reason})` +
            `${question ? `; question was: ${question}` : ""}` +
            `; options were: ${options.join(" / ")}`,
        };
      }
      answer = derived.answer;
      await log.info(
        `Derived quiz answer "${answer}" from the competition's own copy — ${derived.how} (options: ${options.join(" / ")})`,
      );
    }

    // Escaped: option labels really do contain regex metacharacters —
    // "(RRP £50)", "2 – 5 December 2026 (Fri–Mon)" — and an unescaped one
    // either throws or silently matches the wrong label.
    const answerLabel = page.locator("label").filter({ hasText: new RegExp(`^${escapeForRegex(answer)}$`) }).first();
    if ((await answerLabel.count()) === 0) {
      await log.warn(`Expected answer option "${answer}" not found among the quiz choices — page may have changed`);
      return { status: "FAILED", message: "Expected quiz answer option not found" };
    }
    const answerFor = await answerLabel.getAttribute("for");
    if (!answerFor) return { status: "FAILED", message: "Could not resolve quiz answer input" };
    await page.evaluate((id: string) => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (input) {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, answerFor);
    await log.info(`Selected quiz answer: ${answer}`);

    // The entry form itself can carry its own always-present "would you
    // like to hear about future offers" opt-in (`CompetitionEntryForm
    // [optin]`) and/or an inline rotating `QB[...]` partner offer, both
    // answered here before the first submit — see answerOffersAndOptin's
    // own comment for why and how.
    await answerOffersAndOptin(page);

    // Not `#submit-comp-button` — that id collides with an unrelated
    // "Continue" button elsewhere on a fully-completed-profile version of
    // this page (confirmed directly: two elements share the id, a strict
    // Playwright locator throws). Matched by this button's own value
    // instead, which is unambiguous.
    const enterSelector = 'input[value="Enter Competition!"]';
    if ((await page.locator(enterSelector).count()) === 0) {
      await log.warn("'Enter Competition!' button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }
    await clickThroughConsent(page.locator(enterSelector), page, log);
    await waitForNextStep(page);

    // Submitting can then land on a rotating third-party "more info from
    // <some comping newsletter>" opt-in page zero or more times before the
    // entry is actually confirmed — looped until none remains.
    let offerRounds = 0;
    let groupCount = await answerOffersAndOptin(page);
    while (groupCount > 0 && offerRounds < 5) {
      await clickThroughConsent(page.locator(enterSelector), page, log);
      await waitForNextStep(page);
      offerRounds += 1;
      groupCount = await answerOffersAndOptin(page);
    }
    if (offerRounds > 0) {
      await log.info(`Responded to ${offerRounds} rotating third-party marketing offer(s) required to proceed`);
    }

    const confirmButton = page.getByText("Confirm Entry", { exact: true });
    if ((await confirmButton.count()) > 0) {
      await clickThroughConsent(confirmButton, page, log);
      await page.waitForTimeout(2000);
    }

    const success = page.getByText(/your answer was correct|you have been entered/i);
    const wrongAnswer = page.getByText(/your answer was (incorrect|wrong)/i);
    const waitForOutcome = () =>
      Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        wrongAnswer.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    try {
      await waitForOutcome();
    } catch {
      // Confirmed directly (Woman Magazine): the platform can insert an
      // extra review step that moves the URL to .../confirm/... but
      // re-renders the exact same quiz form with the previous answers
      // still selected, rather than a distinct "Confirm Entry" button —
      // that re-render is what was silently mistaken for "no outcome
      // appeared" before this fix. If the same submit control has
      // reappeared on a /confirm/ URL, this is that review step, not a
      // genuine failure — submit once more before giving up for real.
      const reviewStep = page.url().includes("/confirm/") && (await page.locator(enterSelector).count()) > 0;
      if (reviewStep) {
        await log.info("Landed on a review step that re-renders the quiz form — submitting once more");
        await clickThroughConsent(page.locator(enterSelector), page, log);
        await waitForNextStep(page);
        try {
          await waitForOutcome();
        } catch {
          await log.warn("Neither a success nor a wrong-answer message appeared within 15s after confirming entry (twice)");
          return { status: "FAILED", message: "No confirmation appeared after submitting entry — outcome unclear" };
        }
      } else {
        await log.warn("Neither a success nor a wrong-answer message appeared within 15s after confirming entry");
        return { status: "FAILED", message: "No confirmation appeared after submitting entry — outcome unclear" };
      }
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmed: ${text}`);
      // The answer note is what lets every sibling site running this same
      // question skip straight to a known-correct answer — see
      // sharedAnswerFor. Appended rather than replacing the site's own
      // confirmation text, which is what a human reading /runs wants.
      const note = options.length > 0 ? ` ${answerNote(answer, options)}` : "";
      return {
        status: "SUCCESS",
        message: `${text || "Entered"}${note}`,
        credentials: { username: profile.email, password },
      };
    }

    // The message format matters: rejectedAnswers() parses it back out of
    // this competition's entry history on the next day's draw, so a wrong
    // option is never offered twice.
    await log.warn(
      researchedAnswer
        ? `Quiz answer "${answer}" was marked wrong by the site — the researched answer may be stale`
        : `Derived quiz answer "${answer}" was marked wrong by the site — it won't be tried again for this competition`,
    );
    // Format matters twice over: rejectedAnswers() parses it back out of
    // this competition's own history on the next day's draw, and
    // sharedAnswerFor() reads the options suffix to rule the same answer
    // out on every sibling site running this question.
    return {
      status: "FAILED",
      message:
        `Answer "${answer}" was rejected as incorrect` +
        `${options.length > 0 ? ` (options: ${options.join(" / ")})` : ""}`,
    };
  },
};
