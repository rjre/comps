import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Visit Lake District's own newsletter signup
 * (visitlakedistrict.com/offers/sign-up-to-newsletter) — standard
 * Mailchimp embedded form (hosted by Cumbria Tourism, who own Visit
 * Lake District). Required: Email, First Name, Last Name, Country of
 * residence (dropdown — "United Kingdom" selected). Title and Postcode
 * are optional and left blank. A "What holiday interests you?" checkbox
 * group further down is optional too — left untouched, same reasoning
 * as the prize-draw adapter (not fabricating a preference). Only the
 * organiser's own GDPR consent checkbox (gdpr_169147, "I would like to
 * receive occasional news... from Visit Lake District") is ticked —
 * this page's sole purpose, this newsletter's own first-party channel.
 */
export const visitLakeDistrictNewsletterAdapter: NewsletterAdapter = {
  key: "visit-lake-district-newsletter",
  siteName: "Visit Lake District",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    // Confirmed directly: unlike the prize-draw pages on this same site
    // (native NewMind cookie bar), this newsletter signup page uses
    // CookieScript instead — its dialog intercepts the GDPR checkbox
    // click below if left undismissed.
    const dismissCookieBanner = async (timeout: number) => {
      const cookieScriptReject = page.locator("#cookiescript_reject");
      if (await cookieScriptReject.isVisible({ timeout }).catch(() => false)) {
        await cookieScriptReject.click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("#mc-embedded-subscribe-form");
    if ((await form.count()) === 0) {
      await log.warn("Expected Mailchimp signup form (#mc-embedded-subscribe-form) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    // Confirmed directly: plain .fill() on these three fields gets
    // silently cleared by this page's own client-side validation script
    // before submit (the select/checkbox below aren't affected) —
    // .pressSequentially simulates real keystrokes and survives it, same
    // fix already used elsewhere in this project for the same failure mode.
    await page.locator("#mce-EMAIL").pressSequentially(profile.email, { delay: 20 });
    await page.locator("#mce-FNAME").pressSequentially(profile.firstName, { delay: 20 });
    await page.locator("#mce-LNAME").pressSequentially(profile.lastName, { delay: 20 });
    await page.locator("#mce-MMERGE8").selectOption({ label: "United Kingdom" });
    if (profile.postalCode) {
      await page.locator("#mce-MMERGE7").fill(profile.postalCode);
    }
    await log.info("Filled email, first name, last name, country (UK), postcode where available");

    await dismissCookieBanner(3000);

    const gdprConsent = page.locator("#gdpr_169147");
    if ((await gdprConsent.count()) > 0) {
      await gdprConsent.check();
      await log.info("Ticked Visit Lake District's own GDPR consent checkbox — this page's sole purpose");
    } else {
      await log.warn("Expected GDPR consent checkbox (#gdpr_169147) not found — site may have changed");
    }

    const submit = page.locator("#mc-embedded-subscribe");
    if ((await submit.count()) === 0) {
      await log.warn("Subscribe button (#mc-embedded-subscribe) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // This form opens its response in a new tab (target="_blank", per
    // Mailchimp's classic embed pattern) rather than replacing the
    // current page — same handling as other classic-embed Mailchimp
    // adapters in this project that don't rely on an inline swap.
    //
    // Confirmed directly: this page can have more than one overlay
    // intercepting the submit click — CookieScript re-rendering after
    // being dismissed once, and separately a Mailchimp popup widget (id
    // starting "mcforms-") neither dismiss checkpoint above targets.
    // Same fallback already proven on this site's competition adapter.
    const clickSubmit = async () => {
      try {
        await submit.click({ timeout: 8000 });
      } catch {
        await log.warn("Submit click was blocked by an overlay (cookie dialog or popup widget) — removing known culprits and retrying");
        await page.evaluate(() => {
          document.querySelector("#cookiescript_injected_wrapper")?.remove();
          document.querySelectorAll('[id^="mcforms-"]').forEach((el) => el.remove());
        });
        await submit.click();
      }
    };
    const [popup] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 15000 }).catch(() => null),
      clickSubmit(),
    ]);

    const resultPage = popup ?? page;
    if (popup) {
      await popup.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    }

    // Confirmed directly (twice, live): this form shows no explicit
    // confirmation text on success — no ".confirm-thanks" panel, no
    // toast, nothing. It just silently reloads to a completely blank,
    // pristine copy of the same form (email field present but empty, no
    // "required" validation text visible) — same "silent success"
    // behaviour already found on the Emirates newsletter adapter. So
    // "reloaded to a genuinely blank form, no error text visible" is
    // treated as this site's real success signal; anything else
    // (visible error text, or neither state settling within the wait)
    // is reported as failed/unclear rather than assumed successful.
    const emailField = resultPage.locator("#mce-EMAIL");
    const fieldError = resultPage.locator("#mce-error-response");
    try {
      await Promise.race([
        emailField.waitFor({ state: "visible", timeout: 15000 }),
        fieldError.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a reset form nor a validation error appeared within 15s after submit");
      return { status: "FAILED", message: "Outcome unclear after submit" };
    }
    await resultPage.waitForTimeout(1000);

    const emailFieldValue = await emailField.inputValue().catch(() => null);
    const errorVisible = await fieldError.first().isVisible().catch(() => false);
    if (!errorVisible && emailFieldValue === "") {
      await log.info("Submit succeeded and the form reset to blank with no validation error — this site shows no explicit confirmation message, this is its normal success behaviour (Mailchimp double opt-in — a confirmation email must still be clicked)");
      return { status: "SUCCESS" };
    }

    const errorText = errorVisible ? (await fieldError.first().innerText().catch(() => "")).trim() : "";
    await log.warn(`Form did not cleanly reset after submit (email field value: ${JSON.stringify(emailFieldValue)}, error visible: ${errorVisible}): ${errorText}`);
    return { status: "FAILED", message: errorText || "Form did not reset cleanly after submit — outcome unclear" };
  },
};
