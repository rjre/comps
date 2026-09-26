import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Visit North Devon's NewMind/eCMS prize draw — "Win a stay at Woolacombe
 * Bay Hotel" (visitdevon.co.uk/northdevon/.../win-a-stay-at-woolacombe-bay-hotel/),
 * run directly by Visit North Devon (part of the official Visit Devon
 * tourism board network). Same underlying eCMS as visitEssexGardenersWorld.ts
 * and northNorfolkAttractions.ts, but this org embeds the actual form as a
 * cross-origin <iframe id="embedForm"> pointing at visitdevon-ws.newmindmedia.com
 * rather than serving it same-origin — confirmed directly, so this one needs
 * a frameLocator (same technique as diggerlandPrizeDraw.ts) instead of
 * querying the top-level page.
 *
 * No quiz question on this one — "question 1" is a single checkbox whose
 * label *is* the entry action itself ("By ticking this box you are
 * agreeing to enter this competition"), confirmed from the form's own
 * markup, not a marketing opt-in. Two further, genuinely-optional
 * marketing checkboxes (Visit North Devon / the prize provider) are left
 * unticked; the form's own onQuestionnaireSubmit() script (read directly)
 * only warns via a #policy-warning/Proceed panel when both are left
 * blank — same non-blocking pattern as the sibling adapters. Protected by
 * an invisible reCAPTCHA v2 — not solved or evaded, just submitted
 * normally.
 *
 * This competition's page states no closing date at all (confirmed by
 * reading the full page and linked T&Cs directly) — entered on an ongoing
 * basis until it's next found closed/replaced by another Visit Devon
 * microsite competition.
 */
export const visitNorthDevonAdapter: CompetitionAdapter = {
  key: "visit-north-devon",
  siteName: "Visit North Devon",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2500);

    // CookieScript CMP, same as visitessex.com/visitnorthnorfolk.com — can
    // render after this first check, so called again right before the
    // final submit click below too.
    const dismissCookieBanner = async (timeout: number) => {
      const reject = page.locator("#cookiescript_reject");
      if (await reject.isVisible({ timeout }).catch(() => false)) {
        await reject.click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const formFrameLocator = page.locator("iframe#embedForm");
    if ((await formFrameLocator.count()) === 0) {
      await log.warn("No embedded entry form iframe (#embedForm) found on the page — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }
    const form = page.frameLocator("iframe#embedForm").first();

    if (!profile.postalCode) {
      await log.warn("Profile is missing postalCode, required by this form");
      return { status: "FAILED", message: "Profile missing postalCode required by this form" };
    }

    await form.locator("#questionforename").fill(profile.firstName);
    await form.locator("#questionsurname").fill(profile.lastName);
    await form.locator("#questionpostcode").fill(profile.postalCode);
    await form.locator("#questionemail").fill(profile.email);
    let filledFields = "forename, surname, postcode, email";
    // Optional — no required class on this field, confirmed from the form's
    // own markup — only filled when the profile has one.
    if (profile.phone) {
      await form.locator("#questiontelephone").fill(profile.phone);
      filledFields += ", telephone";
    }
    await log.info(`Filled ${filledFields}`);

    const enterCheckbox = form.locator("#question-91425-1");
    if ((await enterCheckbox.count()) === 0) {
      await log.warn("Expected entry checkbox (#question-91425-1) not found — page may have changed");
      return { status: "FAILED", message: "Entry checkbox not found on page" };
    }
    await enterCheckbox.check();
    await log.info("Ticked 'By ticking this box you are agreeing to enter this competition' — the entry action itself, not marketing");

    // Both left unticked deliberately: consent value=13481 ("contacted by
    // Visit North Devon with offers, competitions and information"),
    // value=13491 ("contacted by the prize provider"). See NewsletterAdapter
    // for opting into either via a standalone signup instead.

    await dismissCookieBanner(3000);

    const submit = form.locator('input[name="Submit"][value="Submit Answers"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (input[name=Submit][value='Submit Answers']) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // With no consent ticked, this platform shows a one-time "are you sure
    // you don't want to be contacted?" panel with its own Proceed button
    // before actually submitting — same as visitEssexGardenersWorld.ts and
    // northNorfolkAttractions.ts. Clicking it doesn't tick any consent box,
    // it just confirms leaving them unticked.
    const proceed = form.locator('#policy-warning input[name="Submit"][value="Proceed"]');
    if (await proceed.isVisible({ timeout: 5000 }).catch(() => false)) {
      await proceed.click();
      await log.info("Confirmed proceeding without marketing consent");
    }

    // Invisible reCAPTCHA can add real delay before the underlying POST
    // resolves, and this platform injects no static confirmation copy, so
    // match broadly by wording (same as the sibling NewMind adapters) with
    // a generous timeout rather than assuming a quick response.
    const success = form.getByText(/thank you|you're entered|good luck|entry received|successfully entered/i);
    const error = form.getByText(/already entered|invalid|error|something went wrong|please enter/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 30000 }),
        error.first().waitFor({ state: "visible", timeout: 30000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 30s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
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
