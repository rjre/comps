import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Burns Pet Nutrition (burnspet.co.uk) — dog-food brand's own footer
 * newsletter widget, confirmed directly via curl of the real static HTML:
 * Shopify's native "customer" contact form (`form_type=customer`,
 * `contact[tags]=newsletter`), a single email field
 * (`input[name="contact[email]"]`), no marketing checkbox to leave
 * unticked (the form's only purpose is this newsletter). A plain
 * full-page POST to `/contact` (Post/Redirect/Get), not AJAX — no exact
 * confirmation copy was found in the static HTML since Shopify injects it
 * server-side only after a real submit, so this matches the same
 * convention as theSuffolkCoast.ts/diggerland.ts: a POST that completes
 * without a visible error list is treated as accepted. No CAPTCHA present
 * in the static markup.
 */
export const burnsPetNutritionNewsletterAdapter: NewsletterAdapter = {
  key: "burns-pet-nutrition-newsletter",
  siteName: "Burns Pet Nutrition",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    const form = page.locator("#contact_form");
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter form (#contact_form) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    const emailField = form.locator('input[name="contact[email]"]');
    await emailField.fill(profile.email);
    await log.info("Filled email field");

    const submit = form.locator('button[type="submit"], input[type="submit"]').first();
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
