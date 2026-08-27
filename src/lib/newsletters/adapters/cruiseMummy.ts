import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Cruise Mummy's own newsletter signup (cruisemummy.co.uk/subscribe/) — a
 * genuine UK cruise blog (run by Jenni Fielding) whose own "Win a Cruise!"
 * page is where the Ambassador/Advantage Travel/Saga/Fred Olsen leads this
 * session came from. The blog's own subscribe page states its newsletter
 * "let[s] people know about the latest cruise competitions" — subscribing
 * here directly serves this project's purpose (more competition leads),
 * separate from actually entering any competition on the aggregator itself.
 *
 * A simple ConvertKit (Kit) form (`action="https://app.kit.com/forms/
 * 6308018/subscriptions"`): First Name (optional) and Email (required).
 * ConvertKit's own post-submit behaviour is a full-page redirect/reload to
 * a "success" state (or an inline error rendered on the same page) — no
 * custom JS to reverse-engineer here, just a real HTML form.
 *
 * A "Manage Your Privacy" consent modal (Sourcepoint-style CMP, confirmed
 * directly via screenshot) sits on top of the form at load and blocked the
 * first real attempt at this adapter (submit button locator resolved to
 * zero elements because the form itself renders past the fold under the
 * modal). Dismissed via its "Accept All" button — no one-click reject-all
 * offered, only "Manage Settings" or "Accept All".
 *
 * The submit button (`<button data-element="submit">JOIN FREE</button>`)
 * has no literal `type` attribute in the markup at all — it's only a
 * submit button via the HTML default-type-inside-a-form rule, which a CSS
 * attribute selector like `button[type="submit"]` doesn't see (confirmed
 * directly: that selector matched zero elements even though the button
 * works fine). Matched by `data-element="submit"` instead.
 */
export const cruiseMummyNewsletterAdapter: NewsletterAdapter = {
  key: "cruise-mummy-newsletter",
  siteName: "Cruise Mummy",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1500);

    const acceptAll = page.getByRole("button", { name: "Accept All", exact: true });
    if (await acceptAll.isVisible({ timeout: 5000 }).catch(() => false)) {
      await acceptAll.click();
      await log.info("Dismissed privacy consent modal (Accept All — no one-click reject option offered)");
    }
    await page.waitForTimeout(500);

    const form = page.locator('form[action*="app.kit.com/forms/"]').first();
    if ((await form.count()) === 0) {
      await log.warn("Expected ConvertKit form not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    const firstNameField = form.locator('input[name="fields[first_name]"]');
    if ((await firstNameField.count()) > 0) {
      await firstNameField.fill(profile.firstName);
    }
    await form.locator('input[name="email_address"]').fill(profile.email);
    await log.info("Filled first name, email");

    const submit = form.locator('button[data-element="submit"], input[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found within the newsletter form");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.first().click();

    const success = page.getByText(/success|thank you|you'?re (in|subscribed)|check your (inbox|email)|confirm your subscription/i);
    const error = page.getByText(/already subscribed|invalid|error|something went wrong|please try again/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 20000 }),
        error.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error appeared within 20s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Subscribed: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText || "unknown error"}` };
  },
};
