import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Devon's Top Attractions' own newsletter — a standalone Mailchimp hosted
 * signup page (devonstopattractions.us9.list-manage.com), linked from a
 * "Newsletter Sign up" panel on the same competition page tracked as
 * devonsTopAttractions.ts, but a genuinely separate submission (different
 * platform/host — Gravity Forms on the competition page vs. this hosted
 * Mailchimp page), not that form's own opt-in checkbox reused. Email
 * required; name/phone/county optional. Three GDPR contact-channel
 * checkboxes (Email/Direct Mail/Customized online advertising) — only
 * "Email" is ticked, since that's this newsletter's own delivery channel,
 * not a third-party sharing consent. Two hidden honeypot fields
 * (b_name/b_email) are deliberately left untouched.
 *
 * Known limitation, confirmed directly rather than assumed: the actual
 * POST to list-manage.com/subscribe/post resets the connection at the
 * protocol level (a raw curl POST to the same URL fails identically with
 * an HTTP/2 error, while a plain GET to the page succeeds normally) —
 * this looks like Mailchimp's own infrastructure protecting that
 * submission endpoint broadly, not something specific to this list. Same
 * "genuine connection-level block, not evaded" category as Waitrose/P&O
 * elsewhere in this project. This adapter fails loudly and correctly; it
 * isn't expected to succeed until/unless that changes.
 */
export const devonsTopAttractionsNewsletterAdapter: NewsletterAdapter = {
  key: "devons-top-attractions-newsletter",
  siteName: "Devon's Top Attractions",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    const form = page.locator('form[action*="list-manage.com/subscribe/post"]');
    if ((await form.count()) === 0) {
      await log.warn("Expected Mailchimp signup form (form[action*='list-manage.com/subscribe/post']) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await page.locator("#MERGE0").fill(profile.email);
    await log.info("Filled email");

    if (profile.firstName) {
      await page.locator("#MERGE1").fill(profile.firstName);
    }
    if (profile.lastName) {
      await page.locator("#MERGE2").fill(profile.lastName);
    }
    if (profile.phone) {
      await page.locator("#MERGE4").fill(profile.phone);
    }
    if (profile.region) {
      await page.locator("#MERGE3").fill(profile.region);
    }
    await log.info("Filled name/phone/county where available");

    const emailChannelConsent = page.locator("#gdpr_3161");
    if ((await emailChannelConsent.count()) > 0) {
      await emailChannelConsent.check();
      await log.info("Ticked GDPR 'Email' contact-channel checkbox — this newsletter's own delivery channel, this page's sole purpose");
    } else {
      await log.warn("Expected GDPR email-channel checkbox (#gdpr_3161) not found — site may have changed");
    }
    // Left unticked deliberately: #gdpr_3165 (Direct Mail), #gdpr_3169
    // (Customized online advertising) — broader than this newsletter signup.

    const submit = page.locator('input[type="submit"][name="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Subscribe button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // Full (non-AJAX) form POST — Mailchimp's hosted subscribe page reloads
    // on the same URL and shows either a ".confirm-thanks" success panel or
    // inline validation errors, rather than an in-page fetch response.
    await submit.click();

    const success = page.locator(".confirm-thanks");
    const error = page.getByText(/looks fake or invalid|already subscribed|invalid|error|please enter/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a success panel nor an error message appeared within 15s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Subscribed: ${text || "(confirm-thanks panel shown)"} (Mailchimp double opt-in — a confirmation email must still be clicked)`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
