import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * c2c (Trenitalia c2c Limited) — "The Blowout Company: Win a stylish
 * makeover" (c2c-online.co.uk), run directly by c2c, the train operator
 * serving the Essex Thameside route between London Fenchurch Street and
 * Southend/Shoeburyness. A minimal Gravity Forms form (id 283): first
 * name, last name, email — no marketing checkbox on the form itself.
 * Closes 09 September 2026, 11:59am. No purchase necessary — entry is via
 * this form alone; an existing c2c account only doubles the entry, it
 * isn't required. Same legacy Gravity Forms AJAX-iframe submission
 * mechanics as devonsTopAttractions.ts (same plugin, different site) —
 * outcome is read from the DOM swap, not a network response. Also
 * Cookiebot-fronted, same selector as suffolkCoast.ts.
 */
export const c2cBlowoutCompanyAdapter: CompetitionAdapter = {
  key: "c2c-blowout-company",
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

    const form = page.locator("#gform_283");
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (#gform_283) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    await page.locator("#input_283_1_3").fill(profile.firstName);
    await page.locator("#input_283_1_6").fill(profile.lastName);
    await page.locator("#input_283_2").fill(profile.email);
    await log.info("Filled first name, last name, email");

    // Required to enter at all (confirmed directly — submitting without it
    // shows "This field is required.") — agreeing to the privacy policy
    // and the possibility of appearing on c2c's social media if selected
    // as winner, not a marketing consent. #input_283_7_1 ("Marketing
    // Consent (c2c)") is the actual optional marketing checkbox and stays
    // deliberately unticked.
    await page.locator("#input_283_3_1").check();
    await log.info("Ticked required 'I agree to the c2c Privacy Policy' checkbox — left the separate Marketing Consent checkbox unticked");

    // This form has a visible reCAPTCHA v2 "I'm not a robot" challenge, not
    // just invisible scoring — confirmed directly via screenshot (a
    // previous attempt showed "The reCAPTCHA was invalid. Go back and try
    // it again."). We don't attempt to solve it — check for its presence
    // up front and fail loudly rather than submit into a guaranteed
    // rejection each time.
    const recaptcha = page.frameLocator('iframe[title="reCAPTCHA"]').locator("body");
    if (await recaptcha.isVisible({ timeout: 5000 }).catch(() => false)) {
      await log.warn("This form requires solving a visible reCAPTCHA challenge — not attempting to solve it");
      return { status: "FAILED", message: "Blocked by a visible reCAPTCHA challenge — not solved or evaded" };
    }

    await dismissCookieBanner(3000);

    const submit = page.locator("#gform_submit_button_283");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#gform_submit_button_283) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    const confirmation = page.locator("#gform_confirmation_wrapper_283, .gform_confirmation_message_283");
    const validationError = page.locator("#gform_wrapper_283.gform_validation_error");
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

    const errorText = (await page.locator("#gform_wrapper_283 .gfield_description.validation_message, #gform_wrapper_283 .validation_message").first().innerText().catch(() => "")).trim();
    await log.warn(`Form validation error: ${errorText || "(no error text found)"}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText || "unknown validation error"}` };
  },
};
