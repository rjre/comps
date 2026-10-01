import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Kent Attractions — "Win a Kent Attractions Pass" (kentattractions.co.uk/competitions/),
 * run directly by the Kent Attractions consortium (a regional tourism group,
 * same kind of organisation as northNorfolkAttractions.ts / devonsTopAttractions.ts).
 * A Gravity Forms form (id 1): name, email, a required multi-select trivia
 * question, and a two-checkbox "preferences & permissions" group where only
 * the T&Cs box is required — the newsletter box is independently optional
 * and left unticked.
 *
 * No fixed closing date on this page — it states "a winner will be chosen
 * every month", so this is a rolling monthly draw rather than a one-shot
 * competition.
 *
 * Trivia question ("...how many years of jousting?" re: Hever Castle's 2026
 * jousting season) offers 20/60/10/40/30 — answer confirmed directly against
 * Hever Castle's own news pages, which describe 2026 as the jousting
 * tournament's 40th anniversary season (running since 1986).
 *
 * This project's off-limits research notes previously excluded a "Kent
 * Attractions consortium" site as bot-protected on page load — re-checked
 * directly here and that no longer reproduces (a plain fetch returns the
 * full real page, 200 OK). The only real block is a visible reCAPTCHA v2
 * gating the final submit (field_1_11, explicit render, not invisible
 * scoring) — same category as several other adapters in this project
 * (c2c-blowout-company, solmar-villas-newsletter): built up to the point of
 * submission, then fails loudly there rather than solving or evading it.
 */
export const kentAttractionsAdapter: CompetitionAdapter = {
  key: "kent-attractions",
  siteName: "Kent Attractions",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    // Complianz cookie-consent banner — can render after our first check
    // (same class of timing issue seen on other sites in this project), so
    // this is called again right before the checkbox/submit interaction
    // below too.
    const dismissCookieBanner = async (timeout: number) => {
      const deny = page.locator("button.cmplz-btn.cmplz-deny");
      if (await deny.first().isVisible({ timeout }).catch(() => false)) {
        await deny.first().click();
        await log.info("Dismissed cookie banner (denied non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("#gform_1");
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (#gform_1) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    await page.locator("#input_1_5_3").fill(profile.firstName);
    await page.locator("#input_1_5_6").fill(profile.lastName);
    await page.locator("#input_1_4").fill(profile.email);
    await log.info("Filled first name, last name, email");

    // Multi-select trivia field, but only one answer is correct — select
    // just that option. Value taken verbatim from the page's own <option>
    // list (20/60/10/40/30), matching the real Hever Castle jousting
    // anniversary rather than guessed.
    const answerSelect = page.locator("#input_1_1");
    if ((await answerSelect.locator('option[value="40"]').count()) === 0) {
      await log.warn("Expected trivia answer option (value=40) not found — question/options may have changed");
      return { status: "FAILED", message: "Quiz answer option not found on page" };
    }
    await answerSelect.selectOption("40");
    await log.info("Selected quiz answer: 40 (Hever Castle jousting's 40th anniversary season, 2026)");

    await dismissCookieBanner(3000);

    // Required to enter at all — accepting the competition's own T&Cs, not
    // marketing. #choice_1_10_2 ("I would like to receive newsletters via
    // email from Kent Attractions") is the independently optional marketing
    // checkbox and stays deliberately unticked.
    await page.locator("#choice_1_10_1").check();
    await log.info("Ticked required 'accept the terms and conditions of entry' checkbox — left the separate newsletter checkbox unticked");

    // Explicit-render Google reCAPTCHA v2 (data-sitekey present, not an
    // invisible/managed challenge) gates this form's submit. Confirmed
    // directly via the page's own markup — not attempting to solve it, just
    // checking for its presence and failing loudly rather than submitting
    // into a guaranteed rejection.
    const recaptcha = page.locator("#input_1_11 iframe");
    if (await recaptcha.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await log.warn("This form requires solving a visible reCAPTCHA challenge — not attempting to solve it");
      return { status: "FAILED", message: "Blocked by a visible reCAPTCHA challenge — not solved or evaded" };
    }

    const submit = page.locator("#gform_submit_button_1");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#gform_submit_button_1) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // This form has no ajax="true" marker in its markup — a plain full-page
    // postback to the same URL, so wait for the page to settle and read
    // whichever the site swaps the form for: a confirmation message or a
    // re-rendered form carrying validation errors.
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    const confirmation = page.getByText(/thank you|you're entered|good luck|entry received|successfully entered/i);
    const validationError = page.locator("#gform_wrapper_1.gform_validation_error, .gform_validation_error");
    try {
      await Promise.race([
        confirmation.first().waitFor({ state: "visible", timeout: 20000 }),
        validationError.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor a validation error appeared within 20s after submit — the reCAPTCHA may have silently blocked the automated browser");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await confirmation.first().isVisible().catch(() => false)) {
      const text = (await confirmation.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await page.locator("#gform_wrapper_1 .gfield_description.validation_message, #gform_wrapper_1 .validation_message").first().innerText().catch(() => "")).trim();
    await log.warn(`Form validation error: ${errorText || "(no error text found)"}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText || "unknown validation error"}` };
  },
};
