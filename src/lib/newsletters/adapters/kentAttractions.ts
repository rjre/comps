import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Kent Attractions' own site-wide footer newsletter signup
 * (kentattractions.co.uk), a standard Mailchimp classic embedded form
 * ("Get seasonal events and offers delivered straight to your inbox") —
 * distinct from the "Competition Time!" prize draw's own separate,
 * independently-optional opt-in checkbox already tracked as a competition
 * (kentAttractions.ts in ../automation/adapters, key "kent-attractions").
 * Confirmed directly from the served HTML: single required email field,
 * plus a standard Mailchimp honeypot text input (name starting "b_", left
 * blank) — no reCAPTCHA on this form at all, that's only on the
 * competition's own separate Gravity Forms page.
 */
export const kentAttractionsNewsletterAdapter: NewsletterAdapter = {
  key: "kent-attractions-newsletter",
  siteName: "Kent Attractions",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    // Same Complianz cookie banner as the competition adapter on this
    // site — can render after our first check, so this is called again
    // right before the submit click below too.
    const dismissCookieBanner = async (timeout: number) => {
      const deny = page.locator("button.cmplz-btn.cmplz-deny");
      if (await deny.first().isVisible({ timeout }).catch(() => false)) {
        await deny.first().click();
        await log.info("Dismissed cookie banner (denied non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("form.newsletter-form");
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter form (form.newsletter-form) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await form.locator("#mce-EMAIL").fill(profile.email);
    await log.info("Filled email field");
    // Honeypot field (name starting "b_") deliberately left blank.

    await dismissCookieBanner(3000);

    const submit = form.locator("#mc-embedded-subscribe");
    if ((await submit.count()) === 0) {
      await log.warn("Subscribe button (#mc-embedded-subscribe) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // Classic Mailchimp embed with target="_blank" on the form itself —
    // the response renders in a new tab rather than replacing this page,
    // same handling as visitLakeDistrict.ts's newsletter adapter.
    const [popup] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 15000 }).catch(() => null),
      submit.click(),
    ]);

    if (!popup) {
      await log.warn("No new tab opened after submit within 15s — outcome unclear");
      return { status: "FAILED", message: "No response tab observed after submit" };
    }
    await popup.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});

    // list-manage.com's own hosted response page states either an error
    // or a double-opt-in confirmation notice in its own wording — matched
    // by text, not a guessed selector, same approach as other
    // Mailchimp-hosted adapters in this project.
    const success = popup.getByText(/almost finished|check your inbox|please confirm|thank you for subscribing/i);
    const error = popup.getByText(/already subscribed|invalid|error|something went wrong|please enter/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 15s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Subscribed: ${text} (Mailchimp double opt-in — a confirmation email must still be clicked)`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
