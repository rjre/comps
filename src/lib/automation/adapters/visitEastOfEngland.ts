import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Visit East of England (visiteastofengland.com), the official regional
 * tourism board covering Norfolk and Suffolk (sibling to the already-tracked
 * visitEssex/visitNorthNorfolk adapters, a different DMO/platform vendor —
 * this one runs on "Destination Core"/Craft CMS with the Solspace Freeform
 * plugin). One shared `data-freeform data-handle="competitionForm"` widget
 * across every /competitions/<slug> page, confirmed identical field-by-field
 * on all three currently-live competitions, so one adapter covers all of
 * them. Fields: firstName (required), lastName, email (required), telephone,
 * postcode — all real <input name=...> attributes read directly from the
 * served HTML, not guessed. Two independently required checkboxes
 * (privacyPolicy — consent to store/process data to respond to the entry;
 * termsAndConditions — "I have read and agreed to the Terms & Conditions
 * for communications") are both needed just to submit the form at all, so
 * both are ticked as acceptance of entering, not marketing; the one
 * genuinely optional checkbox (marketingMaterial — "receive marketing
 * material from Visit East of England") is deliberately left unticked. No
 * quiz/trivia question on any of these three.
 *
 * AJAX submit (Freeform's own freeform-submit.js/freeform.js, `data-ajax`)
 * with fixed confirmation/error copy baked directly into the form's own
 * `data-success-message`/`data-error-message` attributes ("Form has been
 * submitted successfully!" / "Sorry, there was an error submitting the
 * form. Please try again.") — matched by that exact wording rather than a
 * guessed DOM swap. Invisible reCAPTCHA v3 (`data-captcha="recaptcha"
 * data-version="v3"`) — not solved or evaded, just executed. No cookie-
 * consent banner script found anywhere in the served HTML/JS for this
 * site (checked directly, unlike visitEssex/visitNorthumberland on
 * different platforms) — nothing to dismiss.
 */
export const visitEastOfEnglandAdapter: CompetitionAdapter = {
  key: "visit-east-of-england",
  siteName: "Visit East of England",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 }).catch(async () => {
      await log.warn("Page 'load' event didn't fire within 45s — continuing anyway");
    });

    const form = page.locator('form[data-handle="competitionForm"]').first();
    if ((await form.count()) === 0) {
      await log.warn('Expected entry form (form[data-handle="competitionForm"]) not found — page may have changed');
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    await form.locator('input[name="firstName"]').fill(profile.firstName);
    if (profile.lastName) {
      await form.locator('input[name="lastName"]').fill(profile.lastName);
    }
    await form.locator('input[name="email"]').fill(profile.email);
    if (profile.phone) {
      await form.locator('input[name="telephone"]').fill(profile.phone);
    }
    if (profile.postalCode) {
      await form.locator('input[name="postcode"]').fill(profile.postalCode);
    }
    await log.info("Filled first name, last name, email, phone, and postcode");

    // Both required just to submit at all — acceptance of entering, not
    // marketing. #marketingMaterial ("receive marketing material from
    // Visit East of England") is the genuine optional marketing consent
    // and is deliberately left unticked.
    await form.locator('input[name="privacyPolicy"]').check();
    await form.locator('input[name="termsAndConditions"]').check();
    await log.info("Ticked the required privacy-policy and terms-and-conditions checkboxes");

    const submit = form.locator('button[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // Exact copy read directly out of this form's own data-success-message/
    // data-error-message attributes, not guessed. AJAX can take a while on
    // this site, so a generous timeout.
    const success = page.getByText(/form has been submitted successfully/i);
    const error = page.getByText(/there was an error submitting the form/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 30000 }),
        error.first().waitFor({ state: "visible", timeout: 30000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 30s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
