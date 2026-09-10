import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Butlin's (butlins.com) — Bognor Regis/Minehead/Skegness resorts, first-
 * party footer "SUBSCRIBE TO EMAIL" widget. Real server-rendered React
 * (styled-components) markup: a single email input (#footer-form-email,
 * a plain <input>, no surrounding <form>) and a "SIGN ME UP" button that's
 * type="button" (its own click handler, not a native submit) — matched by
 * role/text rather than assuming a submit event fires. No separate
 * marketing checkbox; this widget's sole purpose is the opt-in, same as
 * adventureIsland.ts and devonsTopAttractions.ts. Checked butlins.com/
 * competitions directly: "Sorry, there are currently no competitions or
 * prize draws running" at time of writing — newsletter only for now.
 * OneTrust cookie banner, standard reject-all selector already used
 * elsewhere in this project. No confirmation/error copy found in the
 * static HTML — same "never default an errorless response to SUCCESS"
 * caution as haven.ts, fails loudly with whatever's actually observed.
 */
export const butlinsNewsletterAdapter: NewsletterAdapter = {
  key: "butlins-newsletter",
  siteName: "Butlin's",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load").catch(() => {});

    const dismissCookieBanner = async (timeout: number) => {
      const reject = page.locator("#onetrust-reject-all-handler");
      if (await reject.isVisible({ timeout }).catch(() => false)) {
        await reject.click();
        await page.locator("#onetrust-banner-sdk").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const emailField = page.locator("#footer-form-email");
    if ((await emailField.count()) === 0) {
      await log.warn("Expected newsletter email field (#footer-form-email) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await emailField.scrollIntoViewIfNeeded();
    await emailField.fill(profile.email);
    await log.info("Filled email");

    await dismissCookieBanner(3000);

    const submit = page.getByRole("button", { name: "SIGN ME UP", exact: true });
    if ((await submit.count()) === 0) {
      await log.warn("SIGN ME UP button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

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
