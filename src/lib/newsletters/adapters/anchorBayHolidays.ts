import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Anchor Bay Holidays' own newsletter signup
 * (anchorbayholidays.uk/newsletter-competitions/) — a genuine UK holiday
 * cottage agency. First-party, no purchase necessary. Signing up here
 * doubles as this org's "Win a £500 Voucher" competition entry (see
 * below) — no separate competition adapter needed.
 *
 * A Sendinblue/Brevo embedded form (First Name, Last Name, Email — all
 * required) with a reCAPTCHA v2 that renders inconsistently between
 * loads (invisible badge only on one check, a real visible challenge on
 * another, confirmed directly via screenshot) — checked for a rendered
 * visible challenge right before submit and failed loudly if one
 * appears, same as this project's other reCAPTCHA-fronted adapters, but
 * not assumed blocking just because the underlying widget exists.
 *
 * Cookie banner: a custom consent panel (Allow All/Allow Selected/Reject
 * All buttons, no recognisable CMP library) confirmed directly via
 * screenshot to sit on top of the newsletter modal — missed when this
 * adapter was first built, dismissed via its own wording now.
 *
 * The competition itself is genuinely still open, not closed: its own
 * T&Cs state it "ends at 8pm on 31st December 2026" and draws from
 * whoever remains subscribed at that date — the "2026 Winner Announced"
 * banner on the page refers to the *previous* draw, not this one.
 * Subscribing now is itself the competition entry.
 */
export const anchorBayHolidaysNewsletterAdapter: NewsletterAdapter = {
  key: "anchor-bay-holidays-newsletter",
  siteName: "Anchor Bay Holidays",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1500);

    const cookieReject = page.locator('button[name="update_privacy_reject_all"]');
    if (await cookieReject.isVisible({ timeout: 8000 }).catch(() => false)) {
      await cookieReject.click();
      await log.info("Dismissed cookie banner (rejected non-essential cookies)");
    }
    await page.waitForTimeout(500);

    const form = page.locator('form:has(input[name="FIRSTNAME"])').first();
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter form (input[name=FIRSTNAME]) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await form.locator('input[name="FIRSTNAME"]').fill(profile.firstName);
    await form.locator('input[name="LASTNAME"]').fill(profile.lastName);
    await form.locator('input[name="email"]').fill(profile.email);
    await log.info("Filled first name, last name, email");

    // A bare iframe[title*=reCAPTCHA] visibility check isn't enough here:
    // confirmed directly it also matches the small, harmless corner
    // badge (always present, doesn't block anything), not just a real
    // challenge — checking its actual rendered size distinguishes a
    // badge (~256x60) from a real challenge box (~300x400+).
    const recaptchaIframe = page.locator('iframe[title*="reCAPTCHA" i]').first();
    if (await recaptchaIframe.isVisible({ timeout: 3000 }).catch(() => false)) {
      const box = await recaptchaIframe.boundingBox().catch(() => null);
      if (box && box.height > 150) {
        await log.warn(`A visible reCAPTCHA challenge has rendered on this form (iframe ${Math.round(box.width)}x${Math.round(box.height)}) — not attempting to solve it`);
        return { status: "FAILED", message: "Blocked by a visible reCAPTCHA challenge — not solved or evaded" };
      }
    }

    const submit = form.locator('button[type="submit"], input[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.first().click();

    const success = page.getByText(/thank you|you'?re subscribed|successfully subscribed|check your email|confirm your subscription/i);
    const error = page.getByText(/already subscribed|invalid|error|something went wrong|please try again|please verify/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 20000 }),
        error.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a success message nor an error appeared within 20s after submit — possibly blocked by an invisible reCAPTCHA score check, which we don't attempt to evade");
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
