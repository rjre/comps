import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Visit North Devon's own eNewsletter signup
 * (visitdevon.co.uk/northdevon/plan-your-visit/enewsletter-sign-up/), same
 * NewMind/eCMS platform as visitEssex.ts's newsletter and
 * visitNorthDevon.ts's competition adapter — but like that competition
 * adapter (and unlike visitEssex.ts's newsletter, which is same-origin),
 * the actual form here is a cross-origin <iframe id="embedForm"> pointing
 * at visitdevon-ws.newmindmedia.com, so this needs a frameLocator too.
 *
 * Three independent consent checkboxes, confirmed directly from the form's
 * own markup: value=12431 ("contacted by Visit Devon ... via email" — this
 * page's whole first-party purpose, ticked), value=12441 (the same via
 * SMS — a different channel we weren't asked to opt into, left unticked),
 * value=12451 ("contacted by the prize giver" — third-party, left
 * unticked same as every other adapter in this project). A separate list
 * of ~9 "I am interested in" checkboxes (History & Heritage, Food & Drink,
 * etc) are content-preference filters, not marketing consent, so left
 * untouched. Protected by reCAPTCHA v3 (ReCaptchaAttachV3OnSubmit) — not
 * solved or evaded, just submitted normally.
 */
export const visitNorthDevonNewsletterAdapter: NewsletterAdapter = {
  key: "visit-north-devon-newsletter",
  siteName: "Visit North Devon",
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

    await form.locator("#forename_37512").fill(profile.firstName);
    await form.locator("#surname_37512").fill(profile.lastName);
    await form.locator("#email_37512").fill(profile.email);
    await form.locator("#email2_37512").fill(profile.email);
    await log.info("Filled forename, surname, email, confirm email");

    // The "I am interested in" checkboxes (History & Heritage, Food &
    // Drink, ...) are content preferences, not consent — left unticked.

    await dismissCookieBanner(3000);

    const emailConsent = form.locator('input[name="consentstatementsaccepted"][value="12431"]');
    if ((await emailConsent.count()) === 0) {
      await log.warn("Expected email consent checkbox (value=12431) not found — page may have changed");
      return { status: "FAILED", message: "Consent checkbox not found on page" };
    }
    await emailConsent.check();
    await log.info("Ticked 'I agree to be contacted by Visit Devon with offers, competitions and information via email' — this page's sole purpose");
    // Both left unticked deliberately: value=12441 (same via SMS — a
    // different channel than the email newsletter we were asked for),
    // value=12451 (the prize giver — third-party).

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

    // Same platform as visitEssex.ts's newsletter and visitNorthDevon.ts's
    // competition adapter — AJAX-injected confirmation/error text, not
    // present in the static page, so matched by wording with a generous
    // timeout (reCAPTCHA v3 can add real delay before the POST resolves).
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
