import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Virgin Atlantic Holidays' own newsletter signup
 * (virginholidays.co.uk/sign-up, redirects to
 * virginatlantic.com/holidays/sign-up) — a simple AngularJS form: first
 * name + email only. An Ensighten "Your privacy matters to us" cookie
 * banner covers the bottom of the page on first load (Accept All/Reject
 * All) — rejected before interacting. The page also has a separate,
 * unrelated in-page cookie-preference panel (Essential/Analytics/
 * Marketing/Functional toggles further down, all off by default) — that's
 * just the site's general cookie settings UI, nothing to do with this
 * form, and is left untouched.
 */
export const virginAtlanticHolidaysNewsletterAdapter: NewsletterAdapter = {
  key: "virgin-atlantic-holidays-newsletter",
  siteName: "Virgin Atlantic Holidays",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    const cookieReject = page.locator("#ensRejectAll");
    if (await cookieReject.isVisible({ timeout: 8000 }).catch(() => false)) {
      await cookieReject.click();
      await log.info("Dismissed cookie banner (rejected non-essential cookies)");
    }

    const forename = page.locator("#forename");
    const email = page.locator("#email");
    try {
      await forename.waitFor({ state: "visible", timeout: 15000 });
    } catch {
      await log.warn("Expected sign-up form (#forename/#email) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await forename.fill(profile.firstName);
    await email.fill(profile.email);
    await log.info("Filled first name and email");

    const submit = page.locator('form[name="signupForm"] button[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // AngularJS single-page form — no full navigation on success; the form
    // itself is replaced with confirmation content. Match on wording since
    // there's no confirmation markup to inspect ahead of a real submit.
    const confirmation = page.getByText(/thank you|you'?re signed up|successfully subscribed|you have been subscribed/i);
    const fieldError = page.getByText(/something went wrong|please try again|invalid/i);
    try {
      await Promise.race([
        confirmation.first().waitFor({ state: "visible", timeout: 20000 }),
        fieldError.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation message nor a validation error appeared within 20s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await confirmation.first().isVisible().catch(() => false)) {
      const text = (await confirmation.first().innerText()).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text };
    }

    const errorText = (await fieldError.first().innerText()).trim();
    await log.warn(`Form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
