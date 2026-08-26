import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Visit Lake District (visitlakedistrict.com) — the official Lake
 * District tourism board, same NewMind/eCMS questionnaire engine as
 * visitEssexGardenersWorld.ts and northNorfolkAttractions.ts. One shared
 * adapter reused across multiple currently-open prize draws on this site
 * (confirmed directly, all identical form structure): Ravenglass &
 * Eskdale Railway afternoon tea, a Beatrix Potter-themed visit, and a
 * Windermere Marina Village short break — register each as its own
 * Competition row pointing at this same adapterKey, same pattern as
 * tui-monthly-giveaway.ts.
 *
 * Cookie banner: confirmed directly this site actually uses CookieScript
 * (#cookiescript_reject), same as visitessex.com/visitnorthnorfolk.com —
 * an initial assumption that it was the native NewMind bar instead
 * (a.CookieWarningHide) turned out wrong for two of three sibling
 * competitions live (the third succeeded without hitting it at all,
 * suggesting inconsistent render timing rather than a different CMP per
 * page) — both are checked for, CookieScript first.
 *
 * Question 1 ("What are you interested in?") is a genuinely optional
 * multi-select marketing-interest checklist, not a quiz —
 * confirmed no required attribute or asterisk present — left entirely
 * untouched rather than fabricating a preference. Three per-competition
 * consent checkboxes (organiser + two named partners) are matched
 * generically by name="consent" rather than hardcoded per-instance
 * values, and none are ticked — same "never tick marketing on a
 * COMPETITION form" rule as every other adapter here, even for the
 * organiser's own first-party one (it has its own dedicated newsletter
 * signup for that).
 */
export const visitLakeDistrictAdapter: CompetitionAdapter = {
  key: "visit-lake-district-prize-draw",
  siteName: "Visit Lake District",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    const dismissCookieBanner = async (timeout: number) => {
      const cookieScriptReject = page.locator("#cookiescript_reject");
      if (await cookieScriptReject.isVisible({ timeout }).catch(() => false)) {
        await cookieScriptReject.click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
        return;
      }
      const nativeHide = page.locator("a.CookieWarningHide");
      if (await nativeHide.first().isVisible({ timeout: 1000 }).catch(() => false)) {
        await nativeHide.first().click();
        await log.info("Dismissed cookie warning bar");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("#quesionaireform");
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (#quesionaireform) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    await page.locator("#questionforename").fill(profile.firstName);
    await page.locator("#questionsurname").fill(profile.lastName);
    await page.locator("#questionemail").fill(profile.email);
    await log.info("Filled forename, surname, email — left the optional 'What are you interested in?' checklist and all consent checkboxes untouched");

    await dismissCookieBanner(3000);

    const submit = page.locator('input[name="Submit"][value="Submit Answers"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (input[name=Submit][value='Submit Answers']) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    try {
      await submit.click({ timeout: 8000 });
    } catch {
      // Confirmed directly (live, three times): this page can have more
      // than one overlay intercepting the submit click — the CookieScript
      // dialog re-rendering after being dismissed once, and separately a
      // Mailchimp popup widget (id starting "mcforms-") neither dismiss
      // checkpoint above even targets. Removing whatever's actually
      // blocking is the reliable fix here, same approach already proven
      // for jet2holidays-newsletter, generalised to cover both.
      await log.warn("Submit click was blocked by an overlay (cookie dialog or popup widget) — removing known culprits and retrying");
      await page.evaluate(() => {
        document.querySelector("#cookiescript_injected_wrapper")?.remove();
        document.querySelectorAll('[id^="mcforms-"]').forEach((el) => el.remove());
      });
      await submit.click();
    }

    // Same "are you sure you don't want to be contacted?" confirmation
    // panel as the other NewMind-based adapters in this project.
    const proceed = page.locator('#policy-warning input[name="Submit"][value="Proceed"]');
    if (await proceed.isVisible({ timeout: 5000 }).catch(() => false)) {
      await proceed.click();
      await log.info("Confirmed proceeding without marketing consent");
    }

    const success = page.getByText(/thank you|you're entered|good luck|entry received|successfully entered/i);
    const error = page.getByText(/already entered|invalid|error|something went wrong|please enter/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 15s after submit");
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
