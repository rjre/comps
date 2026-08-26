import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Jet2holidays' own email sign-up page (jet2holidays.com/email) —
 * first-party, no purchase/account necessary. No name/address fields at
 * all, just email. Confirmed directly: this page has THREE separate
 * input[name="email"] fields (the top hero form we want, plus a footer
 * "Get exclusive offers now!" form and a hidden in-page form block) — a
 * bare input[name=email] locator hits a Playwright strict-mode
 * ambiguity, so every selector here is scoped to the top form's own
 * unique class (form.email-signup__input-box-form). Standard OneTrust
 * cookie banner. No genuine open no-purchase-necessary Jet2holidays
 * competition found at time of writing — both recent ones that turned
 * up in search had already closed. easyJet Holidays checked and
 * skipped: easyjet.com returns a persistent 403 on a plain page load,
 * not just at submit — a genuine bot-protection block, not evaded.
 *
 * Confirmed directly: after the reject click, the OneTrust banner
 * container re-renders itself (backdrop and all) before the final
 * submit — same "appears past every earlier checkpoint" pattern hit on
 * several other sites this project handles. Playwright's `force` click
 * option doesn't help here: it skips the actionability check but still
 * dispatches at the element's real screen coordinates, so the topmost
 * overlay eats the click regardless. Removing the whole
 * #onetrust-consent-sdk subtree from the DOM right before the final
 * submit is the reliable fix — safe since consent was already recorded
 * normally via the earlier reject click; this only clears a stale
 * decorative re-render, not an unhandled prompt.
 */
export const jet2holidaysNewsletterAdapter: NewsletterAdapter = {
  key: "jet2holidays-newsletter",
  siteName: "Jet2holidays",
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

    const form = page.locator("form.email-signup__input-box-form");
    const emailField = form.locator('input[name="email"]');
    try {
      await emailField.waitFor({ state: "visible", timeout: 15000 });
    } catch {
      await log.warn("Expected email sign-up form (form.email-signup__input-box-form) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }
    await emailField.fill(profile.email);
    await log.info("Filled email");

    const submit = page.locator("#btn-email");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#btn-email) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    await dismissCookieBanner(3000);

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    try {
      await submit.click({ timeout: 8000 });
    } catch {
      await log.warn("Submit click was blocked by a re-rendered OneTrust overlay after consent was already handled — removing it and retrying");
      await page.evaluate(() => document.querySelector("#onetrust-consent-sdk")?.remove());
      await submit.click();
    }

    // Confirmed directly: this form doesn't swap in a separate confirmation
    // message — the submit button itself relabels to "Signed up" in place.
    const confirmedButton = page.locator("#btn-email", { hasText: "Signed up" });
    const fieldError = page.locator(".validation-message");
    try {
      await Promise.race([
        confirmedButton.waitFor({ state: "visible", timeout: 20000 }),
        fieldError.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither the button relabelling to 'Signed up' nor a validation error appeared within 20s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await confirmedButton.isVisible().catch(() => false)) {
      await log.info("Confirmation shown: submit button relabelled to 'Signed up'");
      return { status: "SUCCESS", message: "Signed up" };
    }

    const errorText = (await fieldError.first().innerText()).trim();
    await log.warn(`Form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
