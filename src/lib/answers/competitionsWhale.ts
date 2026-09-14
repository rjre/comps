import { fetchHtml } from "@/lib/net/fetchHtml";

/**
 * competitions-whale.co.uk as an answer source for the DMRI platform's
 * trivia questions.
 *
 * This site is already the origin of ten of the hand-written
 * TRIVIA_ANSWERS entries in dmriComps.ts — someone read a competition's
 * "Suggested Answer" off it and pasted it into the map. This does the same
 * thing on a schedule instead of by hand, which is the only way it scales
 * to the ~250 draws open at once.
 *
 * Its role is strictly the one the rest of this project already gives
 * aggregators: a lead and answer source. Entry itself always happens on
 * the organiser's own domain, and nothing here follows a link to enter
 * anything. Its robots.txt is `User-agent: * / Allow: /`, and fetches go
 * through the shared robots + rate-limit wrapper like every other scrape.
 *
 * On trust: these answers are not independently verified, and the existing
 * TRIVIA_ANSWERS comment already flags exactly that. What makes relying on
 * them safe is that the DMRI site itself grades the answer — a wrong one
 * comes back as "Answer X was rejected as incorrect", which is recorded
 * and then excluded from every later attempt on that competition and on
 * every sibling site running the same question. So a bad suggestion costs
 * one day's entry on one draw and then self-corrects, against a certainty
 * of never entering at all if the question goes unanswered.
 */
const ORIGIN = "https://www.competitions-whale.co.uk";

/**
 * Listing pages worth reading. The site publishes no per-competition
 * page — the answer is rendered on the listing card itself — so coverage
 * comes from reading several listings rather than one page per draw.
 * `/website/<host>` is the useful one here: one page per site, which is
 * how a draw that's no longer "new" is still reachable.
 */
export function listingPagesFor(hosts: string[], days: string[]): string[] {
  return [
    `${ORIGIN}/`,
    `${ORIGIN}/closing`,
    `${ORIGIN}/high-value`,
    `${ORIGIN}/most-popular`,
    ...days.map((day) => `${ORIGIN}/new/${day}`),
    ...hosts.map((host) => `${ORIGIN}/website/${host}`),
  ];
}

/** The last `count` days as this site spells them in a /new/ URL, e.g. "13-Sept-26". */
export function recentDayPaths(count: number, from: Date = new Date()): string[] {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "June", "July", "Aug", "Sept", "Oct", "Nov", "Dec"];
  const days: string[] = [];
  for (let back = 1; back <= count; back++) {
    const day = new Date(from.getTime() - back * 86_400_000);
    days.push(
      `${String(day.getDate()).padStart(2, "0")}-${months[day.getMonth()]}-${String(day.getFullYear()).slice(2)}`,
    );
  }
  return days;
}

const NAMED_ENTITIES: Record<string, string> = {
  nbsp: " ", lt: "<", gt: ">", quot: '"', apos: "'",
  ndash: "–", mdash: "—", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”", hellip: "…",
  eacute: "é", egrave: "è", ecirc: "ê", agrave: "à", acirc: "â", ccedil: "ç",
  uuml: "ü", ouml: "ö", auml: "ä", iuml: "ï", ntilde: "ñ", oslash: "ø", aring: "å",
  pound: "£", euro: "€", deg: "°", trade: "™", reg: "®", copy: "©",
};

/**
 * Entities have to come out as real characters: the answer is matched
 * against the option label rendered on the entry page, so an answer left
 * as "Caf&eacute;-quality coffees" simply doesn't match "Café-quality
 * coffees" and the adapter reports the option missing. `&amp;` is decoded
 * last so an escaped entity in the source ("&amp;eacute;") isn't decoded
 * twice into something that was never written.
 */
function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (whole, name: string) => NAMED_ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Links on a card that are never the competition itself. */
const NON_COMPETITION_LINK = /competitions-whale\.co\.uk|cloudinary\.com|google|doubleclick|facebook|twitter|x\.com|instagram/i;

/**
 * Every (competition URL -> suggested answer) pair on one listing page.
 *
 * Cards are delimited by their own `id="comp-card-<n>"`, and each carries
 * exactly one outbound link — the competition — plus, when the site has
 * one, a `Suggested Answer:` line. Split on the card boundary rather than
 * matching across the whole document, so an answer can never be paired
 * with a neighbouring card's URL.
 *
 * Pure, so the parse is testable against saved markup without a network.
 */
export function parseAnswers(pageHtml: string): Map<string, string> {
  const found = new Map<string, string>();
  const cards = pageHtml.split(/id="comp-card-/).slice(1);
  for (const card of cards) {
    const answer = /Suggested Answer:\s*<\/span>\s*([^<]+)/i.exec(card);
    if (!answer) continue;
    const text = decodeEntities(answer[1]!);
    if (!text) continue;
    const links = [...card.matchAll(/href="(https?:\/\/[^"]+)"/g)]
      .map((m) => m[1]!)
      .filter((href) => !NON_COMPETITION_LINK.test(href));
    const url = links[0];
    if (!url) continue;
    found.set(decodeEntities(url), text);
  }
  return found;
}

/** Reads every listing page and merges what they publish. Pages that fail are skipped, not fatal. */
export async function harvestAnswers(
  pages: string[],
  log: (message: string) => Promise<void> | void,
): Promise<Map<string, string>> {
  const answers = new Map<string, string>();
  let read = 0;
  for (const page of pages) {
    const html = await fetchHtml(page);
    if (!html) continue;
    read += 1;
    for (const [url, answer] of parseAnswers(html)) {
      if (!answers.has(url)) answers.set(url, answer);
    }
  }
  await log(`Read ${read}/${pages.length} listing page(s), ${answers.size} published answer(s) found.`);
  return answers;
}
