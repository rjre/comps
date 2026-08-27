import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Classic Cottages' own footer newsletter signup (classic.co.uk) — an
 * independent holiday cottage agency based in Hayle, Cornwall, covering
 * properties across Cornwall, Devon, and further afield. First-party, no
 * purchase/account necessary. A single email field
 * (`section.footer-newsletter form`, `action="#"`) — this site handles the
 * submit entirely client-side via JS (no real form action/method target to
 * wait a network response on), toggling two sibling panels that already
 * ship with their real copy in the static HTML:
 * `.newsletter__success` ("Thank you — Keep an eye out for our welcome
 * email...") and `.newsletter__error` ("Sorry, an error has occurred —
 * We've been unable to register you for our newsletter at this time,
 * please call us on 01326 555555."). Both real wording confirmed directly
 * from the served page, not guessed. The same two-panel pattern (and the
 * same two confirmation strings) is duplicated in a header "Sign up" modal
 * elsewhere on the page — this adapter uses the always-present footer copy
 * rather than needing to open that modal first.
 *
 * The header nav also exposes a "Sign up" button that opens that
 * newsletter modal, but nothing else on this page or its search results
 * pointed at a genuine no-purchase-necessary Classic Cottages *competition*
 * of its own — the ones found while researching this (a "£250/£500 Classic
 * Cottages voucher" prize) are run by third parties (The Good Web Guide,
 * olive magazine) as their own competitions with Classic Cottages product
 * as the prize, not something entered on classic.co.uk itself.
 *
 * CookieYes cookie-consent banner — same platform and reject-button class
 * (`.cky-btn-reject`) already used by adventureIsland.ts elsewhere in this
 * project. Its main banner markup loads dynamically from CookieYes' own
 * script rather than being present in the static HTML (true of CookieYes
 * generally, not specific to this site), so its presence is inferred from
 * this project's existing working adapter for the same platform rather
 * than being independently visible in a plain curl fetch here.
 */
export const classicCottagesNewsletterAdapter: NewsletterAdapter = {
  key: "classic-cottages-newsletter",
  siteName: "Classic Cottages",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1000);

    const dismissCookieBanner = async (timeout: number) => {
      const reject = page.locator(".cky-btn-reject");
      if (await reject.isVisible({ timeout }).catch(() => false)) {
        await reject.click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(8000);

    const section = page.locator("section.footer-newsletter");
    if ((await section.count()) === 0) {
      await log.warn("Expected footer newsletter section (section.footer-newsletter) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    const emailField = section.locator("#email-sign-up");
    if ((await emailField.count()) === 0) {
      await log.warn("Expected email field (#email-sign-up) not found within the newsletter section");
      return { status: "FAILED", message: "Newsletter email field not found on page" };
    }
    await emailField.fill(profile.email);
    await log.info("Filled email");

    await dismissCookieBanner(3000);

    const submit = section.locator("button.form-submit");
    if ((await submit.count()) === 0) {
      await log.warn("Sign up button not found within the newsletter section");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    const success = section.locator(".newsletter__success");
    const failure = section.locator(".newsletter__error");
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        failure.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither the success nor the error panel became visible within 15s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await failure.first().isVisible().catch(() => false)) {
      const text = (await failure.first().innerText().catch(() => "")).trim();
      await log.warn(`Error panel shown: ${text}`);
      return { status: "FAILED", message: text || "Form reported an error after submit" };
    }

    const text = (await success.first().innerText().catch(() => "")).trim();
    await log.info(`Confirmation shown: ${text}`);
    return { status: "SUCCESS", message: text || undefined };
  },
};
