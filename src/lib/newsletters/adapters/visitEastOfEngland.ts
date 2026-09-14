import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Visit East of England's own newsletter — org already tracked in this
 * project for its competitions (visit-east-of-england adapter, three
 * prize draws on visiteastofengland.com's own Freeform widget) but this is
 * a genuinely separate first-party signup: a Mailchimp "Pages" hosted
 * landing page at mailchi.mp/visiteastofengland.com/sign-up.
 *
 * Confirmed directly (not guessed): this page renders its form fields
 * client-side via a "mojo/pages-signup-forms/Loader" widget that fetches
 * its own JSON config from
 * mc.us18.list-manage.com/signup-form/settings?u=e9da39dab7d1720389198e929&id=0054b0e6f0
 * — fetched that config directly and read its real `fields` array: only
 * EMAIL is actually required ("req": true); FNAME/LNAME/MMERGE5 (Full
 * Name)/MMERGE6 (Full address 2) are all optional and left blank rather
 * than fabricated. `captchaEnabled` is false and `usePost` is true (a real
 * form POST, standard Mailchimp hosted-page behaviour) — no honeypot
 * field is filled. No separate marketing-consent checkbox exists anywhere
 * in this config; the page's whole purpose is this one newsletter opt-in.
 *
 * Caveat: this session's sandbox could only fetch the static page and its
 * JSON config via curl, not render the live JS that turns that config
 * into real DOM input elements — Mailchimp's own widget renders each
 * configured field as a plain `<input name="EMAIL">`-style element (the
 * same convention already used by every other Mailchimp adapter in this
 * project), so fields are matched by that name attribute rather than a
 * guessed id, and the adapter fails loudly if the widget hasn't finished
 * rendering them. Worth a human's eyes on the first live run to confirm
 * the rendered markup matches what the config implies.
 */
export const visitEastOfEnglandNewsletterAdapter: NewsletterAdapter = {
  key: "visit-east-of-england-newsletter",
  siteName: "Visit East of England",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });

    // The signup form is injected client-side by a Mailchimp "Pages"
    // widget after the static page loads — give it a moment, then wait
    // for the real email input rather than assuming a fixed delay is
    // enough.
    const emailField = page.locator('input[name="EMAIL"]');
    const appeared = await emailField
      .first()
      .waitFor({ state: "visible", timeout: 15000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared) {
      await log.warn("Expected email field (input[name=EMAIL]) never appeared — the client-side signup widget may not have rendered, or the page has changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await emailField.first().fill(profile.email);
    const firstNameField = page.locator('input[name="FNAME"]');
    if (await firstNameField.count()) {
      await firstNameField.first().fill(profile.firstName);
    }
    const lastNameField = page.locator('input[name="LNAME"]');
    if (await lastNameField.count()) {
      await lastNameField.first().fill(profile.lastName);
    }
    await log.info("Filled email, first name, last name (only email is actually required by this form's own config)");

    const submit = page.getByRole("button", { name: /subscribe|sign up|sign me up/i }).or(page.locator('input[type="submit"]'));
    if ((await submit.count()) === 0) {
      await log.warn("Submit control not found on the rendered signup form");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.first().click();

    const success = page.getByText(/thank you|almost finished|check your (inbox|email)|confirm your subscription|you'?re (in|subscribed)|success/i);
    const error = page.getByText(/already subscribed|invalid|error|something went wrong|please enter/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 20000 }),
        error.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 20s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Subscribed: ${text} (Mailchimp — likely double opt-in, a confirmation email may still need to be clicked)`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText || "unknown error"}` };
  },
};
