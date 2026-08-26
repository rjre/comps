import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Visit North Norfolk's own e-newsletter signup
 * (visitnorthnorfolk.com/information/enewsletter-sign-up) — a classic
 * embedded Mailchimp form, entirely separate from the questionnaire form on
 * northNorfolkAttractions.ts (same site, different page/engine — this one
 * is Mailchimp, that one is NewMind/eCMS). The "Would you like emails from
 * Visit North Norfolk?" dropdown and the GDPR "Email" channel checkbox are
 * both this page's sole purpose, so both are set deliberately here.
 */
export const visitNorthNorfolkNewsletterAdapter: NewsletterAdapter = {
  key: "visit-north-norfolk-newsletter",
  siteName: "Visit North Norfolk",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    // Same NewMind cookie-warning bar as northNorfolkAttractions.ts —
    // checked again right before the submit click below too.
    const dismissCookieBanner = async (timeout: number) => {
      const hide = page.locator("div.ctl_CookieWarning a.CookieWarningHide");
      if (await hide.first().isVisible({ timeout }).catch(() => false)) {
        await hide.first().click();
        await log.info("Dismissed cookie warning bar");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("#mc-embedded-subscribe-form");
    if ((await form.count()) === 0) {
      await log.warn("Expected Mailchimp signup form (#mc-embedded-subscribe-form) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await page.locator("#mce-EMAIL").fill(profile.email);
    const fullName = `${profile.firstName} ${profile.lastName}`.trim();
    await page.locator("#mce-FNAME").fill(fullName);
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

    // Mailchimp classic embedded forms submit cross-origin to
    // list-manage.com with target="_blank" — the actual response lands in
    // a new tab/popup rather than this page, so wait for that popup and
    // read its content instead of watching for a DOM change here.
    const [popup] = await Promise.all([
      page.waitForEvent("popup", { timeout: 15000 }).catch(() => null),
      submit.click(),
    ]);

    if (!popup) {
      await log.warn("Never observed the Mailchimp response popup after submit");
      return { status: "FAILED", message: "No response popup observed after submit — outcome unclear" };
    }

    await popup.waitForLoadState("domcontentloaded").catch(() => {});
    const success = popup.getByText(/almost finished|thank you for subscribing|confirm your subscription|check your inbox/i);
    const error = popup.getByText(/already subscribed|invalid|error|something went wrong|please enter/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a success nor error message appeared in the response popup within 15s");
      await popup.close().catch(() => {});
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Subscribed: ${text} (Mailchimp double opt-in — a confirmation email must still be clicked)`);
      await popup.close().catch(() => {});
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    await popup.close().catch(() => {});
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
