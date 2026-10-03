import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Animology (dog shampoo/grooming brand, animology.co.uk) — own footer
 * newsletter widget, confirmed directly via curl of the real static HTML:
 * same Shopify native "customer" contact form family as Burns Pet
 * Nutrition (burnsPetNutrition.ts) — `form_type=customer`,
 * `contact[tags]=newsletter`, a single email field
 * (`input[name="contact[email]"]`), no marketing checkbox. Plain
 * full-page POST to `/contact` (Post/Redirect/Get); same "no visible
 * error after submit = accepted" convention as that sibling adapter and
 * theSuffolkCoast.ts/diggerland.ts, since no exact confirmation text is
 * present in the static HTML. No CAPTCHA present in the static markup.
 */
export const animologyNewsletterAdapter: NewsletterAdapter = {
  key: "animology-newsletter",
  siteName: "Animology",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    const emailField = page.locator('input[name="contact[email]"]').first();
    if ((await emailField.count()) === 0) {
      await log.warn("Expected newsletter email field (input[name=\"contact[email]\"]) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }
    const form = page.locator("form", { has: emailField }).first();

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
