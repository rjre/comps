import { createHash } from "crypto";
import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

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

/** Does `option` appear in the competition's own descriptive copy, as a whole word/phrase? */
export function appearsInCopy(option: string, copy: string): boolean {
  const haystack = normaliseText(copy);
  return answerVariants(option).some((variant) => {
    const pattern = new RegExp(`(^|[^a-z0-9])${escapeForRegex(variant)}([^a-z0-9]|$)`, "i");
    return pattern.test(haystack);
  });
}

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
): { answer: string } | { answer: null; reason: string } {
  const usable = options.filter((option) => !rejected.has(option.trim().toLowerCase()));
  if (usable.length === 0) {
    return { answer: null, reason: "every offered option has already been rejected as incorrect by the site" };
  }
  const matches = usable.filter((option) => appearsInCopy(option, copy));
  if (matches.length === 1) return { answer: matches[0]! };
  if (matches.length === 0) {
    return { answer: null, reason: `none of the options (${usable.join(" / ")}) appear in the competition's own copy` };
  }
  return { answer: null, reason: `the copy is ambiguous — ${matches.join(" and ")} all appear in it` };
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
async function readQuiz(page: { evaluate: Function }): Promise<{ options: string[]; copy: string }> {
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

    const clone = document.body.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll("script, style, noscript, label, nav, header, footer, select")
      .forEach((node) => node.remove());
    const copy = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
    return { options, copy };
  })) as { options: string[]; copy: string };
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

export const dmriCompsAdapter: CompetitionAdapter = {
  key: "dmri-comps",
  siteName: "DMRI Reader Competitions (Future PLC)",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun, previousOutcomes }: AdapterContext): Promise<EntryOutcome> {
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

    const spFrame = page.frames().find((f) => f.url().includes("privacy-mgmt.com"));
    if (spFrame) {
      await spFrame
        .getByRole("button", { name: "Agree", exact: true })
        .click({ timeout: 8000 })
        .catch(() => {});
      await log.info("Dismissed consent modal (Agree — no one-click reject-all offered)");
    }
    await page.waitForTimeout(500);

    const password = derivedPassword(profile.email);

    const loginLink = page.getByText("Log In Now", { exact: true });
    if ((await loginLink.count()) === 0) {
      await log.warn("Expected 'Log In Now' prompt not found — page may have changed");
      return { status: "FAILED", message: "Login prompt not found on page" };
    }
    await loginLink.click();
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
      loginFrame.locator("#action-login").click(),
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
        step1.locator("#loginNextButton").click(),
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
      await page.locator("#register-button").click();
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

    let answer = researchedAnswer;
    if (!answer) {
      const { options, copy } = await readQuiz(page);
      if (options.length === 0) {
        await log.warn("No quiz options found on the entry form — page structure may have changed");
        return { status: "FAILED", message: "Quiz options not found on the entry form" };
      }
      const rejected = rejectedAnswers(previousOutcomes);
      if (rejected.size > 0) {
        await log.info(`Excluding ${rejected.size} option(s) this site already marked wrong: ${[...rejected].join(", ")}`);
      }
      const derived = deriveAnswerFromCopy(options, copy, rejected);
      if (derived.answer === null) {
        await log.warn(
          `No researched answer for this competition and could not derive one — ${derived.reason}. ` +
            `Options offered: ${options.join(" / ")}`,
        );
        return {
          status: "SKIPPED_RULES",
          message: `No verified answer available (${derived.reason}); options were: ${options.join(" / ")}`,
        };
      }
      answer = derived.answer;
      await log.info(`Derived quiz answer "${answer}" from the competition's own copy (options: ${options.join(" / ")})`);
    }

    const answerLabel = page.locator("label").filter({ hasText: new RegExp(`^${answer}$`) }).first();
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
    await page.locator(enterSelector).click();
    await waitForNextStep(page);

    // Submitting can then land on a rotating third-party "more info from
    // <some comping newsletter>" opt-in page zero or more times before the
    // entry is actually confirmed — looped until none remains.
    let offerRounds = 0;
    let groupCount = await answerOffersAndOptin(page);
    while (groupCount > 0 && offerRounds < 5) {
      await page.locator(enterSelector).click();
      await waitForNextStep(page);
      offerRounds += 1;
      groupCount = await answerOffersAndOptin(page);
    }
    if (offerRounds > 0) {
      await log.info(`Responded to ${offerRounds} rotating third-party marketing offer(s) required to proceed`);
    }

    const confirmButton = page.getByText("Confirm Entry", { exact: true });
    if ((await confirmButton.count()) > 0) {
      await confirmButton.click();
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
        await page.locator(enterSelector).click();
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
      return {
        status: "SUCCESS",
        message: text || "Entered",
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
    return { status: "FAILED", message: `Answer "${answer}" was rejected as incorrect` };
  },
};
