import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Wightlink Ltd — "Win a Parkdean Resorts holiday worth up to £800", the
 * form currently linked from the live listing page
 * (wightlink.co.uk/ways-to-save/competitions/parkdean-resorts)'s own
 * "Enter competition" button, confirmed directly against that page's
 * real markup today. This is a *different* hosted form from the one
 * wightlinkParkdeanResorts.ts already tracks
 * (form.wightlink.co.uk/cn/aojq7/parkdean, a ClickDimensions form worth
 * "£750" that the current listing page no longer links to anywhere) —
 * same organiser, same prize partner, but the site has since moved this
 * promotion to a new hosted form at a different path
 * (.../cn/aojq7/parkdeancompetition) on a different form-building
 * platform entirely (SurveyJS, not ClickDimensions), so it needs its own
 * adapter rather than a patch to the old one. Left the old adapter and
 * its already-tracked Competition row alone rather than risk breaking
 * whatever's already synced against it.
 *
 * SurveyJS single-page form: First name, Last name, Email address,
 * Postcode, all required, no marketing checkbox at all. Protected by a
 * real, always-rendered reCAPTCHA v2 checkbox (iframe titled "reCAPTCHA"
 * present unconditionally, confirmed directly) that the old ClickDimensions
 * form didn't have — not solved or evaded, same "build up to submit, then
 * fail loudly" category as c2c-blowout-company.ts. No cookie banner on
 * this bare form subdomain (confirmed directly, same as the sibling
 * adapter).
 */
export const wightlinkParkdeanCompetitionAdapter: CompetitionAdapter = {
  key: "wightlink-parkdean-competition",
  siteName: "Wightlink",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    if (!profile.postalCode) {
      await log.warn("Profile is missing postalCode, required by this form");
      return { status: "FAILED", message: "Profile missing postalCode required by this form" };
    }

    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "networkidle" });

    const form = page.locator("form").first();
    if ((await form.count()) === 0) {
      await log.warn("Expected SurveyJS entry form not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    await page.locator("#sq_4i").fill(profile.firstName);
    await page.locator("#sq_7i").fill(profile.lastName);
    await page.locator("#sq_10i").fill(profile.email);
    await page.locator("#sq_13i").fill(profile.postalCode);
    await log.info("Filled first name, last name, email, postcode");

    const recaptcha = page.frameLocator('iframe[title="reCAPTCHA"]').locator("body");
    if (await recaptcha.isVisible({ timeout: 5000 }).catch(() => false)) {
      await log.warn("This form requires solving a visible reCAPTCHA challenge — not attempting to solve it");
      return { status: "FAILED", message: "Blocked by a visible reCAPTCHA challenge — not solved or evaded" };
    }

    const submit = page.locator(".sd-navigation__complete-btn");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (.sd-navigation__complete-btn) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // SurveyJS's own completion page replaces the form wrapper's contents
    // with `.sd-completedpage` on success — a structural constant of the
    // widget itself, not a guessed selector. This organiser's exact
    // completion wording hasn't been observed live, so the wording match
    // is a broad fallback rather than the primary signal.
    const completion = page.locator(".sd-completedpage");
    const success = page.getByText(/thank you|entered|good luck|received/i);
    const error = page.getByText(/already (entered|subscribed)|invalid|error|something went wrong/i);
    try {
      await Promise.race([
        completion.first().waitFor({ state: "visible", timeout: 20000 }),
        success.first().waitFor({ state: "visible", timeout: 20000 }),
        error.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a completion page nor an error message appeared within 20s after submit — reCAPTCHA may have blocked the automated browser");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await completion.first().isVisible().catch(() => false)) {
      const text = (await completion.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }
    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
