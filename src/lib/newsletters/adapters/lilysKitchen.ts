import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Lily's Kitchen (lilyskitchen.co.uk/pages/email-signup) — a standard
 * Shopify "customer" marketing form, confirmed directly from the real
 * static HTML: contact[email], contact[first_name], contact[last_name],
 * all required, plus a required `pet-type` <select> (Dog/Cat/Both) the
 * brand uses to segment its own list content, not a data-sharing consent.
 * "Dog" is selected deliberately — this project exists specifically to
 * track dog-related giveaways/newsletters (see README's standing dog-comp
 * priority), so this is the correct answer for this profile's own use of
 * the project, not a guessed or fabricated personal fact. Posts to
 * Shopify's shared /contact endpoint (POST/Redirect/GET back to the
 * referring page); this site renders its own success/error copy via
 * theme Liquid (`form.posted_successfully?`) which isn't visible from
 * static HTML, so matched broadly by wording on the page landed on,
 * same approach as theSuffolkCoast.ts.
 */
export const lilysKitchenNewsletterAdapter: NewsletterAdapter = {
  key: "lilys-kitchen-newsletter",
  siteName: "Lily's Kitchen",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });

    // CookieHub — fully client-rendered, no static markup to select against
    // ahead of time, so dismissed by its visible text rather than a guessed
    // selector, same principle as this project's other unknown-CMP cases.
    const dismissCookieBanner = async (timeout: number) => {
      const denyAll = page.getByRole("button", { name: /deny all|reject all|decline/i });
      if (await denyAll.first().isVisible({ timeout }).catch(() => false)) {
        await denyAll.first().click();
        await log.info("Dismissed cookie banner (denied non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("form#contact_form.marketing-form");
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter signup form (form#contact_form.marketing-form) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter signup form not found on page" };
    }

    await form.locator('input[name="contact[email]"]').fill(profile.email);
    await form.locator('input[name="contact[first_name]"]').fill(profile.firstName);
    await form.locator('input[name="contact[last_name]"]').fill(profile.lastName);
    await log.info("Filled email, first name, last name");

    // "Dog" — this project's whole reason for tracking this brand; see
    // module doc comment above, not a guessed personal fact.
    await form.locator('select[name="pet-type"]').selectOption("dog");
    await log.info("Selected pet type: Dog");

    await dismissCookieBanner(3000);

    const submit = form.locator("#Subscribe");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#Subscribe) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    const sourceHost = new URL(sourceUrl).hostname;
    const [response] = await Promise.all([
      page
        .waitForResponse(
          (r) => r.request().method() === "POST" && new URL(r.url()).hostname === sourceHost && r.url().includes("/contact"),
          { timeout: 15000 },
        )
        .catch(() => null),
      submit.click(),
    ]);

    if (!response) {
      await log.warn("Never observed a POST response for the newsletter signup submission");
      return { status: "FAILED", message: "No response observed for the form submission" };
    }

    if (response.status() >= 300 && response.status() < 400) {
      await log.info(`Form POST redirected (HTTP ${response.status()}) — standard Shopify Post/Redirect/Get completion path`);
      await page.waitForLoadState("domcontentloaded").catch(() => {});
    } else if (!response.ok()) {
      await log.warn(`Form POST returned HTTP ${response.status()}`);
      return { status: "FAILED", message: `Form submission returned HTTP ${response.status()}` };
    }

    const success = page.getByText(/thank you|thanks for subscribing|you're subscribed|successfully subscribed/i);
    const error = page.getByText(/error|invalid|already subscribed|something went wrong/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 10000 }),
        error.first().waitFor({ state: "visible", timeout: 10000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 10s after submit — treating the redirect itself as the confirmation (this site shows no distinct static confirmation copy)");
      return { status: "SUCCESS", message: "POST/Redirect/Get completed, no explicit confirmation copy found" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
