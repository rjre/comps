import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Saga Cruises' own "Newsletter sign up" banner
 * (travel.saga.co.uk/cruises/newsletter-sign-up.aspx), first-party, no
 * purchase/account necessary — Saga Publishing Limited / Saga Cruises
 * Limited, the over-50s specialist. A clean ASP.NET MVC form (anti-forgery
 * token, not classic WebForms postback): First Name, Last Name, Email
 * Address only, no marketing checkboxes to leave unticked — subscribing is
 * this form's entire purpose. Confirmed directly from the served HTML: a
 * hidden `SourceCode` field ("TEU88") is a channel-tracking value baked
 * into this specific page, not something to derive from the profile.
 *
 * This form posts via `<form id="email-only-form" action="/emailonly/banner">`
 * and the page ships a server-rendered `.banner-result-content.failure`
 * template ("We were unable to subscribe you at this time. Please try
 * again later.") wrapped in a `.banner-result.d-none` container, which the
 * page's own JS reveals after the AJAX POST completes — the matching
 * success variant isn't present in the static markup (it's presumably
 * swapped in from the POST's own response body), so this adapter reads the
 * real HTTP response to the POST rather than guessing a success string:
 * a non-OK status, or the *known real* failure copy appearing in the
 * response body, is treated as failure; anything else is treated as
 * accepted, the same "no confirmation text available → HTTP OK with no
 * known error = success" convention already used by suffolkCoast.ts and
 * theSuffolkCoast.ts for sites that don't expose one.
 *
 * This project's sandbox could not complete a live Playwright render of any
 * external site while building this adapter (Chromium gets
 * net::ERR_CONNECTION_RESET on every external host through the mandatory
 * egress proxy, a known sandbox networking artifact already documented
 * against devonsTopAttractions.ts/c2cBlowoutCompany.ts, not a site-side
 * block) — curl fetched this page's real HTML/form markup cleanly, and this
 * form has no reCAPTCHA or other client-side widget visible in that markup.
 * Worth a human checking the first live run's outcome regardless, same as
 * those two adapters.
 *
 * Saga also runs several genuine no-purchase-necessary cruise prize draws
 * (e.g. "Win a river cruise") on this same site, but those forms require a
 * JS-driven postcode/address lookup widget (Knockout.js bindings —
 * `data-bind="click: findAddress"` / `options: suggestedAddresses`) whose
 * manual-entry fallback fields do not exist anywhere in the static HTML
 * (only injected by JS not visible to a plain fetch), plus an empty
 * `#gdpr-content-container` div evidently populated by further JS with an
 * unknown consent-checkbox structure. Both are real selectors this project
 * has no way to discover without live JS execution, which this sandbox
 * cannot do — deliberately not attempted here rather than guessed; worth
 * revisiting in an environment where Playwright can reach the real site.
 * Saga's cruise prize draws are also restricted to entrants aged 50+, which
 * a future adapter attempt should check against `profile.dateOfBirth`
 * (returning SKIPPED_RULES, not FAILED, when the profile is younger or the
 * DOB is unset) before ever reaching that address-widget problem.
 */
export const sagaCruisesNewsletterAdapter: NewsletterAdapter = {
  key: "saga-cruises-newsletter",
  siteName: "Saga Cruises",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1000);

    // Saga's site uses OneTrust for cookie consent (same family of sites as
    // the rest of this codebase's OneTrust-fronted adapters) — reject
    // non-essential cookies via its own real button, re-checked right
    // before the final submit too since it can render asynchronously.
    const dismissCookieBanner = async (timeout: number) => {
      const cookieReject = page.locator("#onetrust-reject-all-handler");
      if (await cookieReject.isVisible({ timeout }).catch(() => false)) {
        await cookieReject.click();
        await page.locator("#onetrust-consent-sdk").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("#email-only-form");
    if ((await form.count()) === 0) {
      await log.warn("Expected newsletter form (#email-only-form) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await form.locator("#FirstName").fill(profile.firstName);
    await form.locator("#LastName").fill(profile.lastName);
    await form.locator("#EmailAddress").fill(profile.email);
    await log.info("Filled first name, last name, email");

    await dismissCookieBanner(3000);

    const submit = form.locator('button[form="email-only-form"]');
    if ((await submit.count()) === 0) {
      await log.warn("Subscribe button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    const [response] = await Promise.all([
      page
        .waitForResponse(
          (r) => r.request().method() === "POST" && r.url().includes("/emailonly/banner"),
          { timeout: 20000 },
        )
        .catch(() => null),
      submit.click(),
    ]);

    if (!response) {
      await log.warn("Never observed a POST response for the newsletter signup submission");
      return { status: "FAILED", message: "No response observed for the form submission" };
    }
    if (!response.ok()) {
      await log.warn(`Form POST returned HTTP ${response.status()}`);
      return { status: "FAILED", message: `Form submission returned HTTP ${response.status()}` };
    }

    const body = await response.text().catch(() => "");
    if (/unable to subscribe you at this time/i.test(body)) {
      await log.warn("Response body contained this form's known failure copy ('unable to subscribe you at this time')");
      return { status: "FAILED", message: "Form reported it was unable to subscribe this address" };
    }

    // Belt-and-suspenders: also check the live DOM in case the failure
    // template got swapped into view rather than only appearing in the
    // POST response body.
    await page.waitForTimeout(1000);
    const domFailure = page.locator(".banner-result-content.failure");
    if (await domFailure.isVisible({ timeout: 2000 }).catch(() => false)) {
      const text = (await domFailure.innerText().catch(() => "")).trim();
      await log.warn(`Failure content visible in the page after submit: ${text}`);
      return { status: "FAILED", message: text || "Form reported failure after submit" };
    }

    await log.info("Submit POST returned HTTP OK with none of this form's known failure copy present — this page has no server-rendered success template to match, treating as accepted");
    return { status: "SUCCESS", message: "HTTP OK, no known failure copy present after submit" };
  },
};
