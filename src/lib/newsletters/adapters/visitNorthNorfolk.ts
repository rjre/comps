import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Visit North Norfolk's own e-newsletter signup
 * (visitnorthnorfolk.com/information/enewsletter-sign-up) — an embedded
 * Mailchimp form, entirely separate from the questionnaire form on
 * northNorfolkAttractions.ts (same site, different page/engine — this one
 * is Mailchimp, that one is NewMind/eCMS). The "Would you like emails from
 * Visit North Norfolk?" dropdown and the GDPR "Email" channel checkbox are
 * both this page's sole purpose, so both are set deliberately here.
 *
 * Two real quirks, both confirmed by direct testing rather than assumed:
 * the email/name fields' own validation JS clears a plain .fill() straight
 * back out, so they're typed via pressSequentially instead; and unlike a
 * classic Mailchimp embed, this list's form never opens a popup — it
 * validates and responds inline on the same page.
 */
export const visitNorthNorfolkNewsletterAdapter: NewsletterAdapter = {
  key: "visit-north-norfolk-newsletter",
  siteName: "Visit North Norfolk",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    // This site actually uses the CookieScript CMP, not NewMind's own
    // native cookie bar — same fix as northNorfolkAttractions.ts, checked
    // directly against the real page. Checked again right before the
    // submit click below too.
    const dismissCookieBanner = async (timeout: number) => {
      const cookieScriptReject = page.locator("#cookiescript_reject");
      if (await cookieScriptReject.isVisible({ timeout }).catch(() => false)) {
        await cookieScriptReject.click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
        return;
      }
      const nativeHide = page.locator("div.ctl_CookieWarning a.CookieWarningHide");
      if (await nativeHide.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await nativeHide.first().click();
        await log.info("Dismissed cookie warning bar");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("#mc-embedded-subscribe-form");
    if ((await form.count()) === 0) {
      await log.warn("Expected Mailchimp signup form (#mc-embedded-subscribe-form) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    // .fill() sets the value directly but this field's own validation JS
    // clears it straight back out (confirmed directly — inputValue() reads
    // empty immediately after a .fill()); simulating real keystrokes with
    // pressSequentially survives it, same as a person typing into it would.
    const emailField = page.locator("#mce-EMAIL");
    await emailField.click();
    await emailField.pressSequentially(profile.email, { delay: 20 });
    const fullName = `${profile.firstName} ${profile.lastName}`.trim();
    const nameField = page.locator("#mce-FNAME");
    await nameField.click();
    await nameField.pressSequentially(fullName, { delay: 20 });
    await log.info(`Filled email and name (${fullName})`);

    await page.locator("#mce-MMERGE4").selectOption({ label: "Yes, from yourselves" });
    await log.info("Selected 'Would you like emails from Visit North Norfolk?': Yes, from yourselves");

    const emailChannelConsent = page.locator("#gdpr_25");
    if ((await emailChannelConsent.count()) > 0) {
      await emailChannelConsent.check();
      await log.info("Ticked GDPR 'Email' marketing-permission channel — this page's sole purpose");
    } else {
      await log.warn("Expected GDPR email-channel checkbox (#gdpr_25) not found — site may have changed");
    }

    await dismissCookieBanner(3000);

    const submit = page.locator("#mc-embedded-subscribe");
    if ((await submit.count()) === 0) {
      await log.warn("Subscribe button (#mc-embedded-subscribe) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // Not a classic cross-origin popup submission on this list's
    // configuration — confirmed directly, no popup ever fires. It
    // validates and shows its response inline on this same page instead.
    await submit.click();

    const success = page.getByText(/almost finished|thank you for subscribing|confirm your subscription|check your inbox/i);
    const error = page.getByText(/looks fake or invalid|already subscribed|invalid|error|something went wrong|please enter/i);
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
      await log.info(`Subscribed: ${text} (Mailchimp double opt-in — a confirmation email must still be clicked)`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
