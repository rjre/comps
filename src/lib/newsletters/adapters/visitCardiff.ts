import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Visit Cardiff's own sitewide "STAY IN TOUCH" newsletter widget
 * (visitcardiff.com) — a Mailchimp-backed form embedded in a modal
 * (data-modal="register") triggered by a "Sign Up Today" link, confirmed
 * present identically on both the homepage and the org's CMCF/Llais
 * competition page (the same lead that turned up this org — that
 * competition's own entry form is a JS-driven multi-page SnapSurveys
 * flow this project can't inspect without a live browser render, so it's
 * not built as a competition; this newsletter is a genuinely separate,
 * fully static, first-party form). Required: First Name, Surname, Email,
 * and a single checkbox ("Tick this box to receive emails from Visit
 * Cardiff...") that IS this form's entire purpose, not a bundled
 * marketing opt-in, so it's ticked deliberately. No cookie-consent banner
 * was present in the static HTML — worth a human's eyes on the first
 * live run in case one renders client-side.
 *
 * Submit is a Google reCAPTCHA v2 "invisible" button (a real <button
 * class="g-recaptcha"> with a data-callback, not a plain submit) —
 * usually completes silently, only rendering a visible challenge for
 * suspicious traffic. Not solved or evaded: the adapter checks for a
 * rendered challenge iframe after clicking and fails loudly if one
 * appears, same as the "on-demand" reCAPTCHA already handled on
 * fredOlsenCruises.ts.
 */
export const visitCardiffNewsletterAdapter: NewsletterAdapter = {
  key: "visit-cardiff-newsletter",
  siteName: "Visit Cardiff",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load" });

    const trigger = page.locator('a.ModalTrigger[data-modal="register"]').first();
    if ((await trigger.count()) === 0) {
      await log.warn("Expected 'Sign Up Today' newsletter trigger (a.ModalTrigger[data-modal=register]) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter signup trigger not found on page" };
    }
    await trigger.click();
    await log.info("Opened the newsletter signup modal");

    const form = page.locator("#NewsletterWidget form");
    if ((await form.first().isVisible({ timeout: 5000 }).catch(() => false)) === false) {
      await log.warn("Newsletter form (#NewsletterWidget form) did not become visible after opening the modal");
      return { status: "FAILED", message: "Newsletter form not visible after opening modal" };
    }

    await form.locator("#NewsletterWidget-_name").fill(profile.firstName);
    await form.locator("#NewsletterWidget-_surname").fill(profile.lastName);
    await form.locator("#NewsletterWidget-_email").fill(profile.email);
    await log.info("Filled first name, surname, email");

    // The sole checkbox on this form ("Tick this box to receive emails from
    // Visit Cardiff...") is the newsletter's own opt-in, not a bundled
    // marketing consent — ticked deliberately, same reasoning as
    // visitEssex.ts.
    await form.locator("#NewsletterWidget-_signup").check();
    await log.info("Ticked the newsletter opt-in checkbox");

    const submit = form.locator("button.g-recaptcha");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (button.g-recaptcha) not found in newsletter form");
      return { status: "FAILED", message: "Submit button not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    const sourceHost = new URL(sourceUrl).hostname;
    const [response] = await Promise.all([
      page
        .waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).hostname === sourceHost, { timeout: 20000 })
        .catch(() => null),
      submit.click(),
    ]);

    // Invisible reCAPTCHA renders a real challenge iframe only for
    // suspicious-looking traffic — not solved or evaded, fail loudly if one
    // shows up rather than guess at whether it blocked the submission.
    const challengeFrame = page.frameLocator('iframe[title="recaptcha challenge expires in two minutes"]').locator("body");
    if (await challengeFrame.isVisible({ timeout: 3000 }).catch(() => false)) {
      await log.warn("A visible reCAPTCHA challenge appeared — not solving or evading it");
      return { status: "FAILED", message: "Blocked by a visible reCAPTCHA challenge" };
    }

    if (!response) {
      await log.warn("Never observed a POST response for the newsletter signup submission");
      return { status: "FAILED", message: "No response observed for the form submission" };
    }
    if (!response.ok() && !(response.status() >= 300 && response.status() < 400)) {
      await log.warn(`Form POST returned HTTP ${response.status()}`);
      return { status: "FAILED", message: `Form submission returned HTTP ${response.status()}` };
    }

    // No confirmation copy is present in the static page (it's presumably
    // injected server-side into the re-rendered page after a successful
    // post), so match broadly by wording rather than a guessed selector,
    // same approach as other newsletter adapters in this project.
    const success = page.getByText(/thank you|you're subscribed|successfully subscribed|you have been added/i);
    const error = page.getByText(/already subscribed|invalid|error|something went wrong/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 10000 }),
        error.first().waitFor({ state: "visible", timeout: 10000 }),
      ]);
    } catch {
      await log.info("No explicit confirmation or error text appeared after submit — treating the accepted POST as success (no active validation error observed)");
      return { status: "SUCCESS", message: `HTTP ${response.status()}, no error message observed after submit` };
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
