import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Coast Magazine's own newsletter signup (coastmagazine.co.uk/newsletter),
 * which embeds a dotdigital/Kelsey "Easy Editor" landing page — this
 * adapter navigates straight to that embedded form's own URL rather than
 * the magazine article wrapper, avoiding that page's separate Sourcepoint
 * cookie CMP entirely (same approach as coastMagazineSuffolkCoast.ts, and
 * confirmed to be a different, unprotected domain from the competition
 * entry's Cloudflare-fronted one). Two of Coast's own newsletters are
 * offered (Beachcomber, their general coastal-living newsletter, and Coast
 * Property, a separate property-focused one); only Beachcomber — the
 * general one this page is chiefly for — is opted into, since the person
 * only asked to be signed up for organisations' own newsletters, not every
 * distinct newsletter a publisher happens to run. A third, unrelated
 * checkbox ("receive promotional emails from Kelsey Publishing") is a
 * broader publisher-wide marketing consent, not this newsletter itself, so
 * it's left unticked.
 */
const SIGNUP_URL = "https://r1.dotdigital-pages.com/p/5D8F-341/newsletter-sign-up";

export const coastMagazineNewsletterAdapter: NewsletterAdapter = {
  key: "coast-magazine-newsletter",
  siteName: "Coast Magazine (Kelsey Media)",
  async subscribe({ page, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating directly to signup form: ${SIGNUP_URL}`);
    await page.goto(SIGNUP_URL, { waitUntil: "domcontentloaded" });

    const beachcomberYes = page.locator('input[name="10"][value="1"]');
    if ((await beachcomberYes.count()) === 0) {
      await log.warn("Expected newsletter form (radio name=10) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }
    await beachcomberYes.check();
    await log.info("Selected 'Subscribe to Beachcomber': YES — this page's chief purpose");

    await page.locator('input[name="12"][value="2"]').check();
    await log.info("Selected 'Subscribe to Coast Property': NO — a separate newsletter not requested");

    await page.locator('input[name="1"]').fill(profile.firstName);
    await page.locator('input[name="2"]').fill(profile.lastName);
    await page.locator('input[name="3"]').fill(profile.email);
    await log.info("Filled first name, surname, email");
    // Checkbox name=9 ("receive promotional emails from Kelsey Publishing")
    // deliberately left unticked — broader publisher marketing, not this
    // newsletter itself.

    // This dotdigital page engine's submit control is only made visible
    // once the visible required fields are filled, and different pages on
    // the same engine render it as either a <button> or an
    // <input type="submit"> with the same class — :visible picks out
    // whichever one is actually the real, clickable control right now.
    const submit = page.locator(".paging-button-submit:visible");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found or not yet visible");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // Same dotdigital landing-page engine as coastMagazineSuffolkCoast.ts —
    // that one navigates to a separate "thank-you" page on success rather
    // than showing inline text, so check for that too, not just inline
    // wording. This page's domain also runs a Cloudflare bot-management
    // script (visible as a challenge-platform request on load); if
    // neither signal appears, that's the most likely explanation — we
    // don't attempt to solve or evade that, just fail loudly.
    const success = page.getByText(/thank you|you're subscribed|you have been added|successfully subscribed/i);
    const error = page.getByText(/already subscribed|invalid|error|something went wrong|please answer/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
        page.waitForURL(/thank-you/i, { timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation page/message nor an error appeared within 15s after submit — possibly blocked by this domain's Cloudflare bot-management, which we don't attempt to evade");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (/thank-you/i.test(page.url()) || (await success.first().isVisible().catch(() => false))) {
      const text = (await page.locator("body").innerText().catch(() => "")).trim().split("\n")[0];
      await log.info(`Confirmation: ${text} (${page.url()})`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
