import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * National Lobster Hatchery's "Hatching News" newsletter — a standalone
 * Mailchimp signup widget (Yikes Easy Forms for Mailchimp, footer-opt-in-1)
 * separate from the competition entry form on the same site. Single email
 * field, no other consent bundled in.
 */
export const nationalLobsterHatcheryNewsletterAdapter: NewsletterAdapter = {
  key: "national-lobster-hatchery-newsletter",
  siteName: "National Lobster Hatchery",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    const form = page.locator("#footer-opt-in-1");
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter form (#footer-opt-in-1) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    const emailField = form.locator('input[name="EMAIL"]');
    await emailField.fill(profile.email);
    await log.info("Filled email field");

    const submit = form.locator('button[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found in newsletter form");
      return { status: "FAILED", message: "Submit button not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // A separate Bloom (Divi/Elegant Themes) newsletter-signup popup on the
    // same page auto-appears after a short delay and can intercept the
    // footer form's submit click. We're deliberately using the footer form,
    // not this popup, so close it if it's showing rather than fight it.
    const bloomClose = page.locator(".et_bloom_close_button");
    if (await bloomClose.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await bloomClose.first().click();
      await log.info("Dismissed a separate newsletter popup (Bloom) that appeared on the page");
    }

    await submit.click();

    // The AJAX-injected message div's exact class isn't present in the
    // static page (only rendered after submit), so match on the actual
    // wording rather than a guessed selector — this plugin's message is
    // "Thank you for subscribing..." on success. Requires a double
    // opt-in confirmation click in the actual inbox to fully activate.
    const success = page.getByText(/thank you for subscribing/i);
    const error = page.getByText(/already subscribed|invalid|error|something went wrong/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a success nor error message appeared within 15s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Subscribed: ${text} (note: Mailchimp double opt-in — a confirmation email must still be clicked)`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
