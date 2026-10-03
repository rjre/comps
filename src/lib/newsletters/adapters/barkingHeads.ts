import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Barking Heads (& Meowing Heads) — dog-food brand's own footer newsletter
 * widget (barkingheads.co.uk), confirmed directly via curl of the real
 * static HTML: a `[data-footer-newsletter]` block with `form[data-el="form"]`,
 * a single email field (`[data-el="email"]`) and a single required
 * checkbox (`[data-el="consent"]`) whose label IS this newsletter's own
 * privacy disclaimer — the form's only gate, not a separate marketing
 * opt-in, so it's ticked. No `action`/`method` on the form (JS-driven,
 * likely Klaviyo given the site loads `static.klaviyo.com/onsite/js/`), so
 * success is read from the static success message element
 * (`[data-el="success"]`, exact text "You have successfully subscribed to
 * our mailing list!") toggled visible after submit, not a page
 * navigation. No CAPTCHA present in the static markup.
 */
export const barkingHeadsNewsletterAdapter: NewsletterAdapter = {
  key: "barking-heads-newsletter",
  siteName: "Barking Heads",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    // Cookiebot — can render after this first check, so called again right
    // before the submit click below too (same timing issue documented on
    // suffolkCoast.ts and nationalLobsterHatchery.ts).
    const dismissCookieBanner = async (timeout: number) => {
      const decline = page.locator("#CybotCookiebotDialogBodyButtonDecline");
      if (await decline.isVisible({ timeout }).catch(() => false)) {
        await decline.click();
        await log.info("Dismissed cookie banner (declined non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator('[data-footer-newsletter] form[data-el="form"]').first();
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter form ([data-footer-newsletter]) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await form.locator('[data-el="email"]').fill(profile.email);
    await log.info("Filled email field");

    const consent = form.locator('[data-el="consent"]');
    await consent.check();
    await log.info("Checked required consent box (this newsletter's own opt-in)");

    await dismissCookieBanner(3000);

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

    const success = page.getByText(/successfully subscribed/i);
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
      await log.info(`Subscribed: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
