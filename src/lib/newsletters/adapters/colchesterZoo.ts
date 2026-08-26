import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Colchester Zoo (Colchester Zoological Society) — own newsletter, a
 * standalone Mailchimp hosted signup page
 * (colchesterzoo.us18.list-manage.com), linked from the zoo's official
 * site (colchester-zoo.com / colchesterzoologicalsociety.com). First
 * name, last name, and email are all required here (unlike
 * devonsTopAttractions.ts's optional name fields — confirmed via this
 * form's own "This field is required" text under each). Two GDPR
 * contact-channel checkboxes (Email/Direct Mail) — only "Email" is
 * ticked, since that's this newsletter's own delivery channel, not a
 * third-party sharing consent. Two hidden honeypot fields (b_name/b_email)
 * are deliberately left untouched. No competition currently open on this
 * org's own domain at time of writing (past ones ran via Facebook or
 * third-party blogs, not a first-party web form) — newsletter only.
 *
 * Same underlying Mailchimp hosted-subscribe-page pattern as
 * devonsTopAttractions.ts, which is documented there as hitting a
 * connection-level block on the list-manage.com/subscribe/post endpoint —
 * worth checking whether that reproduces here too (different shard,
 * us18 vs us9, so not guaranteed) rather than assuming it does.
 */
export const colchesterZooNewsletterAdapter: NewsletterAdapter = {
  key: "colchester-zoo-newsletter",
  siteName: "Colchester Zoo",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    const form = page.locator('form[action*="list-manage.com/subscribe/post"]');
    if ((await form.count()) === 0) {
      await log.warn("Expected Mailchimp signup form (form[action*='list-manage.com/subscribe/post']) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    // All three required by this form (unlike Devon's Top Attractions'
    // equivalent, where only email is) — fail loudly rather than submit a
    // form we know will be rejected.
    if (!profile.firstName || !profile.lastName) {
      await log.warn("Profile is missing firstName/lastName, both required by this form");
      return { status: "FAILED", message: "Profile missing firstName/lastName required by this form" };
    }

    await page.locator("#MERGE1").fill(profile.firstName);
    await page.locator("#MERGE2").fill(profile.lastName);
    await page.locator("#MERGE0").fill(profile.email);
    await log.info("Filled first name, last name, email");
    // Address (MERGE3) and birthday (MERGE5) fields on this form are both
    // optional — left blank.

    const emailChannelConsent = page.locator("#gdpr_5399");
    if ((await emailChannelConsent.count()) > 0) {
      await emailChannelConsent.check();
      await log.info("Ticked GDPR 'Email' contact-channel checkbox — this newsletter's own delivery channel, this page's sole purpose");
    } else {
      await log.warn("Expected GDPR email-channel checkbox (#gdpr_5399) not found — site may have changed");
    }
    // Left unticked deliberately: #gdpr_5403 (Direct Mail) — broader than
    // this newsletter signup.

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
