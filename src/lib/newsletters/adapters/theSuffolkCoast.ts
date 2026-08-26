import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * The Suffolk Coast's own site-wide newsletter signup — a single email
 * field in the page header (ASP.NET WebForms postback, validation group
 * "SIGNUPTOP"), distinct from the "competition-entry-2" prize draw form
 * this project already tracks as a competition (suffolkCoast.ts). No
 * marketing checkboxes to leave unticked — just the one email field.
 *
 * Same site/stack as the competition adapter: a full-page WebForms
 * postback with no client-visible confirmation text, so success is read
 * from the raw HTTP response rather than the DOM, same approach as there.
 */
export const theSuffolkCoastNewsletterAdapter: NewsletterAdapter = {
  key: "the-suffolk-coast-newsletter",
  siteName: "The Suffolk Coast",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    // Same Cookiebot dialog as the competition entry page on this site —
    // can intercept a later click if it renders after this first check, so
    // called again right before the submit click below too.
    const dismissCookieBanner = async (timeout: number) => {
      const cookieDecline = page.locator("#CybotCookiebotDialogBodyButtonDecline");
      if (await cookieDecline.isVisible({ timeout }).catch(() => false)) {
        await cookieDecline.click();
        await log.info("Dismissed cookie banner (declined non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const emailField = page.locator("#ctl00_txtSignupEmail");
    if ((await emailField.count()) === 0) {
      await log.warn("Expected newsletter signup field (#ctl00_txtSignupEmail) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter signup field not found on page" };
    }

    await emailField.fill(profile.email);
    await log.info("Filled email field");

    await dismissCookieBanner(3000);

    // A separate site-run "WIN A 2 NIGHT STAY!" survey popup
    // (competition-popup.js) auto-opens on this page after a delay — its
    // own excludedPaths list covers the competition pages but not the
    // homepage, so it shows here and blocks the submit click below.
    const surveyPopupClose = page.locator("#tsc-competition-popup .tsc-competition-popup__close");
    if (await surveyPopupClose.isVisible({ timeout: 3000 }).catch(() => false)) {
      await surveyPopupClose.click();
      await log.info("Dismissed a separate survey/competition popup that appeared on the page");
    }

    const submit = page.locator("#ctl00_btSendSignup");
    if ((await submit.count()) === 0) {
      await log.warn("Send link (#ctl00_btSendSignup) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // Same as the competition form on this site: no client-visible
    // confirmation text after a successful postback, so read the raw HTTP
    // response for server-side validation errors instead of scraping the
    // DOM. This form's postback target is a URL-rewritten alias of the
    // page ("/" actually posts to "/default"), so match on hostname +
    // method rather than the exact URL, which never matched.
    const sourceHost = new URL(sourceUrl).hostname;
    const [response] = await Promise.all([
      page
        .waitForResponse(
          (r) => r.request().method() === "POST" && new URL(r.url()).hostname === sourceHost,
          { timeout: 15000 },
        )
        .catch(() => null),
      submit.click(),
    ]);

    if (!response) {
      await log.warn("Never observed a POST response for the newsletter signup submission");
      return { status: "FAILED", message: "No response observed for the form submission" };
    }

    let html: string;
    if (response.status() >= 300 && response.status() < 400) {
      // Post/Redirect/Get — confirmed by direct testing as this form's
      // normal completion path (posts to "/default", 301s back to "/"),
      // not an error. The redirect response itself carries no useful body,
      // so check validators on the page the browser lands on afterward.
      await log.info(`Form POST redirected (HTTP ${response.status()}) — expected completion path for this form`);
      await page.waitForLoadState("domcontentloaded").catch(() => {});
      html = await page.content().catch(() => "");
    } else if (!response.ok()) {
      await log.warn(`Form POST returned HTTP ${response.status()}`);
      return { status: "FAILED", message: `Form submission returned HTTP ${response.status()}` };
    } else {
      html = await response.text();
    }

    const activeValidatorErrors = [...html.matchAll(/<span id="[^"]*(?:reqEmail|regEmail|valSIGNUPTOP)[^"]*"[^>]*style="([^"]*)"[^>]*>([^<]*)</g)]
      .map((m) => ({ style: m[1] ?? "", text: (m[2] ?? "").trim() }))
      .filter(({ style, text }) => !/display:\s*none/i.test(style) && text.length > 0);

    if (activeValidatorErrors.length > 0) {
      const messages = activeValidatorErrors.map(({ text }) => text).join("; ");
      await log.warn(`Server-side validation error(s) after submit: ${messages}`);
      return { status: "FAILED", message: `Form rejected submission: ${messages}` };
    }

    await log.info("Form POST returned 200 with no active validation errors — treating as accepted (this site shows no explicit confirmation text)");
    return { status: "SUCCESS", message: "HTTP 200, no validation errors present after submit" };
  },
};
