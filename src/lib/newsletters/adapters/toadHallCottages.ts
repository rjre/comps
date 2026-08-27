import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Toad Hall Cottages' own newsletter signup
 * (toadhallcottages.co.uk/contact/newsletter) — a family-run holiday
 * cottage agency covering Cornwall, Devon, Dorset, Somerset, Exmoor,
 * Dartmoor and the New Forest, first-party, no purchase/account necessary.
 * Real server-rendered form, POST to /contact/newsletter: Title (select,
 * optional), First_name, surname, email (all required), plus a "News on
 * Pets?" preference dropdown and three groups of purely optional
 * newsletter-content-targeting checkboxes (Favourite_destinations[],
 * Holiday_type[], Bedrooms[]) — none of these are a marketing-consent
 * checkbox to avoid, they just steer which cottages the newsletter itself
 * talks about, so left on their defaults/unticked rather than guessed at.
 *
 * Confirmed directly from the served HTML: this form always renders a
 * standard Google reCAPTCHA v2 checkbox widget
 * (`div.g-recaptcha[data-sitekey]`), unconditionally present, not
 * conditional the way Fred Olsen's "ondemand" one is. This adapter fills
 * the whole form regardless — checking the page really is this one, that
 * the fields are all present, and (in a live run) that the profile data is
 * valid against the form's own validation — and then fails loudly right at
 * the final submit step once the reCAPTCHA challenge is confirmed present,
 * rather than attempting to solve or evade it. This is the SAME
 * "reCAPTCHA blocks only the final submit" case flagged for
 * c2cBlowoutCompany.ts and solmarVillas.ts, not a page-load block.
 *
 * The page does ship a real post-submit confirmation template
 * (`#postForm`, initially `.hidden`): "Thank you for you for signing up,
 * we look forward to emailing you soon." (that's the site's own wording,
 * typo and all) — recorded here for whenever the reCAPTCHA is ever
 * resolved another way, but unreachable while the reCAPTCHA blocks entry.
 *
 * No cookie-consent banner of any kind was present in the served HTML
 * (checked directly — no OneTrust/Cookiebot/CookieYes markup, no generic
 * cookie-banner container), so this adapter doesn't attempt to dismiss
 * one.
 */
export const toadHallCottagesNewsletterAdapter: NewsletterAdapter = {
  key: "toad-hall-cottages-newsletter",
  siteName: "Toad Hall Cottages",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1000);

    const form = page.locator('form[action="/contact/newsletter"]');
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter form (form[action='/contact/newsletter']) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    if (profile.title) {
      const titleSelect = form.locator("#form_title");
      const value = profile.title.toLowerCase().replace(/\.$/, "");
      const hasOption = (await titleSelect.locator(`option[value="${value}"]`).count()) > 0;
      if (hasOption) {
        await titleSelect.selectOption(value);
        await log.info(`Selected title: ${value}`);
      } else {
        await log.info(`Profile title "${profile.title}" isn't one of this form's options — leaving the default`);
      }
    }

    await form.locator("#fn").fill(profile.firstName);
    await form.locator("#ln").fill(profile.lastName);
    await form.locator("#em1").fill(profile.email);
    await log.info("Filled title, first name, last name, email — leaving the optional 'News on Pets?', Favourite destinations, Holiday type and Bedrooms preference fields on their defaults");

    const recaptcha = page.frameLocator('iframe[title="reCAPTCHA"]').locator("body");
    if (await recaptcha.isVisible({ timeout: 8000 }).catch(() => false)) {
      await log.warn("This form requires solving a visible reCAPTCHA challenge — not attempting to solve it");
      return { status: "FAILED", message: "Blocked by a visible reCAPTCHA challenge — not solved or evaded" };
    }

    const submit = form.locator('button[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // Re-check for the reCAPTCHA right before the real click too, in case it
    // rendered late.
    if (await recaptcha.isVisible({ timeout: 3000 }).catch(() => false)) {
      await log.warn("A reCAPTCHA challenge is present immediately before submit — not attempting to solve it");
      return { status: "FAILED", message: "Blocked by a visible reCAPTCHA challenge — not solved or evaded" };
    }

    await submit.click();

    const confirmation = page.locator("#postForm");
    try {
      await confirmation.waitFor({ state: "visible", timeout: 20000 });
    } catch {
      await log.warn("Confirmation panel (#postForm) never became visible within 20s after submit — the reCAPTCHA may have silently blocked the submission");
      return { status: "FAILED", message: "No confirmation appeared after submit — likely blocked by reCAPTCHA" };
    }

    const text = (await confirmation.innerText().catch(() => "")).trim();
    await log.info(`Confirmation shown: ${text}`);
    return { status: "SUCCESS", message: text || undefined };
  },
};
