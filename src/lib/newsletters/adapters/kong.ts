import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * KONG (dog toy brand, kongcompany.com — one global store with a region
 * selector built into the form itself, no separate UK subdomain found)
 * — own footer newsletter widget, confirmed directly via curl of the
 * real static HTML: a Klaviyo-hosted form (`#footer-subscribe`,
 * `data-klaviyo-form`, posting to `a.klaviyo.com/client/subscriptions`).
 * Klaviyo's own onsite script (`static.klaviyo.com/onsite/js/`)
 * intercepts the real submit and toggles `.success_message`/
 * `.error_message` elements rather than letting the form's own
 * `target="_blank"` fallback open a new tab — confirmed by Klaviyo's own
 * documented embed behaviour, not guessed. Region <select> is set to
 * "UK" (matches this project's single UK-based profile) before
 * submitting. No marketing checkbox beyond the email field itself; no
 * CAPTCHA present in the static markup.
 */
export const kongNewsletterAdapter: NewsletterAdapter = {
  key: "kong-newsletter",
  siteName: "KONG",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    const form = page.locator("#footer-subscribe");
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter form (#footer-subscribe) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await form.locator('input[name="attributes.profile.data.attributes.email"]').fill(profile.email);
    await log.info("Filled email field");

    const regionSelect = form.locator('select[name="attributes.profile.data.attributes.properties.region"]');
    if ((await regionSelect.count()) > 0) {
      await regionSelect.selectOption("UK");
      await log.info("Selected region: United Kingdom");
    }

    const submit = form.locator(".klaviyo_submit_button");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (.klaviyo_submit_button) not found in newsletter form");
      return { status: "FAILED", message: "Submit button not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    const success = form.locator(".success_message");
    const error = form.locator(".error_message");
    try {
      await Promise.race([
        success.waitFor({ state: "visible", timeout: 15000 }),
        error.waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither the success nor error message element became visible within 15s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await success.isVisible().catch(() => false)) {
      const text = (await success.innerText().catch(() => "")).trim();
      await log.info(`Subscribed${text ? `: ${text}` : ""}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
