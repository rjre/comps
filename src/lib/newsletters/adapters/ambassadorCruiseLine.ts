import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Ambassador Cruise Line's own mailing-list signup
 * (ambassadorcruiseline.com/mailing-list/) — a Vue/Nuxt page built with
 * Radix Vue form components. Every control is a custom widget: text
 * inputs are plain, but the "would you like communications by post?"
 * question, the age-range question, and the marketing-consent control are
 * all rendered as a visually-styled `<button role="radio">` /
 * `<button role="checkbox">` with a real, visually-hidden native
 * `<input>` behind it — same hidden-control-behind-label shape as the
 * ASP.NET WebForms sites elsewhere in this project, so the fix is the
 * same: click the associated `<label>` (a real `<label for="...">`,
 * which the browser dispatches the click through to its target
 * regardless of the target's tag) rather than trying to interact with the
 * hidden input directly. Region/age-range/postal-communications are all
 * `aria-required="false"` with sensible pre-set defaults (postal comms
 * defaults to "No", age range to a placeholder value) and are left alone
 * — there's no profile field to map onto them anyway. The Country/
 * Postcode/Address block sits inside a `<fieldset style="display:none">`
 * that's only revealed by an on-page toggle this adapter doesn't need,
 * since every field in it is optional.
 *
 * The single checkbox on this form ("I have read the privacy policy and
 * would like to receive news and offers to my inbox") is REQUIRED to
 * receive the newsletter and *is* the newsletter itself — this is the one
 * case where a NewsletterAdapter should tick it (never on a competition
 * form, see coastMagazineCarbisBay.ts for that same organisation's own
 * competition adapter, which deliberately leaves the equivalent box
 * unticked).
 *
 * No cookie-consent banner was found in this page's rendered HTML (static
 * analysis only — this project's headless-browser tooling couldn't reach
 * this site during this adapter's research pass; if a banner does appear
 * live and blocks the submit click, that's a follow-up fix, not something
 * guessed at here).
 */
export const ambassadorCruiseLineNewsletterAdapter: NewsletterAdapter = {
  key: "ambassador-cruise-line-newsletter",
  siteName: "Ambassador Cruise Line",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    const form = page.locator('form:has(input[name="first_name"])');
    if ((await form.count()) === 0) {
      await log.warn("Expected mailing-list form (input[name=first_name]) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter signup form not found on page" };
    }

    await page.locator('input[name="first_name"]').fill(profile.firstName);
    await page.locator('input[name="surname"]').fill(profile.lastName);
    await page.locator('input[name="email"]').fill(profile.email);
    await log.info("Filled first name, surname, email");

    if (profile.phone) {
      const phoneField = page.locator('input[name="phone"]');
      if ((await phoneField.count()) > 0) {
        await phoneField.fill(profile.phone);
        await log.info("Filled phone (optional field on this form)");
      }
    }

    const consentLabel = page.locator("label", { hasText: "would like to receive news and offers" });
    if ((await consentLabel.count()) === 0) {
      await log.warn("Expected marketing-consent label not found — page may have changed");
      return { status: "FAILED", message: "Required consent checkbox not found on page" };
    }
    await consentLabel.first().click();
    await log.info("Ticked 'I have read the privacy policy and would like to receive news and offers to my inbox' — required, and this box IS the newsletter opt-in on this form");

    const submit = page.getByRole("button", { name: "Get Updates" });
    if ((await submit.count()) === 0) {
      await log.warn("Submit button ('Get Updates') not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // No client-visible confirmation text was captured statically (it only
    // renders after a live AJAX submit), so match broadly by wording,
    // same approach as other adapters in this project. The one error
    // string this form can show is known verbatim from its static markup.
    const success = page.getByText(/thank you|check your email|confirm your subscription|you're subscribed|successfully subscribed/i);
    const error = page.getByText(/sorry, there was an issue receiving your request/i);
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
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
