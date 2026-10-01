import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * c2c (Trenitalia c2c Limited) — "Wilko: Love And Death And Rock 'N' Roll"
 * (c2c-online.co.uk), a sibling competition to the already-tracked
 * c2c-blowout-company on the same Gravity Forms platform, but a genuinely
 * separate form (id 285, confirmed directly — different field ids and
 * shape, not a re-skin). No purchase necessary. Prize: a pair of tickets
 * to the play at the Palace Theatre, Southend, plus an overnight stay at
 * the Holiday Inn Southend Airport, for the performance on Mon 12 Oct
 * 2026 (the page states the prize date but never an explicit entry
 * closing date — closesAt is set a couple of days before the prize date
 * as a conservative estimate, not a stated deadline).
 *
 * Name/email plus three independently optional marketing checkboxes
 * (c2c, the venue/Trafalgar Theatres, the accommodation/Holiday Inn) all
 * left unticked, an optional "nearest c2c station" dropdown left at its
 * placeholder (no reliable way to derive the right station from the
 * profile's address fields without guessing), and a required "I agree to
 * the c2c Privacy Policy" checkbox (privacy acknowledgement, not
 * marketing — ticked). Same Cookiebot banner as suffolkCoast.ts and
 * c2cBlowoutCompany.ts. Same visible reCAPTCHA v2 "I'm not a robot"
 * checkbox already root-caused as a hard block on this site's other
 * Gravity Forms competition (c2c-blowout-company) — built up to the
 * final submit per this project's policy for a submit-time CAPTCHA, then
 * fails loudly rather than attempting to solve it.
 */
export const c2cWilkoLoveAndDeathAndRockNRollAdapter: CompetitionAdapter = {
  key: "c2c-wilko-love-and-death-and-rock-n-roll",
  siteName: "c2c",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    const dismissCookieBanner = async (timeout: number) => {
      const cookieDecline = page.locator("#CybotCookiebotDialogBodyButtonDecline");
      if (await cookieDecline.isVisible({ timeout }).catch(() => false)) {
        await cookieDecline.click();
        await log.info("Dismissed cookie banner (declined non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("#gform_285");
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (#gform_285) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    await page.locator("#input_285_1_3").fill(profile.firstName);
    await page.locator("#input_285_1_6").fill(profile.lastName);
    await page.locator("#input_285_2").fill(profile.email);
    await log.info("Filled first name, last name, email");
    // Left at its "Please select a station" placeholder deliberately —
    // #input_285_13, an optional "Your nearest c2c station" dropdown with
    // no corresponding profile field to derive it from reliably.
    // Left unticked deliberately: #input_285_7_1 (Marketing Consent, c2c),
    // #choice_285_15_1 (Marketing Consent, venue/Trafalgar Theatres),
    // #choice_285_17_1 (Marketing Consent, accommodation/Holiday Inn).

    await dismissCookieBanner(3000);

    // Required to enter at all (a privacy-policy acknowledgement, not
    // marketing) — same field role as c2c-blowout-company's #input_283_3_1.
    await page.locator("#input_285_3_1").check();
    await log.info("Ticked required 'I agree to the c2c Privacy Policy' checkbox — left all three Marketing Consent checkboxes unticked");

    const recaptcha = page.frameLocator('iframe[title="reCAPTCHA"]').locator("body");
    if (await recaptcha.isVisible({ timeout: 5000 }).catch(() => false)) {
      await log.warn("This form requires solving a visible reCAPTCHA challenge — not attempting to solve it");
      return { status: "FAILED", message: "Blocked by a visible reCAPTCHA challenge — not solved or evaded" };
    }

    await dismissCookieBanner(3000);

    const submit = page.locator("#gform_submit_button_285");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#gform_submit_button_285) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    const confirmation = page.locator("#gform_confirmation_wrapper_285, .gform_confirmation_message_285");
    const validationError = page.locator("#gform_wrapper_285.gform_validation_error");
    try {
      await Promise.race([
        confirmation.first().waitFor({ state: "visible", timeout: 20000 }),
        validationError.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor a validation error appeared within 20s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await confirmation.first().isVisible().catch(() => false)) {
      const text = (await confirmation.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await page.locator("#gform_wrapper_285 .gfield_description.validation_message, #gform_wrapper_285 .validation_message").first().innerText().catch(() => "")).trim();
    await log.warn(`Form validation error: ${errorText || "(no error text found)"}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText || "unknown validation error"}` };
  },
};
