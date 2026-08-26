import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * The Suffolk Coast — "Gather Prizes" couples' getaway prize draw
 * (thesuffolkcoast.co.uk/competition-entry-2), run directly by The Suffolk
 * Coast Ltd, the area's official tourism board. An ASP.NET WebForms form
 * embedded on the page: title, name, email, full address, year of birth,
 * phone. Two optional marketing checkboxes (Suffolk Coast offers, prize
 * provider offers) are deliberately never ticked; the "I agree to terms
 * and conditions" checkbox is ticked since that's acceptance of the
 * competition's own rules, not a marketing consent.
 */
export const suffolkCoastAdapter: CompetitionAdapter = {
  key: "suffolk-coast",
  siteName: "The Suffolk Coast",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    // A separate newsletter-signup widget elsewhere on this page (not the
    // competition form itself) submits a real top-level POST to Mailchimp
    // immediately after the competition postback reloads — for every
    // entrant, not just us. On this site that request reliably fails and
    // takes the whole tab to a browser network-error page before the
    // competition's own confirmation can be read. We don't want that
    // subscription to actually fire anyway (never opting this profile into
    // marketing), so respond 204 No Content — standard way to make a
    // browser quietly stay on the current page instead of navigating,
    // rather than aborting (which itself produces a nav error) or letting
    // the real broken request through.
    await page.route("**://*.list-manage.com/**", (route) => route.fulfill({ status: 204, body: "" }));

    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    // Cookiebot loads and renders its dialog asynchronously — it can still
    // appear after our first check and intercept a later click, so this is
    // called again right before the checkbox interaction below too.
    const dismissCookieBanner = async (timeout: number) => {
      const cookieDecline = page.locator("#CybotCookiebotDialogBodyButtonDecline");
      if (await cookieDecline.isVisible({ timeout }).catch(() => false)) {
        await cookieDecline.click();
        await log.info("Dismissed cookie banner (declined non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("#ctl00_contentBody_panelFormFoodDrink");
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (#ctl00_contentBody_panelFormFoodDrink) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    if (!profile.dateOfBirth) {
      await log.warn("Profile is missing dateOfBirth — this form requires a Year of Birth");
      return { status: "FAILED", message: "Profile missing dateOfBirth required by this form" };
    }
    if (!profile.phone || !profile.addressLine1 || !profile.city || !profile.region || !profile.postalCode) {
      await log.warn("Profile is missing phone/address fields required by this form");
      return { status: "FAILED", message: "Profile missing phone/address fields required by this form" };
    }

    if (profile.title) {
      const titleSelect = page.locator("#ctl00_contentBody_txtTitle");
      const hasOption = (await titleSelect.locator(`option[value="${profile.title}"]`).count()) > 0;
      if (hasOption) {
        await titleSelect.selectOption(profile.title);
        await log.info(`Selected title: ${profile.title}`);
      } else {
        await log.warn(`Profile title "${profile.title}" isn't one of this form's options — leaving the default`);
      }
    } else {
      await log.info("Profile has no title set — leaving the form's default Title selection as-is");
    }

    await page.locator("#ctl00_contentBody_txtName").fill(profile.firstName);
    await page.locator("#ctl00_contentBody_txtSName").fill(profile.lastName);
    await page.locator("#ctl00_contentBody_txtEmail").fill(profile.email);
    await page.locator("#ctl00_contentBody_txtAddress").fill(profile.addressLine1 ?? "");
    if (profile.addressLine2) {
      await page.locator("#ctl00_contentBody_txtAddress2").fill(profile.addressLine2);
    }
    await page.locator("#ctl00_contentBody_txtTown").fill(profile.city ?? "");
    await page.locator("#ctl00_contentBody_txtCounty").fill(profile.region ?? "");
    await page.locator("#ctl00_contentBody_txtPostcode").fill(profile.postalCode ?? "");
    const birthYear = String(new Date(profile.dateOfBirth).getUTCFullYear());
    await page.locator("#ctl00_contentBody_txtYearBirth").selectOption(birthYear);
    await page.locator("#ctl00_contentBody_txtPhone").fill(profile.phone);
    await log.info("Filled name, email, address, year of birth, and phone");

    // Belt-and-suspenders: the cookie dialog can render mid-way through
    // filling the form and sit on top of the checkbox below.
    await dismissCookieBanner(3000);

    // The real <input type=checkbox> is visually hidden (custom-styled via
    // its <label>), so Playwright's actionability check on the input itself
    // times out — click the associated label instead, same as a real user
    // would. Required to enter at all — accepting the competition's own
    // rules, not marketing.
    await page.locator('label[for="ctl00_contentBody_chkAgree"]').first().click();
    const agreeChecked = await page.locator("#ctl00_contentBody_chkAgree").isChecked();
    if (!agreeChecked) {
      await log.warn("Clicking the 'I agree' label did not check the underlying checkbox");
      return { status: "FAILED", message: "Could not tick the required 'I agree to terms' checkbox" };
    }
    // Both left unchecked deliberately: #chkTheSuffolkCoastoffers, #chkPrizeproviderOffers

    const submit = page.locator("#ctl00_contentBody_btEstablishmentSend");
    if ((await submit.count()) === 0) {
      await log.warn("Submit link (#ctl00_contentBody_btEstablishmentSend) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // This site shows no client-visible "thank you" text at all after a
    // successful entry (checked directly against the raw server response —
    // there's just no confirmation copy anywhere), so we read the actual
    // HTTP response to the form POST instead of scraping the live DOM. That
    // also sidesteps the unrelated newsletter widget below, which drags the
    // tab to a Chrome error page shortly after the postback completes.
    const [response] = await Promise.all([
      page
        .waitForResponse(
          (r) => r.request().method() === "POST" && r.url().split("#")[0] === competitionUrl.split("#")[0],
          { timeout: 15000 },
        )
        .catch(() => null),
      submit.click(),
    ]);

    if (!response) {
      await log.warn("Never observed a POST response for the entry form submission");
      return { status: "FAILED", message: "No response observed for the form submission" };
    }
    if (!response.ok()) {
      await log.warn(`Form POST returned HTTP ${response.status()}`);
      return { status: "FAILED", message: `Form submission returned HTTP ${response.status()}` };
    }

    const html = await response.text();
    const activeValidatorErrors = [...html.matchAll(/<span id="[^"]*(?:RequiredFieldValidator|RegularExpressionValidator|ValidationSummary)[^"]*"[^>]*style="([^"]*)"[^>]*>([^<]*)</g)]
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
