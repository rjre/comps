import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Visit Devon's county-wide eNewsletter signup
 * (visitdevon.co.uk/visitor-information/more-information/enewsletter-sign-up/),
 * genuinely distinct from the already-tracked Visit North Devon newsletter
 * (visitNorthDevon.ts) — confirmed directly this is a different
 * NewMindMedia list (eKey 26620 here vs. North Devon's own) served from a
 * different embed path on the same visitdevon-ws.newmindmedia.com host,
 * not a duplicate of it.
 *
 * Same cross-origin <iframe> pattern as visitNorthDevon.ts, but this
 * installation's field names are per-form obfuscated hashes (confirmed
 * directly from the live form's own markup, not reused from any sibling
 * site) and it asks for a full postal address, matching the fuller
 * NewMindMedia shape also seen on suffolkCoast.ts. Only one consent
 * checkbox exists here (value=4311, this newsletter's own opt-in) — no
 * separate SMS/third-party checkboxes like North Devon's form has. A
 * separate list of ~9 "I am interested in" topic checkboxes are content
 * preferences, not consent, so left untouched. Protected by invisible
 * reCAPTCHA v3 (ReCaptchaAttachV3OnSubmit) — not solved or evaded, just
 * submitted normally.
 */
export const visitDevonNewsletterAdapter: NewsletterAdapter = {
  key: "visit-devon-newsletter",
  siteName: "Visit Devon",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2500);

    const dismissCookieBanner = async (timeout: number) => {
      const reject = page.locator("#cookiescript_reject");
      if (await reject.isVisible({ timeout }).catch(() => false)) {
        await reject.click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const formFrameLocator = page.locator("iframe#embedForm");
    if ((await formFrameLocator.count()) === 0) {
      await log.warn("No embedded newsletter form iframe (#embedForm) found on the page — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }
    const form = page.frameLocator("iframe#embedForm").first();

    if (!profile.addressLine1 || !profile.city || !profile.region || !profile.postalCode) {
      await log.warn("Profile is missing address fields (addressLine1/city/region/postalCode) required by this form");
      return { status: "FAILED", message: "Profile missing address fields required by this form" };
    }

    const forename = form.locator("#forename_37512");

    if (!profile.title) {
      await log.info("Profile has no title set — leaving the form's default (blank) Title selection as-is");
    } else {
      const titleSelect = form.locator("#title_37512");
      const hasOption = (await titleSelect.locator(`option[value="${profile.title}"]`).count()) > 0;
      if (hasOption) {
        await titleSelect.selectOption(profile.title);
        await log.info(`Selected title: ${profile.title}`);
      } else {
        await log.info(`Profile title "${profile.title}" isn't one of this form's options — leaving the default`);
      }
    }

    await forename.fill(profile.firstName);
    await form.locator("#surname_37512").fill(profile.lastName);
    await form.locator("#email_37512").fill(profile.email);
    await form.locator("#email2_37512").fill(profile.email);
    await form.locator("#address1_37512").fill(profile.addressLine1);
    if (profile.addressLine2) {
      await form.locator("#address2_37512").fill(profile.addressLine2);
    }
    await form.locator("#address4_37512").fill(profile.city);
    await form.locator("#address5_37512").fill(profile.region);
    await form.locator("#postcode_37512").fill(profile.postalCode);
    await log.info("Filled forename, surname, email, confirm email, address, town, county, postcode");

    if (profile.country) {
      const countrySelect = form.locator("#country_37512");
      const hasOption = (await countrySelect.locator(`option`, { hasText: profile.country }).count()) > 0;
      if (hasOption) {
        await countrySelect.selectOption({ label: profile.country });
        await log.info(`Selected country: ${profile.country}`);
      } else {
        await log.info(`Profile country "${profile.country}" isn't one of this form's options — leaving the default`);
      }
    } else {
      await log.info("Profile has no country set — leaving the form's default Country selection as-is");
    }

    // The "I am interested in" topic checkboxes (History & Heritage, Food
    // & Drink, ...) are content preferences, not consent — left unticked.

    await dismissCookieBanner(3000);

    const consent = form.locator('input[name="consentstatementsaccepted"][value="4311"]');
    if ((await consent.count()) === 0) {
      await log.warn("Expected consent checkbox (value=4311) not found — page may have changed");
      return { status: "FAILED", message: "Consent checkbox not found on page" };
    }
    await consent.check();
    await log.info("Ticked 'I agree to be contacted by Visit Devon' — this page's sole purpose");

    const submit = form.locator('input[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found in newsletter form");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // Same platform as visitNorthDevon.ts's newsletter — AJAX-injected
    // confirmation/error text, not present in the static page, so matched
    // by wording with a generous timeout (reCAPTCHA v3 can add real delay
    // before the POST resolves).
    const success = form.getByText(/thank you|you're subscribed|you have been added|successfully subscribed/i);
    const error = form.getByText(/already subscribed|invalid|error|something went wrong|please enter/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 30000 }),
        error.first().waitFor({ state: "visible", timeout: 30000 }),
      ]);
    } catch {
      await log.warn("Neither a success nor error message appeared within 30s after submit");
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
