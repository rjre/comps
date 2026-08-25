import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * National Lobster Hatchery — "Win a Golden Ticket to the Best Days Out in
 * Cornwall" (nationallobsterhatchery.co.uk). A WPForms form (form id
 * 711513) run directly on the charity's own site: name, email, county,
 * postcode. There's an optional newsletter opt-in checkbox we deliberately
 * never tick — see README's "No auto-consent" rule.
 */
export const nationalLobsterHatcheryAdapter: CompetitionAdapter = {
  key: "national-lobster-hatchery",
  siteName: "National Lobster Hatchery",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    const form = page.locator("#wpforms-form-711513");
    if ((await form.count()) === 0) {
      await log.warn("Expected WPForms entry form (#wpforms-form-711513) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    if (!profile.region || !profile.postalCode) {
      await log.warn("Profile is missing county (region) or postcode, both required by this form");
      return { status: "FAILED", message: "Profile missing region/postalCode required by this form" };
    }

    // A cookie-consent banner (CookieYes) overlaps the form fields/submit
    // button on first load. Reject non-essential cookies rather than accept
    // — we're not opting the profile into tracking on their behalf — then
    // get it out of the way so it can't intercept clicks.
    const rejectCookies = page.locator(".cky-btn-reject");
    if (await rejectCookies.isVisible({ timeout: 5000 }).catch(() => false)) {
      await rejectCookies.click();
      await log.info("Dismissed cookie banner (rejected non-essential cookies)");
    }

    await page.locator("#wpforms-711513-field_1").fill(profile.firstName);
    await page.locator("#wpforms-711513-field_1-last").fill(profile.lastName);
    await page.locator("#wpforms-711513-field_2").fill(profile.email);
    await page.locator("#wpforms-711513-field_3").fill(profile.region);
    await page.locator("#wpforms-711513-field_6").fill(profile.postalCode);
    await log.info("Filled name, email, county, postcode");

    // field_4_1 is the newsletter opt-in checkbox — intentionally left unchecked.

    const submit = page.locator("#wpforms-submit-711513");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#wpforms-submit-711513) not found");
      return { status: "FAILED", message: "Submit button not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // WPForms' built-in honeypot anti-spam check rejects submits that come
    // too soon after page load ("Please wait a little longer... we're
    // running a quick security check"). This isn't a CAPTCHA to defeat —
    // it's a minimum on-page dwell time, the same one a genuine visitor
    // filling the form would naturally take. We just wait it out.
    const antiSpamNotice = page.getByText(/wait a little longer/i);
    const confirmation = page.locator(".wpforms-confirmation-container-full");
    const fieldError = page.locator(".wpforms-error").first();

    for (let attempt = 1; attempt <= 3; attempt++) {
      await submit.click();
      try {
        await Promise.race([
          confirmation.waitFor({ state: "visible", timeout: 10000 }),
          fieldError.waitFor({ state: "visible", timeout: 10000 }),
          antiSpamNotice.waitFor({ state: "visible", timeout: 10000 }),
        ]);
      } catch {
        continue; // fall through to the outer "unclear outcome" handling below
      }

      if (await antiSpamNotice.isVisible().catch(() => false)) {
        await log.info(`Anti-spam dwell-time check not yet satisfied (attempt ${attempt}), waiting 5s and retrying`);
        await page.waitForTimeout(5000);
        continue;
      }
      break;
    }

    if (!(await confirmation.isVisible().catch(() => false)) && !(await fieldError.isVisible().catch(() => false))) {
      await log.warn("Neither a confirmation message nor a validation error appeared after submit attempts");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await confirmation.isVisible()) {
      const text = (await confirmation.innerText()).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text };
    }

    const errorText = (await fieldError.innerText()).trim();
    await log.warn(`Form validation error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
