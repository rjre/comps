import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Devon's Top Attractions — "Win A Devon Holiday, Free Days Out & other
 * Prizes 2026" (devonstopattractions.co.uk), run directly by the
 * Association of Devon Attractions, a genuine regional tourism consortium
 * (same kind of organisation as northNorfolkAttractions.ts), not a
 * multi-brand lead-gen hub. A Gravity Forms form (id 35): name, county,
 * phone, email. Protected by invisible reCAPTCHA v3 — not solved or
 * evaded, just submitted normally. Gravity Forms' legacy theme submits via
 * a hidden iframe rather than a visible page navigation or a same-tab POST,
 * so success/failure is read from the DOM swap the form's own onload
 * handler performs (#gform_wrapper_35 either regains the
 * gform_validation_error class or gets replaced with
 * #gform_confirmation_wrapper_35), not from a network response.
 */
export const devonsTopAttractionsAdapter: CompetitionAdapter = {
  key: "devons-top-attractions",
  siteName: "Devon's Top Attractions",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    // Silktide's old cookieconsent2 widget — a single "Got it!" dismiss
    // button, no separate reject option (just a notice, no granular
    // tracking consent to decline). Can render after our first check, so
    // this is called again right before the checkbox/submit interaction
    // below too.
    const dismissCookieBanner = async (timeout: number) => {
      const dismiss = page.locator(".cc-dismiss");
      if (await dismiss.isVisible({ timeout }).catch(() => false)) {
        await dismiss.click();
        await log.info("Dismissed cookie notice");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("#gform_35");
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (#gform_35) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    await page.locator("#input_35_10_3").fill(profile.firstName);
    await page.locator("#input_35_10_6").fill(profile.lastName);
    await page.locator("#input_35_2").fill(profile.email);
    await log.info("Filled first name, last name, email");

    if (profile.region) {
      await page.locator("#input_35_19_4").fill(profile.region);
      await log.info("Filled county");
    }
    if (profile.phone) {
      await page.locator("#input_35_6").fill(profile.phone);
      await log.info("Filled phone");
    }

    // Left unticked deliberately: choice_35_7_1 ("I am happy to receive
    // further information from Devon's Top Attractions & the prize
    // givers") — a marketing consent box, not required to enter.

    await dismissCookieBanner(3000);

    const submit = page.locator("#gform_submit_button_35");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#gform_submit_button_35) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // Gravity Forms' legacy AJAX-iframe submission replaces the form
    // wrapper's contents in place rather than navigating — wait for either
    // outcome the page's own callback distinguishes between: a
    // confirmation wrapper (success) or the form re-rendered with a
    // validation-error class (rejected).
    const confirmation = page.locator("#gform_confirmation_wrapper_35, .gform_confirmation_message_35");
    const validationError = page.locator("#gform_wrapper_35.gform_validation_error");
    try {
      await Promise.race([
        confirmation.first().waitFor({ state: "visible", timeout: 20000 }),
        validationError.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor a validation error appeared within 20s after submit — reCAPTCHA may have blocked the automated browser");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await confirmation.first().isVisible().catch(() => false)) {
      const text = (await confirmation.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await page.locator("#gform_wrapper_35 .gfield_description.validation_message, #gform_wrapper_35 .validation_message").first().innerText().catch(() => "")).trim();
    await log.warn(`Form validation error: ${errorText || "(no error text found)"}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText || "unknown validation error"}` };
  },
};
