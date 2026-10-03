import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Ruffwear (dog outdoor-gear brand, ruffwear.com) — own footer newsletter
 * widget ("Join The Pack"), confirmed directly via curl of the real
 * static HTML: same Shopify native "customer" contact form family as
 * burnsPetNutrition.ts/animology.ts — a single email field
 * (`input[name="contact[email]"]`), no marketing checkbox — but unlike
 * those siblings this form has no `contact[tags]=newsletter` hidden
 * field, so whichever Shopify list/tag it lands in is this form's own
 * default (confirmed directly there's no second, broader-sharing field to
 * worry about). Plain full-page POST to `/contact` (Post/Redirect/Get);
 * same "no visible error after submit = accepted" convention as those
 * siblings, since no exact confirmation text is present in the static
 * HTML. No CAPTCHA present in the static markup.
 *
 * Cookie consent is Osano (osano.com widget script, confirmed directly —
 * only the floating trigger icon is in the static HTML, the dialog itself
 * is rendered by Osano's own JS at runtime so its exact button markup
 * can't be read statically). Dismissed defensively by matching a "Deny"
 * button by its visible text within Osano's own dialog container, rather
 * than a guessed class name.
 */
export const ruffwearNewsletterAdapter: NewsletterAdapter = {
  key: "ruffwear-newsletter",
  siteName: "Ruffwear",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    // Osano CMP — can render after this first check, so called again right
    // before the submit click below too.
    const dismissCookieBanner = async (timeout: number) => {
      const deny = page.locator(".osano-cm-dialog").getByRole("button", { name: /^deny/i });
      if (await deny.first().isVisible({ timeout }).catch(() => false)) {
        await deny.first().click();
        await log.info("Dismissed cookie banner (denied non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const emailField = page.locator("#footer-newsletter-email-footer");
    if ((await emailField.count()) === 0) {
      await log.warn("Expected newsletter email field (#footer-newsletter-email-footer) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }
    const form = page.locator("form.newsletter").first();

    await emailField.fill(profile.email);
    await log.info("Filled email field");

    await dismissCookieBanner(3000);

    const submit = form.locator('button[type="submit"]').first();
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found in newsletter form");
      return { status: "FAILED", message: "Submit button not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    const sourceHost = new URL(sourceUrl).hostname;
    const [response] = await Promise.all([
      page
        .waitForResponse(
          (r) => r.request().method() === "POST" && new URL(r.url()).hostname === sourceHost,
          { timeout: 15000 },
        )
        .catch(() => null),
      submit.click(),
    ]);

    if (!response) {
      await log.warn("Never observed a POST response for the newsletter signup submission");
      return { status: "FAILED", message: "No response observed for the form submission" };
    }

    if (!response.ok() && !(response.status() >= 300 && response.status() < 400)) {
      await log.warn(`Form POST returned HTTP ${response.status()}`);
      return { status: "FAILED", message: `Form submission returned HTTP ${response.status()}` };
    }

    await page.waitForLoadState("domcontentloaded").catch(() => {});
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const errorMatch = bodyText.match(/not a valid email|already (a )?subscri|error[^.\n]{0,80}/i);
    if (errorMatch) {
      await log.warn(`Form appears to have rejected submission: ${errorMatch[0]}`);
      return { status: "FAILED", message: `Form rejected submission: ${errorMatch[0]}` };
    }

    await log.info("Form POST completed with no visible error — treating as accepted (this site shows no explicit confirmation text)");
    return { status: "SUCCESS", message: "HTTP response OK, no error text present after submit" };
  },
};
