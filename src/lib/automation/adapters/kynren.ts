import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Kynren (kynren.com) — "Win 2 VIP Tickets to Pyromusical", run directly by
 * the attraction's own charity (11Arches, Registered Charity No. 1159011).
 * A WPForms form (id 13935): email, full name (first/last), postcode. Field
 * 1 is WPForms' own honeypot — visually hidden via inline CSS
 * (position:absolute, visibility:hidden, z-index:-1000) and must be left
 * untouched, not filled. One optional marketing checkbox ("hear from
 * Kynren about news, events & offers", field 10) is deliberately never
 * ticked; the required "I agree to the competition terms & conditions"
 * checkbox (field 12) is ticked since that's acceptance of the
 * competition's own rules, not marketing consent. No CAPTCHA observed
 * (confirmed directly: no reCAPTCHA/Turnstile config in this page's
 * wpforms_settings). Same confirmation-container/error/anti-spam-dwell
 * pattern as nationalLobsterHatchery.ts (also a WPForms site).
 */
export const kynrenAdapter: CompetitionAdapter = {
  key: "kynren",
  siteName: "Kynren",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    // Complianz CMP — can render after an initial check, so called again
    // right before the checkbox interaction below too.
    const dismissCookieBanner = async (timeout: number) => {
      const deny = page.locator(".cmplz-btn.cmplz-deny").first();
      if (await deny.isVisible({ timeout }).catch(() => false)) {
        await deny.click();
        await log.info("Dismissed cookie banner (denied non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("#wpforms-form-13935");
    if ((await form.count()) === 0) {
      await log.warn("Expected WPForms entry form (#wpforms-form-13935) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    if (!profile.postalCode) {
      await log.warn("Profile is missing postalCode, required by this form");
      return { status: "FAILED", message: "Profile missing postalCode required by this form" };
    }

    await page.locator("#wpforms-13935-field_6").fill(profile.email);
    await page.locator("#wpforms-13935-field_7").fill(profile.firstName);
    await page.locator("#wpforms-13935-field_7-last").fill(profile.lastName);
    await page.locator("#wpforms-13935-field_9").fill(profile.postalCode);
    await log.info("Filled email, full name, postcode");
    // field_1 (honeypot, CSS-hidden) deliberately left untouched.

    await dismissCookieBanner(3000);

    // field_10_1 ("I would like to hear from Kynren...") deliberately left unticked.
    const agree = page.locator("#wpforms-13935-field_12_1");
    if ((await agree.count()) === 0) {
      await log.warn("Required 'I agree to the competition terms & conditions' checkbox not found");
      return { status: "FAILED", message: "Required terms checkbox not found" };
    }
    await agree.check();
    await log.info("Ticked required 'I agree to the competition terms & conditions' checkbox");

    const submit = page.locator("#wpforms-submit-13935");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#wpforms-submit-13935) not found");
      return { status: "FAILED", message: "Submit button not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // Same WPForms honeypot-dwell-time retry loop as nationalLobsterHatchery.ts.
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
        continue;
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
