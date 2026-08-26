import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Emirates' own "Subscribe to special offers"
 * (emirates.com/english/special-offers/subscribe-to-offers/) — genuinely
 * a two-step flow after all, confirmed directly: submitting the simple
 * footer widget (email only) advances the SAME page to "STEP 2 OF 2",
 * asking for title/first name/last name/country/preferred language (this
 * profile's UK country is already prefilled correctly) before a final
 * Subscribe button. Title and the "interested cities" filter are both
 * optional (no asterisk, no required attribute) — left alone rather than
 * fighting a custom autocomplete widget for no requirement.
 *
 * Confirmed directly: the top wizard's own step-1 email input and the
 * footer form's share the literal id "email" (a real duplicate-id bug on
 * Emirates' own markup) — every selector is scoped to the footer form
 * specifically to avoid resolving to the wrong one.
 *
 * OneTrust cookie banner reappears more than once across this flow (seen
 * again after landing on step 2) — same "appears past every earlier
 * checkpoint" pattern as other sites this project has hit; re-checked
 * right before both the step-1 and the final submit, and its dark
 * backdrop is waited out (not just the button click) since it can still
 * intercept clicks for a moment after being dismissed.
 *
 * Confirmed directly (twice, via a raw network-response check, not just
 * the rendered page): on a real submit the final POST returns a normal
 * 200 and the page silently resets to a blank step 1 — no "Thank you"
 * banner, no toast, nothing — this product just doesn't show one. A
 * validation error, by contrast, keeps you on step 2 with visible field
 * error text. So "landed back on a blank step 1 with no error text
 * visible" is this site's real success signal, not a guess.
 */
export const emiratesNewsletterAdapter: NewsletterAdapter = {
  key: "emirates-newsletter",
  siteName: "Emirates",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    const dismissCookieBanner = async (timeout: number) => {
      const cookieReject = page.locator("#onetrust-reject-all-handler");
      if (await cookieReject.isVisible({ timeout }).catch(() => false)) {
        await cookieReject.click();
        await page.locator("#onetrust-consent-sdk").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(8000);

    const step1Form = page.locator('form.subscribe[action="/english/special-offers/subscribe-to-offers/"]');
    if ((await step1Form.count()) === 0) {
      await log.warn("Expected footer subscribe form (step 1) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }
    await step1Form.locator("#email").fill(profile.email);
    await log.info("Filled email (step 1 of 2)");
    await step1Form.locator('button[type="submit"]').click();

    const firstNameField = page.locator("#firstname");
    try {
      await firstNameField.waitFor({ state: "visible", timeout: 15000 });
    } catch {
      await log.warn("Step 2 (#firstname) never appeared within 15s after step 1 submit");
      return { status: "FAILED", message: "Step 2 of the form did not load" };
    }
    await dismissCookieBanner(5000);

    await firstNameField.fill(profile.firstName);
    await page.locator("#lastname").fill(profile.lastName);
    await log.info("Filled first name and last name (step 2 of 2) — leaving Title, Country and Preferred language on their defaults");

    await dismissCookieBanner(3000);

    const submit = page.locator('button[type="submit"]:has-text("Subscribe")');
    if ((await submit.count()) === 0) {
      await log.warn("Step 2 Subscribe button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === "POST" && r.url() === "https://www.emirates.com/english/special-offers/subscribe-to-offers/",
        { timeout: 20000 },
      ),
      submit.click(),
    ]).catch(() => [undefined]);

    if (!response || !response.ok()) {
      await log.warn(`Submit POST did not complete normally (status: ${response?.status() ?? "no response"})`);
      return { status: "FAILED", message: "Submit request did not complete normally" };
    }

    const fieldError = page.getByText(/something went wrong|please try again|please enter a valid|invalid email|this field is required/i);
    const resetStep1Email = page.locator('form.subscribe[action="/english/special-offers/subscribe-to-offers/"] #email');
    try {
      await Promise.race([
        resetStep1Email.first().waitFor({ state: "visible", timeout: 10000 }),
        fieldError.first().waitFor({ state: "visible", timeout: 10000 }),
      ]);
    } catch {
      await log.warn("Neither a reset step-1 form nor a validation error appeared within 10s after submit");
      return { status: "FAILED", message: "Outcome unclear after submit" };
    }

    if (await fieldError.first().isVisible().catch(() => false)) {
      const errorText = (await fieldError.first().innerText()).trim();
      await log.warn(`Form error: ${errorText}`);
      return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
    }

    await log.info("Submit POST succeeded and the form reset to a blank step 1 with no validation error — this site shows no explicit confirmation message, this is its normal success behaviour");
    return { status: "SUCCESS" };
  },
};
