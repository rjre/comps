import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Butternut Box (dog-food subscription brand, butternutbox.com) — own
 * footer mailing-list signup ("If you like dogs and discounts, you'll
 * love our mailing list"), genuinely separate from their full dog-profile
 * quiz/checkout signup flow. Confirmed directly via curl of the real
 * static HTML: a React/MUI form (`[data-testid="footer-capture-form"]`),
 * single email field (`input[name="footer-capture-form-email"]`) — its
 * own id is MUI's auto-generated `_R_...`, which can change between
 * builds, so matched by the stable `name` attribute instead. Submit
 * button starts `type="button" disabled` and is only enabled client-side
 * once a valid email is typed — waited for rather than assumed. No
 * cookie-consent banner markers found in the static HTML. No CAPTCHA
 * present. Exact post-submit confirmation text isn't present in the
 * static bundle (client-rendered only), so matched broadly by wording,
 * same convention used elsewhere in this project when exact text can't
 * be read without a live successful submission.
 */
export const butternutBoxNewsletterAdapter: NewsletterAdapter = {
  key: "butternut-box-newsletter",
  siteName: "Butternut Box",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    const form = page.locator('[data-testid="footer-capture-form"]');
    if ((await form.count()) === 0) {
      await log.warn('Expected newsletter form ([data-testid="footer-capture-form"]) not found — page may have changed');
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    const emailField = form.locator('input[name="footer-capture-form-email"]');
    await emailField.fill(profile.email);
    await log.info("Filled email field");

    const submit = form.getByRole("button", { name: "Sign Up" });
    try {
      await page.waitForFunction(
        (el) => el instanceof HTMLButtonElement && !el.disabled,
        await submit.elementHandle(),
        { timeout: 10000 },
      );
    } catch {
      await log.warn("Sign Up button never became enabled — email may not have validated as expected");
      return { status: "FAILED", message: "Submit button stayed disabled after filling the form" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    const success = page.getByText(/thank|subscribed|you're (all )?signed up|success/i);
    const error = page.getByText(/already subscribed|invalid|error|something went wrong/i);
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
      await log.info(`Subscribed: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
