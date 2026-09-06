import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Gleam.io — a third-party giveaway-widget platform used by many unrelated
 * brands/creators (confirmed directly: dozens of completely different
 * giveaways all resolve to gleam.io/<id>/<slug> and share the exact same
 * markup), so one adapter here covers every Gleam-hosted competition this
 * project tracks, the same shared-platform pattern as dmriComps.ts.
 *
 * This is an Angular single-page app: nothing is in the DOM at
 * `domcontentloaded`, and the whole page renders client-side after load.
 *
 * Confirmed directly: with Playwright's default (Headless)Chrome UA
 * string, the page's own JS never renders the entry form at all — 0
 * `<form>` elements even seconds after the `load` event, on every attempt.
 * Setting a realistic desktop Chrome User-Agent HTTP header (confirmed the
 * header alone is what matters — `navigator.userAgent` was left as the
 * headless default and the page still rendered correctly once the header
 * changed) fixes it — the backend itself appears to serve a
 * stripped/non-functional bundle to requests whose UA header names a
 * headless browser. This isn't solving a CAPTCHA or bypassing a challenge
 * page (there is neither here), just not needlessly self-identifying as
 * headless — the same reasoning already applied to comps.marieclaire.co.uk
 * in dmriComps.ts.
 *
 * The base entry method — the one guaranteed on every Gleam campaign,
 * regardless of what other (social follow/share/visit) methods it also
 * offers — is a "contestant" form asking for full name + email (confirmed
 * directly, live: a fresh AirPods giveaway showed "0 Your Entries" and a
 * plain name/email form as its very first, ungated action). This adapter
 * only ever does that one: filling in a campaign's other, often dozen-plus,
 * optional methods (follow on X, visit a page, etc. — worth "bonus
 * entries" per those campaigns' own copy) would mean taking social-account
 * actions on the user's behalf, out of scope the same way it is for the
 * generic adapter.
 *
 * Some campaigns (confirmed directly, same AirPods giveaway) gate that
 * form behind a "Login with Email / Facebook / X / Google / Apple" choice
 * screen first — the plain form only becomes visible in the DOM after
 * clicking "Login with Email". Both the login-choice link and the
 * name/email inputs exist in the DOM on every campaign regardless of
 * whether that gate is active, just hidden (Angular `ng-hide`) when it
 * isn't — so this always looks for a *visible* login-with-email link and
 * clicks it if present, then always locates the *visible* name/email
 * inputs rather than assuming a fixed structural position (there are
 * several near-identical copies of this form in the DOM at once, one per
 * method column — confirmed directly — and only one is ever the visible,
 * active one).
 *
 * Checkboxes that can appear alongside this form are never ticked: "Notify
 * me of other Gleam.io Competitions (optional)", "Send post entry
 * confirmation emails", and "I agree to join the Gleam.io Giveaway List
 * and accept the Terms & Privacy Policy" — that last one bundles the
 * platform's own mailing-list opt-in together with its actual T&Cs, the
 * same "marketing wins, leave it unticked" situation this project already
 * declines elsewhere (see generic.ts's MARKETING_HINTS and dmriComps.ts's
 * optIn handling) rather than guess it apart. None of the three were
 * `required`, so nothing is lost by leaving them all unticked.
 *
 * Success is read from the campaign's own live entry counter
 * (`#current-entries .status`, confirmed directly against the real
 * widget) going up from whatever it read before this attempt, rather than
 * a confirmation message — this UI doesn't show one, it just updates the
 * count in place.
 */
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function currentEntries(page: AdapterContext["page"]): Promise<number | null> {
  const text = await page
    .locator("#current-entries .status")
    .first()
    .innerText({ timeout: 5000 })
    .catch(() => null);
  if (text === null) return null;
  const n = Number(text.trim());
  return Number.isFinite(n) ? n : null;
}

export const gleamAdapter: CompetitionAdapter = {
  key: "gleam",
  siteName: "Gleam.io (giveaway widget platform)",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await page.setExtraHTTPHeaders({ "User-Agent": USER_AGENT });
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 });

    // Confirmed directly: an ended campaign's "Days Left" stat tile reads
    // "Ended" in place of a number, with no entry form anywhere on the
    // page — checked first so an ended campaign gets a clean decline
    // instead of the opaque "form not found" this adapter would otherwise
    // report (this project's `closesAt` for gleam.io rows isn't always
    // known at discovery time, so schedule.ts can't always catch this on
    // its own).
    if (await page.getByText("Ended", { exact: true }).first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await log.info("This campaign has ended");
      return { status: "SKIPPED_RULES", message: "Campaign has ended" };
    }

    const emailLoginLink = page
      .locator('a[ng-click="openAuthentication(provider)"]:visible')
      .filter({ hasText: "Email" })
      .first();
    const emailInput = page.locator('input[name="email"]:visible').first();

    try {
      await Promise.race([
        emailInput.waitFor({ state: "visible", timeout: 15000 }),
        emailLoginLink.waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      // Confirmed directly: a localised campaign (seen in German) shows its
      // own translated "ended" text ("Beendet") rather than the English
      // "Ended" checked for above, which this doesn't try to enumerate
      // every language for — so this generic failure can still mean an
      // ended campaign, just not one caught by that check.
      await log.warn("Entry form never rendered (Gleam is a JS app — this can also mean an ended campaign in a language other than English)");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    if (await emailLoginLink.isVisible().catch(() => false)) {
      await emailLoginLink.click();
      await log.info("Clicked 'Login with Email' to reveal the plain entry form");
    }

    if (!(await emailInput.waitFor({ state: "visible", timeout: 8000 }).then(() => true).catch(() => false))) {
      await log.warn("Email field never became visible — page structure may have changed");
      return { status: "FAILED", message: "Could not confidently match any form fields" };
    }
    await emailInput.fill(profile.email);
    let filledCount = 1;

    // Name is asked for in one of three shapes, all seen live: a single
    // full-name field, separate first/last name fields, or no name field
    // at all (email-only — confirmed directly on one CyberPowerPC
    // giveaway's *first* form pass; a second, later-revealed pass on that
    // same giveaway turned out to require firstname/lastname after all —
    // so all three are checked rather than assumed from one look). Fill
    // whichever is actually present; don't treat name's absence as a
    // problem.
    const fullNameInput = page.locator('input[name="name"]:visible').first();
    const firstNameInput = page.locator('input[name="firstname"]:visible').first();
    const lastNameInput = page.locator('input[name="lastname"]:visible').first();
    if (await fullNameInput.isVisible().catch(() => false)) {
      await fullNameInput.fill(`${profile.firstName} ${profile.lastName}`.trim());
      filledCount += 1;
    } else if (await firstNameInput.isVisible().catch(() => false)) {
      await firstNameInput.fill(profile.firstName);
      filledCount += 1;
      if (await lastNameInput.isVisible().catch(() => false)) {
        await lastNameInput.fill(profile.lastName);
        filledCount += 1;
      }
    }
    await log.info(`Filled ${filledCount} field(s) (marketing/newsletter checkboxes left unticked)`);
    // The name/email inputs are bound with `ng-model-options="{ debounce: 300 }"`
    // — Angular doesn't register the typed value (and so doesn't enable the
    // submit control) until 300ms after the last fill.
    await page.waitForTimeout(500);

    const submitButton = page
      .locator("button:visible")
      .filter({ hasText: /^\s*(Continue|Save)\s*$/ })
      .first();
    if ((await submitButton.count()) === 0) {
      await log.warn("Continue/Save control not found");
      return { status: "FAILED", message: "Submit control not found" };
    }
    if (await submitButton.isDisabled().catch(() => false)) {
      return { status: "SKIPPED_RULES", message: "The form's submit control is still disabled — it wants answers this adapter can't supply" };
    }

    if (dryRun) {
      await log.info("Dry run — filled name and email, not submitting");
      return { status: "SUCCESS", message: "Dry run: would have submitted the entry form" };
    }

    const entriesBefore = await currentEntries(page);
    await submitButton.click();
    await page.waitForTimeout(3000);

    const error = page.locator(".help-inline.error, .alert-danger").filter({ hasText: /.+/ });
    if (await error.first().isVisible().catch(() => false)) {
      const errorText = (await error.first().innerText().catch(() => "")).trim();
      await log.warn(`Form reported an error: ${errorText}`);
      return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
    }

    const entriesAfter = await currentEntries(page);
    if (entriesBefore !== null && entriesAfter !== null && entriesAfter > entriesBefore) {
      await log.info(`Entry count went from ${entriesBefore} to ${entriesAfter}`);
      return { status: "SUCCESS", message: `Entered (entry count ${entriesBefore} -> ${entriesAfter})` };
    }

    // Fall back to whether the form itself is still there — the entry
    // counter not being readable (a campaign that hides it, say) shouldn't
    // by itself count as a failure when the form clearly went away.
    const formGone = !(await emailInput.isVisible().catch(() => false));
    if (formGone) {
      await log.info("Entry form is no longer showing after submit (entry count was not readable)");
      return { status: "SUCCESS", message: "Submitted — form no longer showing, but entry count was not readable" };
    }

    await log.warn("Neither the entry counter nor the form's disappearance confirmed this submission");
    return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
  },
};
