import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Muddy Stilettos "Reader Treats" — small giveaways exclusive to Muddy
 * Newsletter readers/Instagram followers, featured recurringly in the
 * regional newsletter editions this profile is subscribed to (found via
 * Gmail, not the web-search sweep). Every instance shares one form
 * template (name/email/county + a genuine trivia question with a
 * hyperlinked source + a required T&Cs checkbox, plus sometimes an
 * optional third-party marketing checkbox — ticked when present, more
 * marketing signup surfaces more competition leads, same policy as
 * elsewhere in this project), so one adapter is reused across all of
 * them, same pattern as visit-lake-district-prize-draw.
 *
 * Each Reader Treat's trivia question only has a real answer findable by
 * following the page's own "here" hyperlink to the sponsor's site (never
 * guessed) — recorded per-URL below since the question differs each
 * time. Add a new entry to READER_TREAT_ANSWERS whenever a new Reader
 * Treat is registered as a Competition row using this adapterKey; the
 * adapter fails loudly if a competition's URL isn't in the map rather
 * than guessing.
 *
 * The optional third-party marketing checkbox (`#consent`, present on some
 * but not all Reader Treats) is deliberately left unticked — README's own
 * "No auto-consent" rule ("adapters must not tick marketing/data-sharing
 * consent boxes on your behalf") applies here regardless of any lead-gen
 * upside.
 */
const READER_TREAT_ANSWERS: Record<string, string> = {
  "https://wales.muddystilettos.co.uk/reader-treats/win-diy-dried-flower-wreath-kit-sown-and-wild/":
    "A flower shop", // Sown and Wild's "Our Story" page: founder Chloe "worked alongside my Mum in her flower shop"
  "https://muddystilettos.co.uk/reader-treats/win-a-200-fortnum-mason-hamper-with-steven-eagell-toyota/":
    "Milton Keynes", // Steven Eagell Group's own history: established in Milton Keynes in 2002, its first centre
  "https://muddystilettos.co.uk/reader-treats/agria-blenheim-palace-international-horse-trials-fashion-competition/":
    "4 days", // the competition's own "Need to Know" section: runs 17-20 Sept 2026, and the prize itself is "four-day members' passes"
  "https://essex.muddystilettos.co.uk/reader-treats/win-a-firstsite-mosaic-membership-for-a-family-of-4/":
    "Simon Carter", // independently verified (Great British Life / Gazette): Frinton-based artist Simon Carter's "From the Landscape" opens at Firstsite Oct 2026 — not the two decoy names (Simon Cowell, Simon Pegg) sharing the same first name
};

export const muddyStilettosReaderTreatsAdapter: CompetitionAdapter = {
  key: "muddy-stilettos-reader-treats",
  siteName: "Muddy Stilettos Reader Treats",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    const answer = READER_TREAT_ANSWERS[competitionUrl];
    if (!answer) {
      await log.warn(`No researched trivia answer recorded for ${competitionUrl} — add one to READER_TREAT_ANSWERS before this can run`);
      return { status: "FAILED", message: "No trivia answer recorded for this Reader Treat URL" };
    }

    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    // Quantcast Choice consent modal ("MORE OPTIONS/DISAGREE/AGREE").
    // Confirmed directly: its #qc-cmp2-container can persist/re-render
    // past the initial dismiss and still intercept clicks well into the
    // form — re-checked before the T&Cs checkbox too, with a DOM-removal
    // fallback on the final submit if it's still blocking by then (same
    // pattern already proven on visit-lake-district-prize-draw).
    const dismissConsent = async (timeout: number) => {
      const disagree = page.getByRole("button", { name: "DISAGREE", exact: true });
      if (await disagree.isVisible({ timeout }).catch(() => false)) {
        await disagree.click();
        await log.info("Dismissed cookie/consent banner (disagreed to non-essential processing)");
      }
    };
    await dismissConsent(10000);

    const nameField = page.locator("#name");
    if ((await nameField.count()) === 0) {
      await log.warn("Expected entry form (#name) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    await nameField.fill(profile.firstName ? `${profile.firstName} ${profile.lastName}` : profile.lastName);
    await page.locator("#emailaddress").fill(profile.email);
    if (profile.region) {
      const countySelect = page.locator("#county");
      const options = await countySelect.locator("option").allTextContents();
      const match = options.find((o) => o.trim().toLowerCase() === profile.region!.toLowerCase());
      if (match) {
        await countySelect.selectOption({ label: match });
      } else {
        await log.warn(`Profile region "${profile.region}" isn't one of this form's county options — leaving unselected`);
      }
    }
    await page.locator("#question").selectOption({ label: answer });
    await log.info(`Filled name, email, county, and the researched trivia answer ("${answer}")`);

    // Some (not all) Reader Treats also carry an optional third-party
    // marketing opt-in (confirmed directly: `#consent` on the Blenheim
    // Palace one, absent on the Toyota/wreath-kit ones) — deliberately left
    // unticked, per README's "No auto-consent" rule.

    await dismissConsent(3000);

    const tandcs = page.locator("#tandcs");
    if ((await tandcs.count()) === 0) {
      await log.warn("Required T&Cs checkbox (#tandcs) not found");
      return { status: "FAILED", message: "T&Cs checkbox not found" };
    }
    // Confirmed directly: this checkbox is a React-controlled component.
    // Neither a plain .check() click nor setting .checked + dispatching
    // input/change directly moves it — React tracks the native input's
    // last-known value internally and ignores a plain property
    // assignment, so it never re-renders (the submit button stayed
    // disabled both times). The standard workaround: call the native
    // HTMLInputElement checked setter via its prototype (bypassing
    // React's patched setter/tracker) before dispatching the event, so
    // React's own change detection actually sees a real change.
    await tandcs.evaluate((el: HTMLInputElement) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "checked")!.set!;
      nativeSetter.call(el, true);
      el.dispatchEvent(new Event("click", { bubbles: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const isChecked = await tandcs.isChecked().catch(() => false);
    if (!isChecked) {
      await log.warn("T&Cs checkbox still not checked after direct state set — page may have changed");
      return { status: "FAILED", message: "Could not tick the required T&Cs checkbox" };
    }

    const submit = page.getByRole("button", { name: /enter the reader treat/i });
    if ((await submit.count()) === 0) {
      await log.warn("Submit button ('Enter the Reader Treat') not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    try {
      await submit.click({ timeout: 8000 });
    } catch {
      await log.warn("Submit click was blocked by a re-rendered consent modal — removing it and retrying");
      await page.evaluate(() => document.querySelector("#qc-cmp2-container")?.remove());
      await submit.click();
    }

    // Confirmed directly across many separate live attempts, over two
    // sessions, with escalating diagnostics (network request/response
    // capture, DOM state polling, forced clicks, genuinely trusted
    // Playwright clicks vs. synthetic dispatched events): the submit
    // button reliably becomes enabled once the T&Cs checkbox state
    // actually changes, and clicking it (falling back to removing a
    // re-rendered consent overlay first, above) reports success with no
    // thrown error — but literally zero network requests are ever
    // observed firing as a result, checkbox state and all. This isn't a
    // timing or overlay issue this project's usual fixes address; it
    // looks like a targeted anti-automation defense specific to this
    // page (the sibling wreath-kit Reader Treat, same code path, did
    // eventually succeed through repeated scheduled retries — so this
    // is left on the same retry cadence rather than marked permanently
    // blocked, in case it's similarly just very unreliable rather than
    // deterministically hostile). Not solved or evaded either way; this
    // correctly reports FAILED below rather than guessing success.
    const success = page.getByText(/thank you|you're entered|good luck|entry received|successfully entered|entered the reader treat/i);
    // "already entered" is its own case, not a form error: it means a past
    // run's real submission actually succeeded even though that run itself
    // failed to detect it (confirmed happening in practice — see
    // runOnce.ts's handling of SKIPPED_ALREADY_ENTERED for a maxEntries=1
    // competition), so it must not be reported as FAILED or the runner
    // keeps re-submitting this same real form indefinitely.
    const alreadyEntered = page.getByText(/already entered/i);
    const error = page.getByText(/invalid|error|something went wrong|please enter|incorrect/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        alreadyEntered.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 15s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    if (await alreadyEntered.first().isVisible().catch(() => false)) {
      const text = (await alreadyEntered.first().innerText().catch(() => "")).trim();
      await log.info(`Site reports this was already entered: ${text}`);
      return { status: "SKIPPED_ALREADY_ENTERED", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
