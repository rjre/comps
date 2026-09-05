import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Visit North Norfolk's NewMind/eCMS prize draws — "Win Passes to North
 * Norfolk Attractions" (visitnorthnorfolk.com/win-passes-to-north-norfolk-attractions)
 * and its sibling "Win a Winter Shepherd Hut Stay at The Victoria"
 * (visitnorthnorfolk.com/win-a-stay-in-a-shepherd-hut-at-the-victoria-holkham),
 * run directly by Visit North Norfolk, the official tourism board. Same
 * NewMind/eCMS questionnaire engine as visitEssexGardenersWorld.ts and
 * visitEssex.ts, so the same quirks apply: an unticked marketing-consent
 * checkbox triggers a one-time "are you sure" confirmation panel instead of
 * blocking submission, and there's an invisible reCAPTCHA we don't attempt
 * to solve or evade. The one question ("Have you ever visited North
 * Norfolk before?") isn't a quiz with a right answer — it's Yes/No either
 * way, so it's answered truthfully rather than researched. Its radio-group
 * field name (question-27021 on the Attractions page, question-28931 on
 * the Shepherd Hut page — confirmed by fetching both directly) isn't
 * stable across competitions on this platform, so it's matched by the
 * question's own row text instead of a hardcoded field id, letting both
 * competitions share this one adapter.
 */
export const northNorfolkAttractionsAdapter: CompetitionAdapter = {
  key: "north-norfolk-attractions",
  siteName: "Visit North Norfolk",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    // This site actually uses the CookieScript CMP (same as
    // visitessex.com), not NewMind's own native cookie bar — checked
    // directly against the real page. Renders asynchronously, so this is
    // called again right before the question radio click below too.
    const dismissCookieBanner = async (timeout: number) => {
      const cookieScriptReject = page.locator("#cookiescript_reject");
      if (await cookieScriptReject.isVisible({ timeout }).catch(() => false)) {
        await cookieScriptReject.click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
        return;
      }
      const nativeHide = page.locator("div.ctl_CookieWarning a.CookieWarningHide");
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
    await log.info("Filled forename, surname, email");

    await dismissCookieBanner(3000);

    const questionRow = page.locator(".row", { hasText: "Have you ever visited North Norfolk before?" });
    const visitedBefore = questionRow.locator('input[value="No"]');
    if ((await visitedBefore.count()) === 0) {
      await log.warn("Expected 'Have you visited North Norfolk before?' question not found — page may have changed");
      return { status: "FAILED", message: "Question option not found on page" };
    }
    await visitedBefore.first().check();
    await log.info("Answered 'Have you ever visited North Norfolk before?': No");

    // Left unticked deliberately: this platform's own per-competition
    // consent checkboxes (e.g. consent value=8331 "I am happy to receive
    // emails from Visit North Norfolk" on the Attractions page; 8911/8921
    // for Visit North Norfolk/Holkham respectively on the Shepherd Hut
    // page). See NewsletterAdapter for opting into either via a standalone
    // signup instead.

    const submit = page.locator('input[name="Submit"][value="Submit Answers"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (input[name=Submit][value='Submit Answers']) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // Same "are you sure you don't want to be contacted?" confirmation
    // panel as visitEssexGardenersWorld.ts — clicking it doesn't tick any
    // consent box, it just confirms leaving it unticked.
    const proceed = page.locator('#policy-warning input[name="Submit"][value="Proceed"]');
    if (await proceed.isVisible({ timeout: 5000 }).catch(() => false)) {
      await proceed.click();
      await log.info("Confirmed proceeding without marketing consent");
    }

    // No confirmation copy present in the static page, so match broadly by
    // wording rather than a guessed selector, same approach as the other
    // NewMind-based adapters in this project.
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
