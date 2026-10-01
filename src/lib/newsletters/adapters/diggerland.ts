import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Diggerland UK (diggerland.com/newsletter-signup/) — first-party
 * newsletter, separate from the diggerland-prize-draw competition entry
 * (a different form on a different page, /prize-draw/). Confirmed
 * directly from the served HTML: a self-hosted Sendy form posting
 * cross-origin to diggerland.ovh/sendy/subscribe — name, email, and a
 * GDPR marketing-consent checkbox that IS this form's whole purpose
 * ("I give my consent to Diggerland to be in touch with me... for the
 * purpose of news, updates and marketing"), ticked here since this is
 * the newsletter adapter (the no-auto-consent rule is about not ticking
 * this kind of box on a *competition* form, not about refusing to
 * subscribe when that's the explicit point of the page). A text
 * honeypot field (`#hp`), visually hidden via an inline
 * `style="display:none"` wrapper rather than `type="hidden"`, is left
 * untouched. No reCAPTCHA on this specific form (the site bundles a
 * Contact Form 7 reCAPTCHA plugin site-wide, same as already documented
 * on the prize-draw adapter, but this Sendy form's own markup carries no
 * captcha div) — fails loudly if one ever appears rather than solving it.
 *
 * The form is a plain (non-AJAX) POST to a different origin, so a
 * successful submit navigates the browser to diggerland.ovh and the
 * response body *is* Sendy's own plain-text output — not a
 * Diggerland-specific confirmation string. Sendy's own documented output
 * set is small and stable across every Sendy installation (it's the
 * tool's hardcoded API/`subscribe.php` response, not page copy someone
 * wrote): "1" for a fresh single-opt-in subscribe, a message containing
 * "confirm" for a double-opt-in list pending email confirmation, "Already
 * subscribed." if the address is already on the list, or an "Error: ..."
 * string otherwise. Matched against those directly rather than guessed
 * site-specific wording.
 */
export const diggerlandNewsletterAdapter: NewsletterAdapter = {
  key: "diggerland-newsletter",
  siteName: "Diggerland UK",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });

    // Same Complianz (WordPress GDPR plugin) cookie banner as the
    // prize-draw competition page on this site.
    const dismissCookieBanner = async (timeout: number) => {
      const deny = page.locator("button.cmplz-deny");
      if (await deny.first().isVisible({ timeout }).catch(() => false)) {
        await deny.first().click();
        await log.info("Dismissed cookie banner (denied non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const nameField = page.locator("form[action*='diggerland.ovh'] input#name");
    const emailField = page.locator("form[action*='diggerland.ovh'] input#email");
    if ((await nameField.count()) === 0 || (await emailField.count()) === 0) {
      await log.warn("Expected Sendy newsletter form (input#name/#email inside the diggerland.ovh form) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    const fullName = profile.firstName ? `${profile.firstName} ${profile.lastName}` : profile.lastName;
    await nameField.fill(fullName);
    await emailField.fill(profile.email);
    await log.info("Filled name and email");

    const honeypot = page.locator("form[action*='diggerland.ovh'] input#hp");
    if ((await honeypot.count()) > 0) {
      const value = await honeypot.inputValue().catch(() => "");
      if (value) {
        await log.warn("Honeypot field #hp is unexpectedly non-empty — leaving as-is rather than clearing it blind");
      }
    }

    const gdprCheckbox = page.locator("form[action*='diggerland.ovh'] input#gdpr");
    if ((await gdprCheckbox.count()) === 0) {
      await log.warn("Expected marketing-consent checkbox (#gdpr) not found — page may have changed");
      return { status: "FAILED", message: "Consent checkbox not found" };
    }
    await gdprCheckbox.check();
    await log.info("Ticked the newsletter's own marketing-consent checkbox (this form's sole purpose)");

    await dismissCookieBanner(3000);

    const captcha = page.locator("form[action*='diggerland.ovh'] .g-recaptcha, form[action*='diggerland.ovh'] iframe[src*='recaptcha']");
    if (await captcha.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      await log.warn("A reCAPTCHA widget appeared on this form — not solving it, failing loudly");
      return { status: "FAILED", message: "reCAPTCHA present on submit — not solved or evaded" };
    }

    const submit = page.locator("form[action*='diggerland.ovh'] input[type='submit']#submit");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#submit) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    const [response] = await Promise.all([
      page
        .waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).hostname === "www.diggerland.ovh", { timeout: 20000 })
        .catch(() => null),
      submit.click(),
    ]);

    if (!response) {
      await log.warn("Never observed the Sendy subscribe POST response");
      return { status: "FAILED", message: "No response observed for the form submission" };
    }

    if (!response.ok()) {
      await log.warn(`Sendy subscribe endpoint returned HTTP ${response.status()}`);
      return { status: "FAILED", message: `Form submission returned HTTP ${response.status()}` };
    }

    const body = (await response.text().catch(() => "")).trim();
    await log.info(`Sendy subscribe response: ${body}`);

    if (body === "1" || /already subscribed/i.test(body)) {
      return { status: "SUCCESS", message: body };
    }
    if (/confirm/i.test(body)) {
      return { status: "SUCCESS", message: `Double opt-in pending: ${body}` };
    }

    await log.warn(`Unrecognised Sendy response, treating as a failure rather than assuming success: ${body}`);
    return { status: "FAILED", message: `Form rejected submission: ${body || "empty response"}` };
  },
};
