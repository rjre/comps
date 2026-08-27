import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Solmar Villas' own homepage newsletter signup ("Sign up today for
 * exclusive offers", solmarvillas.com) — a genuine Drupal Webform embedded
 * directly on the homepage (id "webform-submission-newsletter-signup-node-
 * 2623138-add-form"), first name / last name / email, separate from the
 * British Travel Awards vote-to-win competition already tracked for this
 * org via solmarVillasBritishTravelAwards.ts (different site,
 * britishtravelawards.com, not solmarvillas.com).
 *
 * Confirmed directly from the real HTML: this form carries a *visible*
 * reCAPTCHA v2 image challenge (data-type="image" on the g-recaptcha div,
 * not just an invisible v3 score check) — always present, not conditional
 * on suspicious behaviour. Filled out up to that point and then fails
 * loudly rather than attempt to solve or evade it, same policy as
 * c2cBlowoutCompany.ts and visitEssexGardenersWorld.ts.
 */
export const solmarVillasNewsletterAdapter: NewsletterAdapter = {
  key: "solmar-villas-newsletter",
  siteName: "Solmar Villas",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load" });

    const dismissCookieBanner = async (timeout: number) => {
      const cookieReject = page.locator("#onetrust-reject-all-handler");
      if (await cookieReject.isVisible({ timeout }).catch(() => false)) {
        await cookieReject.click();
        await page.locator("#onetrust-consent-sdk").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator('form[id^="webform-submission-newsletter-signup-node-"]');
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter webform not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await form.locator('input[name="name"]').fill(profile.firstName);
    await form.locator('input[name="last_name"]').fill(profile.lastName);
    await form.locator('input[name="email"]').fill(profile.email);
    await log.info("Filled first name, last name, email");

    // This form always renders a visible reCAPTCHA v2 image challenge
    // (confirmed directly in the served HTML, data-type="image") — not
    // solved or evaded, same as the c2c Blowout Company / Visit Essex
    // Gardeners' World adapters.
    await dismissCookieBanner(3000);
    const recaptcha = page.frameLocator('iframe[title="reCAPTCHA"]').locator("body");
    if (await recaptcha.isVisible({ timeout: 5000 }).catch(() => false)) {
      await log.warn("This form requires solving a visible reCAPTCHA challenge — not attempting to solve it");
      return { status: "FAILED", message: "Blocked by a visible reCAPTCHA challenge — not solved or evaded" };
    }

    const submit = form.locator('input[type="submit"]#edit-actions-submit');
    if ((await submit.count()) === 0) {
      await log.warn("Submit control (#edit-actions-submit) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await dismissCookieBanner(3000);
    await submit.click();

    const confirmation = page.locator(".messages--status, .webform-confirmation");
    const validationError = page.locator(".messages--error, .form-item--error-message");
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

    const errorText = (await validationError.first().innerText().catch(() => "")).trim();
    await log.warn(`Form validation error: ${errorText || "(no error text found)"}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText || "unknown validation error"}` };
  },
};
