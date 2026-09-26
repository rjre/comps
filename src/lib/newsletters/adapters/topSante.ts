import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Top Sante's own newsletter (published by Kelsey Media, distinct from the
 * Future PLC titles this project already tracks) — a Dotdigital-hosted
 * landing page (r1.dotdigital-pages.com), not a form embedded on
 * topsante.co.uk itself. Confirmed directly by reading the page's own
 * embedded JSON config and raw field markup: a single-page Angular
 * ("landingPageApp") survey form with fixed, non-randomised field ids.
 *
 * Field "11" (radio, id 11_1/11_2, dataField TOP_SANTE_NL) is a required
 * "Click YES to subscribe" question — this IS the newsletter opt-in itself,
 * not a marketing add-on, so answering YES is the whole point of this
 * adapter. Two separate things on the same page are deliberately left
 * alone: checkbox "14" ("sign up to the Top Sante reader panel" — a
 * distinct research-panel signup) and checkbox "13"/"4728570" ("Receive
 * promotional emails from Kelsey Publishing", under an "Get more offers"
 * fieldset) — both broader than this one newsletter, same category this
 * project already leaves unticked elsewhere (c.f. futurePlcNewsletter.ts's
 * CONTACT_OTHER_BRANDS/CONTACT_PARTNERS).
 *
 * No cookie-consent banner appears in this page's real (post-hydration)
 * render — confirmed directly, nothing to dismiss.
 *
 * Submission is Angular-driven (ng-submit, not a native form post) and the
 * server renders a real <script src="/cdn-cgi/challenge-platform/..."> —
 * Cloudflare is present on this host but never showed an interactive
 * challenge across repeated page loads; if it ever does block submission
 * for real, this fails loudly there rather than guessing around it. The
 * page swaps in its own "Thank you for signing up!" confirmation text
 * client-side on success (read directly out of the page's embedded
 * confirmation container) rather than navigating away.
 */
export const topSanteNewsletterAdapter: NewsletterAdapter = {
  key: "top-sante-newsletter",
  siteName: "Top Sante",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });
    // Single-page Angular app — the visible submit control only exists
    // once it has hydrated (the raw server HTML has a plain type="submit"
    // input; hydration swaps in a type="button" one and hides the
    // original), confirmed directly across repeated loads.
    await page.waitForTimeout(2000);

    const subscribeYes = page.locator("#11_1");
    if ((await subscribeYes.count()) === 0) {
      await log.warn("Expected 'Click YES to subscribe' radio (#11_1) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }
    await subscribeYes.check();
    await log.info("Answered YES to 'Click YES to subscribe' (the newsletter opt-in itself)");

    await page.locator("#textbox-1").fill(profile.firstName);
    await page.locator("#textbox-2").fill(profile.lastName);
    await page.locator("#textbox-3").fill(profile.email);
    await log.info("Filled first name, surname and email");
    // Checkbox "14" (Top Sante reader panel) and checkbox "13"/"4728570"
    // ("Receive promotional emails from Kelsey Publishing") deliberately
    // left unticked — both are broader than this newsletter itself.

    const submit = page.getByRole("button", { name: "Submit", exact: true });
    if ((await submit.count()) === 0) {
      await log.warn("Submit control not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // The page's own embedded confirmation copy, read directly rather than
    // guessed — no distinct error state is exposed by this landing-page
    // type beyond the client-side "required" validation already satisfied
    // above, so a stalled confirmation is reported as unclear rather than
    // assumed to be a rejection.
    const success = page.getByText(/thank you for signing up/i);
    try {
      await success.first().waitFor({ state: "visible", timeout: 30000 });
    } catch {
      await log.warn("No confirmation appeared within 30s after submit");
      return { status: "FAILED", message: "No confirmation appeared after submit — outcome unclear" };
    }

    const text = (await success.first().innerText().catch(() => "")).trim();
    await log.info(`Subscribed: ${text}`);
    return { status: "SUCCESS", message: text || undefined };
  },
};
