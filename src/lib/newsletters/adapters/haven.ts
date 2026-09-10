import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Haven (haven.com) — ~30 UK holiday parks, including Mersea Island, Essex.
 * A real Next.js/React SSR footer widget ("Get the latest Haven exclusives!"):
 * a single email input (#textInputemail), no separate marketing checkbox —
 * the consent text underneath states that providing the address itself is
 * the opt-in, which is this form's whole purpose. No live no-purchase-
 * necessary Haven competition found on haven.com at time of writing —
 * newsletter only. No confirmation/error copy was present anywhere in the
 * static HTML/bundles (Next.js client component, text likely lives in a
 * lazy-loaded chunk) — same caution as bauer-competition-form and
 * fateAndFortune.ts: never default an errorless response to SUCCESS, fail
 * loudly with whatever DOM change (or lack of one) is observed so a real
 * run's log can tighten this.
 */
export const havenNewsletterAdapter: NewsletterAdapter = {
  key: "haven-newsletter",
  siteName: "Haven",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    // Heavy React homepage — wait for the full load event (and whatever
    // consent-management/analytics scripts it drags in) before touching
    // anything, same caution as adventureIsland.ts.
    await page.waitForLoadState("load").catch(() => {});

    // No cookie-consent banner was present anywhere in the static HTML or
    // bundle references (checked directly), but one may still be injected
    // by a tag-manager script at runtime — dismiss defensively if it shows
    // up rather than assume its absence.
    const dismissCookieBanner = async (timeout: number) => {
      const reject = page.getByRole("button", { name: /reject all|reject non-essential|decline/i });
      if (await reject.first().isVisible({ timeout }).catch(() => false)) {
        await reject.first().click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(8000);

    const emailField = page.locator("#textInputemail");
    if ((await emailField.count()) === 0) {
      await log.warn("Expected newsletter email field (#textInputemail) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await emailField.scrollIntoViewIfNeeded();
    await emailField.fill(profile.email);
    await log.info("Filled email");

    await dismissCookieBanner(3000);

    const submit = page.locator("form:has(#textInputemail) button[type='submit']");
    if ((await submit.count()) === 0) {
      await log.warn("Sign up button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // No confirmation/error wording could be confirmed from static content
    // (see docblock) — wait for *something* to change (the email field
    // clearing/disabling, or any text mentioning success/error appearing
    // near the form) and log exactly what happened rather than guess.
    const success = page.getByText(/thank you|you're subscribed|you have been subscribed|check your inbox/i);
    const error = page.getByText(/something went wrong|please try again|invalid email|error submitting/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 20000 }),
        error.first().waitFor({ state: "visible", timeout: 20000 }),
        emailField.waitFor({ state: "hidden", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("No confirmation or error text appeared, and the form didn't visibly change, within 20s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await error.first().isVisible().catch(() => false)) {
      const errorText = (await error.first().innerText().catch(() => "")).trim();
      await log.warn(`Newsletter form error: ${errorText}`);
      return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
    }

    const successText = (await success.first().innerText().catch(() => "")).trim();
    await log.info(`Subscribed${successText ? `: ${successText}` : " (email field disappeared after submit, no error shown)"}`);
    return { status: "SUCCESS", message: successText || "Form submitted, no error shown" };
  },
};
