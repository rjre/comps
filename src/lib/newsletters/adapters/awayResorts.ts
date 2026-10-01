import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Away Resorts' own "Sign up to Latest Offers" newsletter page
 * (awayresorts.co.uk/newsletter/), a genuine first-party form posting to
 * /api/form/ (EnquiryType=Newsletter). Confirmed directly from the served
 * HTML: Title (select, required), first name, last name, email (required),
 * phone (optional), a required "How did you hear about us?" dropdown
 * (SecondarySource — answered "Search Engine", genuinely how this project
 * found the page, not a guess), a conditionally-required free-text field
 * that only appears if SecondarySource is "Other" (left alone since it
 * isn't selected), and two groups of optional interest checkboxes (which
 * of Away Resorts' ~20 parks / which holiday types to hear about,
 * including Mersea Island — genuinely local to this Essex-based profile)
 * left untouched since none map to a required consent.
 *
 * This form always renders a visible reCAPTCHA v2 checkbox widget
 * (`.g-recaptcha`, no `size="invisible"`), not conditional — filled out up
 * to that point and then fails loudly rather than attempt to solve or
 * evade it, same policy as c2cBlowoutCompany.ts and solmarVillas.ts.
 *
 * The page's own cookie banner (#cookie-banner) offers only "I agree" or
 * "Manage" (which navigates to a separate /cookie-policy/ page) — no
 * one-click reject. Deliberately never clicked here: not accepting leaves
 * non-essential cookies in their default-blocked state, and the banner is
 * a bottom bar rather than a page-blocking overlay, so it doesn't need
 * dismissing to reach the form or the submit button.
 */
export const awayResortsNewsletterAdapter: NewsletterAdapter = {
  key: "away-resorts-newsletter",
  siteName: "Away Resorts",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load" });

    const form = page.locator("#brochure-form-offers-signup");
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter form (#brochure-form-offers-signup) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    const salutationSelect = form.locator("#offers_signup_Salutations");
    if (!profile.title) {
      await log.warn("Profile is missing title, required by this form's Title dropdown");
      return { status: "FAILED", message: "Profile missing title required by this form" };
    }
    const hasTitleOption = (await salutationSelect.locator(`option[value="${profile.title}"]`).count()) > 0;
    if (!hasTitleOption) {
      await log.warn(`Profile title "${profile.title}" isn't one of this form's options (Mr/Mrs/Miss/Ms/Dr/Rev/Sir)`);
      return { status: "FAILED", message: `Profile title "${profile.title}" not offered by this form` };
    }
    await salutationSelect.selectOption(profile.title);

    await form.locator("#offers_signup_FirstName").fill(profile.firstName);
    await form.locator("#offers_signup_LastName").fill(profile.lastName);
    await form.locator("#offers_signup_Email").fill(profile.email);
    if (profile.phone) {
      await form.locator("#offers_signup_Phone").fill(profile.phone);
    }
    // Genuinely how this project found the page — not a guessed/fabricated
    // answer. Leaves the conditional "Other" free-text field untouched.
    await form.locator("#offers_signup_SecondarySource").selectOption("Search Engine");
    await log.info("Filled title, first name, last name, email, and how-did-you-hear-about-us");
    // Park/holiday-type interest checkboxes left unticked deliberately —
    // content preferences for this same newsletter, not third-party
    // marketing consent, and none are required to submit.

    const recaptcha = page.frameLocator('iframe[title="reCAPTCHA"]').locator("body");
    if (await recaptcha.isVisible({ timeout: 5000 }).catch(() => false)) {
      await log.warn("This form requires solving a visible reCAPTCHA challenge — not attempting to solve it");
      return { status: "FAILED", message: "Blocked by a visible reCAPTCHA challenge — not solved or evaded" };
    }

    const submit = form.locator('button[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found in newsletter form");
      return { status: "FAILED", message: "Submit button not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    const confirmation = form.locator(".success-msg");
    const validationError = form.locator(".error-msg");
    try {
      await Promise.race([
        confirmation.first().waitFor({ state: "visible", timeout: 20000 }),
        validationError.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 20s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await confirmation.first().isVisible().catch(() => false)) {
      const text = (await confirmation.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await validationError.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText || "unknown error"}` };
  },
};
