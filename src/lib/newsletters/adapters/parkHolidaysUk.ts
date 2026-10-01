import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Park Holidays UK — homepage "Sign up now" newsletter modal
 * (parkholidays.com). Distinct from the win-a-holiday-home competition
 * already tracked (parkHolidaysWinAHolidayHome.ts) — same operator, same
 * site, but a separate modal/form, not that competition's own entry
 * fields. The two dedicated "/subscribe-to-newsletter" URLs findable via
 * search both 301-redirect straight back to their parent page (confirmed
 * directly) — that standalone page no longer exists, so this navigates to
 * the homepage and opens the newsletter modal from there instead, the only
 * place a working form was found.
 *
 * A React/Next.js modal (`data-testid="newsletter-sign-up-button"` opens
 * it): email, plus three independently-optional "What would you like to
 * hear about?" topic checkboxes (Holidays / Touring & Camping / Owning a
 * Holiday Home) — all three are this org's own first-party newsletter
 * content, not third-party sharing, so all three are ticked (one, "Owning
 * a Holiday Home", is on by default; the other two start off).
 *
 * Confirmed directly from the rendered DOM: this modal's submit button is
 * gated by the same invisible Cloudflare Turnstile widget already
 * documented on this exact domain's competition adapter
 * (parkHolidaysWinAHolidayHome.ts) — a `data-testid="turnstile-container"`
 * with no visible widget element, and that sibling adapter's own live
 * testing found it errors consistently on this domain (console:
 * "[Turnstile Error] 600010"), blocking the submit button from ever
 * enabling. Not solved or evaded — detected the same way here (a console
 * listener, since there's nothing to point a selector at) and failed
 * loudly if it fires, same as there.
 *
 * Same OneTrust cookie banner as parkHolidaysWinAHolidayHome.ts
 * ("Reject All Cookies", with the same backdrop-lingers-after-dismiss
 * behaviour), handled the same way here.
 */
export const parkHolidaysUkNewsletterAdapter: NewsletterAdapter = {
  key: "park-holidays-uk-newsletter",
  siteName: "Park Holidays UK",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });

    const cookieReject = page.getByRole("button", { name: "Reject All Cookies", exact: true });
    if (await cookieReject.isVisible({ timeout: 8000 }).catch(() => false)) {
      await cookieReject.click();
      await page.locator("#onetrust-consent-sdk").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
      await log.info("Dismissed cookie banner (rejected non-essential cookies)");
    }
    await page.waitForTimeout(1000);

    const signUpButton = page.getByTestId("newsletter-sign-up-button");
    if ((await signUpButton.count()) === 0) {
      await log.warn("'Sign up now' newsletter button not found — page may have changed");
      return { status: "FAILED", message: "Newsletter sign-up button not found on page" };
    }
    try {
      await signUpButton.click({ timeout: 8000 });
    } catch {
      await log.warn("'Sign up now' click was blocked by a re-rendered cookie backdrop — removing it and retrying");
      await page.evaluate(() => document.querySelector("#onetrust-consent-sdk")?.remove());
      await signUpButton.click();
    }

    const emailField = page.getByTestId("newsletter-sign-up-overlay-email-input");
    try {
      await emailField.waitFor({ state: "visible", timeout: 10000 });
    } catch {
      await log.warn("Newsletter modal did not open within 10s of clicking 'Sign up now'");
      return { status: "FAILED", message: "Newsletter modal did not open" };
    }
    await emailField.fill(profile.email);
    await log.info("Filled email");

    let checkedCount = 0;
    for (const testId of [
      "newsletter-sign-up-overlay-newsletter-option-holidays",
      "newsletter-sign-up-overlay-newsletter-option-touring",
      "newsletter-sign-up-overlay-newsletter-option-sales",
    ]) {
      const checkbox = page.getByTestId(testId);
      if ((await checkbox.count()) === 0) continue;
      if ((await checkbox.getAttribute("aria-checked")) !== "true") {
        await checkbox.click();
      }
      checkedCount += 1;
    }
    await log.info(`Selected ${checkedCount}/3 first-party newsletter topics (Holidays, Touring & Camping, Owning a Holiday Home)`);

    const submit = page.getByTestId("newsletter-sign-up-overlay-submit-button");
    if ((await submit.count()) === 0) {
      await log.warn("Newsletter submit button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    // Confirmed directly (live, on this exact domain's sibling competition
    // adapter): an invisible Cloudflare Turnstile check gates this submit
    // button with no visible widget to point a selector at, and errors
    // consistently in the console ("[Turnstile Error] 600010"), leaving the
    // button permanently disabled. Not solved or evaded.
    let turnstileErrorSeen = false;
    page.on("console", (msg) => {
      if (/turnstile error/i.test(msg.text())) turnstileErrorSeen = true;
    });

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    try {
      await submit.click({ timeout: 15000 });
    } catch {
      if (turnstileErrorSeen) {
        await log.warn("Submit button never became enabled — an invisible Cloudflare Turnstile check errored (console: '[Turnstile Error] 600010') and is blocking it. Not solved or evaded.");
        return { status: "FAILED", message: "Blocked by an invisible Cloudflare Turnstile check — not solved or evaded" };
      }
      await log.warn("Submit button never became enabled within 15s, for an unclear reason");
      return { status: "FAILED", message: "Submit control never became enabled" };
    }

    // Real confirmation copy wasn't discoverable statically (this modal's
    // feedback is injected client-side into `[data-testid="alerts-list"]`
    // only after a real AJAX submit) — matched broadly by wording, same
    // convention used elsewhere in this project when the exact text can't
    // be read without a live successful submission.
    const alerts = page.getByTestId("alerts-list");
    const success = alerts.getByText(/thank you|subscribed|signed up|success|welcome/i);
    const error = alerts.getByText(/already subscribed|invalid|error|something went wrong|please enter/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 15s after submit");
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
