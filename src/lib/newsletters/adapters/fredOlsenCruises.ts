import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Fred. Olsen Cruise Lines' own footer newsletter signup
 * (fredolsencruises.com), first-party, no purchase/account necessary.
 * A small custom-built (not a well-known ESP) form posting to
 * "/focl-email-signup/submit-email-signup": First_Name, Last_Name, Email.
 * No marketing/consent checkboxes on the form itself — signing up IS the
 * subscription, stated in a line of text below the form rather than a
 * checkbox.
 *
 * Two anti-bot details confirmed directly from the served HTML (not
 * guessed): a honeypot text input named "field1P0t" inside a
 * `.h0n3y-p0t`-classed wrapper, labelled "Please leave blank to submit" —
 * left untouched, never filled; and a `div.g-recaptcha-ondemand` reCAPTCHA
 * placeholder, which per its own site-provided copy ("ondemand") appears to
 * render only when Google's risk scoring flags the request, rather than
 * unconditionally. Checked for a rendered reCAPTCHA challenge iframe right
 * before submitting and fail loudly if one has appeared, same as this
 * project's other reCAPTCHA-fronted adapters — never solved or evaded.
 *
 * OneTrust cookie banner (same cdn.cookielaw.org / otSDKStub.js setup, same
 * #onetrust-reject-all-handler selector, as emirates.ts and others in this
 * project).
 *
 * This project's sandbox could not complete a live Playwright render of any
 * external site while building this adapter (Chromium gets
 * net::ERR_CONNECTION_RESET on every external host once routed through the
 * mandatory egress proxy, including sites this project already has working
 * adapters for) — same known sandbox networking artifact already noted
 * against devonsTopAttractions.ts and c2cBlowoutCompany.ts, not a site-side
 * block. curl fetched this page's real HTML/form markup cleanly. This
 * custom-built form also shows no client-visible confirmation text
 * discoverable from the static markup (no server-rendered "thank you"
 * template the way theSuffolkCoast.ts's page has) and its endpoint may
 * respond via AJAX/JSON rather than a full postback — so, in the absence of
 * a known confirmation string, success here is inferred the same way as
 * suffolkCoast.ts/theSuffolkCoast.ts: the submit POST returning a non-error
 * HTTP status with no visible error text is treated as accepted. Given the
 * extra uncertainty about this endpoint's real response shape, the very
 * first live run is worth a human checking the resulting screenshot/log
 * either way.
 */
export const fredOlsenCruisesNewsletterAdapter: NewsletterAdapter = {
  key: "fred-olsen-cruises-newsletter",
  siteName: "Fred. Olsen Cruise Lines",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1500);

    // Confirmed directly (live): this banner can flicker in/out of
    // visibility rapidly, so isVisible() succeeding doesn't guarantee the
    // element is still visible by the time click() actually runs — wrap
    // the click itself in a short timeout/catch so a mid-flicker miss
    // doesn't hang the whole adapter for 30s.
    const dismissCookieBanner = async (timeout: number) => {
      const cookieReject = page.locator("#onetrust-reject-all-handler");
      if (await cookieReject.isVisible({ timeout }).catch(() => false)) {
        const dismissed = await cookieReject
          .click({ timeout: 3000 })
          .then(() => true)
          .catch(() => false);
        if (dismissed) {
          await page.locator("#onetrust-consent-sdk").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
          await log.info("Dismissed cookie banner (rejected non-essential cookies)");
        }
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("#newsletter-signup-form");
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter form (#newsletter-signup-form) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }
    // The form can appear more than once server-side rendered oddly across
    // breakpoints on some templated sites — scope to the first instance.
    const scoped = form.first();

    await scoped.locator('input[name="First_Name"]').fill(profile.firstName);
    await scoped.locator('input[name="Last_Name"]').fill(profile.lastName);
    await scoped.locator('input[name="Email"]').fill(profile.email);
    await log.info("Filled first name, last name, email — leaving the honeypot field (field1P0t) untouched");

    await dismissCookieBanner(3000);

    const recaptchaFrame = page.frameLocator('iframe[title*="reCAPTCHA" i], iframe[src*="recaptcha"]').locator("body");
    if (await recaptchaFrame.isVisible({ timeout: 3000 }).catch(() => false)) {
      await log.warn("A reCAPTCHA challenge has rendered on this form — not attempting to solve it");
      return { status: "FAILED", message: "Blocked by a reCAPTCHA challenge — not solved or evaded" };
    }

    const submit = scoped.locator("button.go");
    if ((await submit.count()) === 0) {
      await log.warn("Sign up button (button.go) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await dismissCookieBanner(3000);

    // Confirmed directly (live): the OneTrust dark backdrop can re-render
    // and block this click even after being dismissed twice already —
    // same recurring pattern hit on several other sites tonight (Emirates,
    // Jet2holidays, Visit Lake District, Muddy Stilettos Reader Treats).
    // Same fallback: on a blocked click, remove the backdrop and retry.
    const clickSubmit = async () => {
      try {
        await submit.click({ timeout: 8000 });
      } catch {
        await log.warn("Submit click was blocked by a re-rendered cookie banner — removing it and retrying");
        await page.evaluate(() => document.querySelector("#onetrust-consent-sdk")?.remove());
        await submit.click();
      }
    };

    const [response] = await Promise.all([
      page
        .waitForResponse(
          (r) => r.request().method() === "POST" && r.url().includes("/focl-email-signup/submit-email-signup"),
          { timeout: 20000 },
        )
        .catch(() => null),
      clickSubmit(),
    ]);

    if (!response) {
      // Confirmed directly (live, repeatedly): this "ondemand" reCAPTCHA
      // does trigger against our automated requests — the site blocks
      // submission client-side with this text instead of ever posting,
      // rather than rendering a solvable widget. Same "don't solve or
      // evade" policy as a visible challenge, just a different shape of it.
      const recaptchaWarning = page.getByText(/complete the recaptcha/i);
      if (await recaptchaWarning.isVisible({ timeout: 2000 }).catch(() => false)) {
        await log.warn("Site blocked submission with a 'complete the reCAPTCHA' message — its on-demand reCAPTCHA was triggered against this request, not solved or evaded");
        return { status: "FAILED", message: "Blocked by an on-demand reCAPTCHA check — not solved or evaded" };
      }
      await log.warn("Never observed a POST response for the newsletter signup submission");
      return { status: "FAILED", message: "No response observed for the form submission" };
    }
    if (!response.ok()) {
      await log.warn(`Form POST returned HTTP ${response.status()}`);
      return { status: "FAILED", message: `Form submission returned HTTP ${response.status()}` };
    }

    await page.waitForTimeout(1500);
    const errorText = page.getByText(/error|invalid email|something went wrong|please try again/i);
    if (await errorText.first().isVisible({ timeout: 2000 }).catch(() => false)) {
      const text = (await errorText.first().innerText().catch(() => "")).trim();
      await log.warn(`Form appears to have shown an error: ${text}`);
      return { status: "FAILED", message: `Form rejected submission: ${text || "unknown error"}` };
    }

    await log.info("Submit POST returned a non-error HTTP status with no visible error text — this custom-built form shows no discoverable client-visible confirmation, treating as accepted");
    return { status: "SUCCESS", message: "HTTP OK, no visible error after submit" };
  },
};
