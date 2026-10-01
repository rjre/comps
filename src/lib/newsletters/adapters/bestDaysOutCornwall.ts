import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Best Days Out Cornwall's own newsletter signup — a second, unrelated
 * Elementor Forms widget further down the same /competitions/ page as the
 * already-tracked Golden Ticket prize draw (best-days-out-cornwall-golden-ticket),
 * confirmed directly via curl to be a genuinely separate form (form_id
 * "19623c7", vs the competition's own "188d3752") with just one field:
 * "Sign up for our newsletter and be the first to know about our events
 * and receive discounts for our featured attractions" — a single required
 * email input, no name/county fields and no marketing-consent checkbox to
 * leave unticked (the whole form's only purpose is this opt-in).
 *
 * Same site-wide "Simple Cloudflare Turnstile" WordPress plugin already
 * documented on the competition adapter (confirmed directly: its own
 * embedded config applies "afterform" to every Elementor form on the site,
 * not just the competition's) — handled the same way: fill the form and
 * wait for this form's own Turnstile response token
 * (#cf-turnstile19623c7) to populate non-interactively, only failing
 * loudly if an actual challenge iframe renders.
 */
export const bestDaysOutCornwallNewsletterAdapter: NewsletterAdapter = {
  key: "best-days-out-cornwall-newsletter",
  siteName: "Best Days Out Cornwall",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });

    const cookieReject = page.locator(".cky-btn-reject");
    if (await cookieReject.first().isVisible({ timeout: 8000 }).catch(() => false)) {
      await cookieReject.first().click();
      await log.info("Dismissed cookie banner (rejected non-essential cookies)");
    }

    const form = page.locator('form:has(input[name="form_id"][value="19623c7"])');
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter form (form_id 19623c7) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await form.locator('input[name="form_fields[email]"]').fill(profile.email);
    await log.info("Filled email field — this form's sole purpose is the newsletter opt-in, no other fields present");

    const submit = form.locator('button[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found in newsletter form");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // Same site-wide Turnstile widget as the competition adapter, scoped
    // to this form's own id ("cf-turnstile" + form_id).
    const turnstileContainer = page.locator("#cf-turnstile19623c7");
    if (await turnstileContainer.count()) {
      const challengeFrame = turnstileContainer.locator('iframe[src*="challenges.cloudflare.com"]');
      const tokenField = turnstileContainer.locator('input[name="cf-turnstile-response"]');
      const tokenPopulated = await tokenField
        .evaluate((el) => (el as HTMLInputElement).value.length > 0, { timeout: 15000 })
        .catch(() => false);
      if (!tokenPopulated && (await challengeFrame.isVisible({ timeout: 3000 }).catch(() => false))) {
        await log.warn("This form requires solving a visible Cloudflare Turnstile challenge — not attempting to solve it");
        return { status: "FAILED", message: "Blocked by a visible Cloudflare Turnstile challenge — not solved or evaded" };
      }
    }

    const success = page.getByText(/thank you|you'?re signed up|subscribed|success|your message was sent/i);
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
      await log.info(`Subscribed: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
