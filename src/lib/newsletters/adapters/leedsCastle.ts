import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Leeds Castle (leeds-castle.com, Kent — run by the Leeds Castle
 * Foundation, a registered charity) — a genuinely separate org from the
 * already-excluded "Kent Attractions" multi-attraction consortium; this is
 * a single organiser's own site. Its "join our digital family" footer
 * newsletter widget (confirmed present on every page, and served as its
 * own dedicated static page too) is a real native HTML form: `<form
 * method="get" action="/contact/signup/">` with a single `<input
 * type="email" name="email">` and a `SIGN-UP` button, no marketing-partner
 * checkbox anywhere — the sign-up itself is the form's whole purpose.
 * Confirmed directly via curl (server-rendered, not a client-only shell)
 * that /contact/signup/ is a real page serving that same footer form, used
 * here as sourceUrl. No cookie-consent banner script found anywhere in the
 * static HTML for this site (checked directly), but dismissed defensively
 * if one renders client-side at runtime.
 *
 * The form is a plain GET (no visible AJAX/ESP script reference in the
 * static HTML — no Mailchimp/Klaviyo/etc. signature found), so submitting
 * it should navigate the browser to `/contact/signup/?email=...`, but
 * whether that reload — or some other client-side handler — actually
 * carries a confirmation/error message couldn't be confirmed without a
 * live submit (never done from this environment). Same caution as
 * haven.ts/butlins.ts: never default an errorless response to SUCCESS,
 * fail loudly with whatever's actually observed so a real run's log can
 * tighten this once the true wording is known.
 *
 * No live no-purchase-necessary Leeds Castle web-form competition found at
 * time of writing — the site's own /competitions/ landing page has no
 * current entry (its one linked competition, a 2022 fireworks-tickets
 * draw, is stale and additionally gated behind "JavaScript is required for
 * this content", i.e. not verifiable from static HTML) — newsletter only
 * for now.
 */
export const leedsCastleNewsletterAdapter: NewsletterAdapter = {
  key: "leeds-castle-newsletter",
  siteName: "Leeds Castle",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });
    // Wait for the full load event (and whatever analytics/consent scripts
    // it drags in) before touching anything, same caution as other WordPress
    // sites in this project with heavier front ends (adventureIsland.ts).
    await page.waitForLoadState("load").catch(() => {});

    const dismissCookieBanner = async (timeout: number) => {
      const reject = page.getByRole("button", { name: /reject all|reject non-essential|decline/i });
      if (await reject.first().isVisible({ timeout }).catch(() => false)) {
        await reject.first().click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(8000);

    const form = page.locator('form[action="/contact/signup/"]');
    if ((await form.count()) === 0) {
      await log.warn('Expected newsletter form (form[action="/contact/signup/"]) not found — page may have changed');
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    const emailField = form.locator('input[name="email"]').first();
    if ((await emailField.count()) === 0) {
      await log.warn("Expected email field not found in the newsletter form");
      return { status: "FAILED", message: "Email field not found on page" };
    }
    await emailField.scrollIntoViewIfNeeded();
    await emailField.fill(profile.email);
    await log.info("Filled email field");

    await dismissCookieBanner(3000);

    const submit = form.getByRole("button", { name: /sign.?up/i });
    if ((await submit.count()) === 0) {
      await log.warn("SIGN-UP button not found in the newsletter form");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // A plain GET form with no visible ESP script — submitting it normally
    // navigates the browser to /contact/signup/?email=..., so wait for that
    // navigation as well as any in-place success/error text, whichever
    // happens first.
    const success = page.getByText(/thank you|you're signed up|you have been signed up|check your inbox|successfully/i);
    const error = page.getByText(/something went wrong|please try again|invalid email|error submitting/i);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 15000 }).catch(() => {}),
      submit.click(),
    ]);

    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("No confirmation or error text appeared within 15s after submit, and the outcome couldn't otherwise be confirmed");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await error.first().isVisible().catch(() => false)) {
      const errorText = (await error.first().innerText().catch(() => "")).trim();
      await log.warn(`Newsletter form error: ${errorText}`);
      return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
    }

    const successText = (await success.first().innerText().catch(() => "")).trim();
    await log.info(`Subscribed: ${successText}`);
    return { status: "SUCCESS", message: successText || undefined };
  },
};
