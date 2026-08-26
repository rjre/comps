import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Adventure Island (Southend-on-Sea's own theme park, adventureisland.co.uk)
 * — a simple footer newsletter widget (Elementor Pro form) present on the
 * homepage: an optional Name field and a required Email field. No
 * competition currently found on this org's own domain at time of
 * writing — newsletter only. CookieYes cookie-consent banner, standard
 * selectors. Elementor Pro forms submit via a background AJAX POST to
 * wp-admin/admin-ajax.php rather than a full page navigation, and inject
 * a ".elementor-message" response div once that resolves — matched by
 * wording (not assumed instantly present), same "AJAX can take longer
 * than a fixed short timeout" caution as elsewhere in this project.
 */
export const adventureIslandNewsletterAdapter: NewsletterAdapter = {
  key: "adventure-island-newsletter",
  siteName: "Adventure Island",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    // Wait for the page's full load event (background scripts, Elementor's
    // own form-handling JS included) to settle before interacting — this
    // theme-park site is heavy, and submitting an Elementor form before its
    // handler has attached can silently no-op the click.
    await page.waitForLoadState("load").catch(() => {});

    const dismissCookieBanner = async (timeout: number) => {
      const reject = page.locator(".cky-btn-reject");
      if (await reject.first().isVisible({ timeout }).catch(() => false)) {
        await reject.first().click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator('form[name="Newsletter"]');
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter form (form[name='Newsletter']) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    if (profile.firstName) {
      const nameValue = profile.lastName ? `${profile.firstName} ${profile.lastName}` : profile.firstName;
      await form.locator('input[name="form_fields[field_1]"]').fill(nameValue);
    }
    await form.locator('input[name="form_fields[email]"]').fill(profile.email);
    await log.info("Filled name and email");

    await dismissCookieBanner(3000);

    const submit = form.locator('button[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Subscribe button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // Elementor Pro's own response markup, matched by wording rather than
    // a guessed class alone since the exact success copy isn't visible in
    // the static page. AJAX can take a while, so this waits well past this
    // project's usual 15s default.
    const success = page.locator(".elementor-message-success, .elementor-message").filter({ hasText: /success|thank|subscribed/i });
    const error = page.locator(".elementor-message-danger, .elementor-message").filter({ hasText: /invalid|error|required|already/i });
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
      await log.info(`Subscribed: ${text || "(success message shown)"}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText || "unknown validation error"}` };
  },
};
