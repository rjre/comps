import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Kynren's own homepage newsletter widget ("Sign up to hear all the latest
 * news from Kynren") — a Dotdigital signup-widget form, distinct from the
 * competition form's own marketing checkbox (automation/adapters/kynren.ts).
 * Confirmed directly from the raw homepage HTML: email (required), a
 * required "Name" datafield, an optional "Post Code" datafield, and one
 * checkbox (list id 7519261) labelled "Receive News & Updates from Kynren"
 * — the one genuinely being opted into here. A second hidden field
 * (`dm_name`, display:none, tabindex=-1, autocomplete="new-password") is a
 * honeypot and is deliberately left untouched. Posts to this site's own
 * `/wp-json/dotdigital/v1/signup-widget` REST endpoint; the widget's own
 * `.form_messages` container is populated client-side with no stable
 * wording known ahead of time, so outcome is read from the raw HTTP
 * response to that endpoint instead, same approach as suffolkCoast.ts.
 */
export const kynrenNewsletterAdapter: NewsletterAdapter = {
  key: "kynren-newsletter",
  siteName: "Kynren",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });

    const dismissCookieBanner = async (timeout: number) => {
      const deny = page.locator(".cmplz-btn.cmplz-deny").first();
      if (await deny.isVisible({ timeout }).catch(() => false)) {
        await deny.click();
        await log.info("Dismissed cookie banner (denied non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("form.dotdigital-signup-form");
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter signup form (form.dotdigital-signup-form) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter signup form not found on page" };
    }

    const emailField = form.locator('input[name="email"]');
    const nameField = form.locator('input[name="datafields[FULLNAME][value]"]');
    const newsletterCheckbox = form.locator('input[name="lists[]"][value="7519261"]');

    if ((await emailField.count()) === 0 || (await nameField.count()) === 0 || (await newsletterCheckbox.count()) === 0) {
      await log.warn("Expected form fields not found — page may have changed");
      return { status: "FAILED", message: "Expected form fields not found on page" };
    }

    await emailField.fill(profile.email);
    await nameField.fill(`${profile.firstName} ${profile.lastName}`);
    if (profile.postalCode) {
      await form.locator('input[name="datafields[POSTCODE][value]"]').fill(profile.postalCode);
    }
    await log.info("Filled email, name" + (profile.postalCode ? ", postcode" : ""));
    // input[name="dm_name"] is a honeypot (CSS-hidden) — deliberately left untouched.

    await newsletterCheckbox.check();
    await log.info("Ticked 'Receive News & Updates from Kynren' checkbox");

    await dismissCookieBanner(3000);

    const submit = form.locator('button[name="dm_submit_btn"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    const [response] = await Promise.all([
      page
        .waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/wp-json/dotdigital/v1/signup-widget"), {
          timeout: 15000,
        })
        .catch(() => null),
      submit.click(),
    ]);

    if (!response) {
      await log.warn("Never observed a POST response for the newsletter signup submission");
      return { status: "FAILED", message: "No response observed for the form submission" };
    }
    if (!response.ok()) {
      await log.warn(`Form POST returned HTTP ${response.status()}`);
      return { status: "FAILED", message: `Form submission returned HTTP ${response.status()}` };
    }

    const bodyText = await response.text().catch(() => "");
    if (/error|invalid|fail/i.test(bodyText)) {
      await log.warn(`Signup endpoint response indicates failure: ${bodyText.slice(0, 300)}`);
      return { status: "FAILED", message: `Form rejected submission: ${bodyText.slice(0, 300)}` };
    }

    await log.info(`Signup endpoint returned HTTP 200 with no error wording — treating as accepted: ${bodyText.slice(0, 200)}`);
    return { status: "SUCCESS", message: "HTTP 200, no error wording in response" };
  },
};
