import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Visit Essex's own e-newsletter signup page
 * (visitessex.com/inspire-me/enewsletter-sign-up) — a standalone NewMind/
 * eCMS form, entirely separate from the "Submit Answers" competition-entry
 * form on visitEssexGardenersWorld.ts (same underlying CMS, different form
 * instance/id). Its one consent checkbox ("I would like to receive the
 * Visit Essex e-newsletter") is deliberately ticked here — this page's
 * whole purpose is that opt-in, unlike the same checkbox's twin on the
 * competition entry form, which stays unticked there. No other
 * marketing/data-sharing checkboxes are present. Submitted via AJAX
 * (NewMind.ETWP.Forms.AjaxPostBack) — the confirmation text is injected
 * client-side rather than present in the static page, so matched by
 * wording, not a guessed selector.
 */
export const visitEssexNewsletterAdapter: NewsletterAdapter = {
  key: "visit-essex-newsletter",
  siteName: "Visit Essex",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    const form = page.locator("form.form66803");
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter sign-up form (form.form66803) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    if (!profile.addressLine1 || !profile.city || !profile.region || !profile.postalCode) {
      await log.warn("Profile is missing address fields (addressLine1/city/region/postalCode) required by this form");
      return { status: "FAILED", message: "Profile missing address fields required by this form" };
    }

    // Title has no equivalent in our Profile model, but this select
    // defaults to a blank option and isn't marked required — same as
    // suffolkCoast.ts's Title dropdown, leave it at its default.
    await log.info("Profile has no title field — leaving the form's default (blank) Title selection as-is");

    await page.locator("#forename_66803").fill(profile.firstName);
    await page.locator("#surname_66803").fill(profile.lastName);
    await page.locator("#email_66803").fill(profile.email);
    await page.locator("#email2_66803").fill(profile.email);
    await page.locator("#address1_66803").fill(profile.addressLine1);
    if (profile.addressLine2) {
      await page.locator("#address2_66803").fill(profile.addressLine2);
    }
    await page.locator("#address4_66803").fill(profile.city);
    await page.locator("#address5_66803").fill(profile.region);
    await page.locator("#postcode_66803").fill(profile.postalCode);
    // Country select already defaults to "United Kingdom" — left as-is.
    await log.info("Filled name, email, address, postcode");

    const consentCheckbox = page.locator('input[name="consentstatementsaccepted"][value="8081"]');
    if ((await consentCheckbox.count()) === 0) {
      await log.warn("Expected newsletter consent checkbox not found — page may have changed");
      return { status: "FAILED", message: "Consent checkbox not found on page" };
    }
    await consentCheckbox.check();
    await log.info("Ticked 'I would like to receive the Visit Essex e-newsletter' — this page's sole purpose");

    const submit = form.locator('input[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found in newsletter form");
      return { status: "FAILED", message: "Submit button not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // AJAX postback (NewMind.ETWP.Forms.AjaxPostBack) — confirmation/error
    // text is injected after submit, not present in the static page, so
    // match by wording rather than a guessed selector.
    const success = page.getByText(/thank you|you're subscribed|you have been added|successfully subscribed/i);
    const error = page.getByText(/already subscribed|invalid|error|something went wrong|please enter/i);
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
