import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Official London Theatre's newsletter — run by the Society of London
 * Theatre (SOLT), the not-for-profit representing the West End theatre
 * industry (also runs the Olivier Awards, West End LIVE, Theatre Tokens).
 * A simple footer signup form present sitewide: first name, email, and a
 * required "I agree to terms and conditions and privacy policy" checkbox
 * (ToS acceptance, not marketing consent — needed just to submit at all).
 * Worth tracking regardless of any single competition's dates, since SOLT
 * announces things like the West End LIVE prize draw through this list.
 */
export const officialLondonTheatreNewsletterAdapter: NewsletterAdapter = {
  key: "official-london-theatre-newsletter",
  siteName: "Official London Theatre (SOLT)",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    // A consent widget (class prefix "_flo-consent") renders inside a
    // full-viewport wrapper div, re-created on a timer, that keeps
    // intercepting clicks in the footer area where this newsletter form
    // lives — clicking its own Close/Accept buttons doesn't stop a new one
    // reappearing moments later. We're not granting it any consent either
    // way (never accepting non-essential tracking), so just neutralise it
    // outright rather than fight its click targets — no different in
    // effect from a real visitor's consent-blocking browser extension.
    // Scoped to div only — the page also sets a dynamic
    // "_flo-consent<id>-nooverflow" class directly on <body> while the
    // modal is open, and a broader attribute selector matches that too,
    // hiding the entire page including the form we actually want.
    await page.addStyleTag({
      content:
        "div[class*='_flo-consent']{ display: none !important; pointer-events: none !important; } " +
        // That "-nooverflow" body class also locks page scroll while the
        // modal would be open — force it back so the footer form (and its
        // scroll-into-view interactions) stay reachable.
        "body[class*='_flo-consent']{ overflow: auto !important; }",
    });

    const emailField = page.locator("#newsletter-strip-email");
    if ((await emailField.count()) === 0) {
      await log.warn("Expected newsletter form (#newsletter-strip-email) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await page.locator("#newsletter-strip-name").fill(profile.firstName);
    await emailField.fill(profile.email);
    await log.info("Filled first name and email");

    // This checkbox is genuinely off-screen (CSS positioning in the footer
    // strip) — even a forced click can't compute a coordinate to click.
    // Set it directly and dispatch the events a real click/change would
    // produce, since that's the actual effect we need, not the click itself.
    const consent = page.locator("#newsletter-consent");
    if ((await consent.count()) === 0) {
      await log.warn("Expected consent checkbox (#newsletter-consent) not found");
      return { status: "FAILED", message: "Consent checkbox not found on page" };
    }
    await consent.evaluate((el: HTMLInputElement) => {
      el.checked = true;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await log.info("Ticked required terms & conditions / privacy policy agreement (not marketing-specific)");

    const submit = page.locator("form[data-newsletter-simple] button[type='submit']");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found in newsletter form");
      return { status: "FAILED", message: "Submit button not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    const success = page.getByText(/thank you|you're subscribed|you have been added|successfully subscribed|you're on the list/i);
    const error = page.locator("#newsletter-strip-error").filter({ hasText: /.+/ });
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a success nor error message appeared within 15s after submit");
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
