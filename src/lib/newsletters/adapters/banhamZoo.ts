import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Banham Zoo's own "Wild & Wonderful Updates" newsletter
 * (banhamzoo.co.uk/sign-up) — Banham Zoo (Norfolk) is run by the Zoological
 * Society of East Anglia (ZSEA), which also runs Africa Alive (Suffolk);
 * both are already tracked for competitions run by third parties
 * (Village People Magazine's joint Banham Zoo & Africa Alive giveaways —
 * village-people-banham-zoo and siblings), but this is the zoo's own
 * first-party newsletter signup, found directly on its own site, not the
 * same form.
 *
 * A plain, static Webflow form (verified directly from the raw served
 * HTML, no client-rendering needed): First-Name, Last-Name, Email all
 * marked required in the markup, Postcode optional. No marketing/consent
 * checkbox at all — the whole form's only purpose is this newsletter, so
 * there's nothing else to leave unticked. No cookie-consent banner,
 * reCAPTCHA, or other anti-bot script present anywhere in the static page.
 *
 * Africa Alive's own /sign-up redirects to a separate Ember.js app
 * (zsea.org, on a "goods.co.uk"/visitwonders.com commerce platform) that
 * embeds a real Google reCAPTCHA site key — a materially different,
 * heavier stack than this simple Webflow form, not built this round.
 *
 * Standard Webflow AJAX behaviour: submitting swaps the form for a
 * `.w-form-done` success panel ("Thank you" / "Keep an eye on your
 * inbox...") or a `.w-form-fail` one on error, matched here by wording
 * rather than the generic Webflow classes those panels share with every
 * other form on the site.
 */
export const banhamZooNewsletterAdapter: NewsletterAdapter = {
  key: "banham-zoo-newsletter",
  siteName: "Banham Zoo",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    const form = page.locator("#email-form");
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter form (#email-form) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await form.locator('input[name="First-Name"]').fill(profile.firstName);
    await form.locator('input[name="Last-Name"]').fill(profile.lastName);
    await form.locator('input[name="Email"]').fill(profile.email);
    if (profile.postalCode) {
      await form.locator('input[name="Postcode"]').fill(profile.postalCode);
    }
    await log.info("Filled first name, last name, email" + (profile.postalCode ? ", postcode" : ""));

    const submit = form.locator('input[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit control not found in newsletter form");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    const success = page.getByText(/keep an eye on your inbox/i);
    const error = page.getByText(/something went wrong while submitting/i);
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
      await log.info("Subscribed to Banham Zoo's newsletter");
      return { status: "SUCCESS", message: "Keep an eye on your inbox — we've got some wild updates coming your way soon." };
    }

    await log.warn("Newsletter form reported an error after submit");
    return { status: "FAILED", message: "Form reported an error: something went wrong while submitting the form" };
  },
};
