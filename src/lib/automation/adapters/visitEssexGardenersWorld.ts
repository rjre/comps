import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Visit Essex — "Win tickets to BBC Gardeners' World Autumn Fair"
 * (visitessex.com/inspire-me/competitions/win-tickets-to-bbc-gardeners-world-autumn-fair),
 * run directly by Visit Essex (the official Essex destination management
 * organisation). A NewMind/eCMS questionnaire form: title, forename,
 * surname, county, postcode, email, plus one multiple-choice question
 * ("Where is BBC Gardeners' World Autumn Fair 2026 taking place?") whose
 * correct answer ("Audley End House and Gardens, Saffron Walden") is
 * stated directly in the competition's own copy on the same page — not
 * guessed. Two optional consent checkboxes (Visit Essex e-newsletter,
 * prize giver's e-newsletter) are deliberately never ticked; leaving both
 * unticked triggers a one-time "are you sure" confirmation panel rather
 * than blocking submission, so that's handled here too. Protected by an
 * invisible reCAPTCHA — we don't attempt to solve or evade that, just
 * submit normally and fail loudly if it blocks the automated browser.
 */
export const visitEssexGardenersWorldAdapter: CompetitionAdapter = {
  key: "visit-essex-gardeners-world",
  siteName: "Visit Essex",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    // CookieScript CMP — same kind of timing issue seen on other sites in
    // this project (suffolkCoast.ts, muddyStilettosEssex.ts): can render
    // after an initial check, so this gets called again right before the
    // quiz-answer radio click below too.
    const dismissCookieBanner = async (timeout: number) => {
      const reject = page.locator("#cookiescript_reject");
      if (await reject.isVisible({ timeout }).catch(() => false)) {
        await reject.click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("#quesionaireform");
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (#quesionaireform) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    if (!profile.region || !profile.postalCode) {
      await log.warn("Profile is missing county (region) or postcode, both required by this form");
      return { status: "FAILED", message: "Profile missing region/postalCode required by this form" };
    }

    // Required free-text field with no default — unlike suffolkCoast.ts's
    // Title *dropdown* (which already defaults to a sensible value we can
    // leave alone), leaving this blank would just fail the form's own
    // client-side validation.
    if (!profile.title) {
      await log.warn("Profile is missing title, required by this form's free-text Title field");
      return { status: "FAILED", message: "Profile missing title required by this form" };
    }

    await page.locator("#questiontitle").fill(profile.title);
    await page.locator("#questionforename").fill(profile.firstName);
    await page.locator("#questionsurname").fill(profile.lastName);
    await page.locator("#questioncounty").fill(profile.region);
    await page.locator("#questionpostcode").fill(profile.postalCode);
    await page.locator("#questionemail").fill(profile.email);
    await log.info("Filled title, forename, surname, county, postcode, email");

    await dismissCookieBanner(3000);

    // The question's radio group id suffix (e.g. "question-29101") isn't
    // guaranteed stable across page loads, so match the answer by its
    // label text instead — the correct answer, taken from the page's own
    // copy above the form, not guessed.
    const correctAnswer = page.getByLabel(/Audley End House and Gardens/i);
    if ((await correctAnswer.count()) === 0) {
      await log.warn("Expected quiz answer option (Audley End House and Gardens) not found — question text may have changed");
      return { status: "FAILED", message: "Quiz answer option not found on page" };
    }
    await correctAnswer.first().check();
    await log.info("Selected quiz answer: Audley End House and Gardens, Saffron Walden");

    // Both left unticked deliberately: consent value=8091 (Visit Essex
    // e-newsletter), value=8101 (prize giver's e-newsletter). See
    // NewsletterAdapter for opting into either via a standalone signup.

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

    // With no consent ticked, the site shows a one-time "are you sure you
    // don't want to be contacted?" panel with its own Proceed button
    // before actually submitting — clicking it doesn't tick any consent
    // box, it just confirms leaving them unticked.
    const proceed = page.locator('#policy-warning input[name="Submit"][value="Proceed"]');
    if (await proceed.isVisible({ timeout: 5000 }).catch(() => false)) {
      await proceed.click();
      await log.info("Confirmed proceeding without marketing consent");
    }

    // This site injects no confirmation copy into the static page, so
    // match broadly by wording rather than a guessed selector, same
    // approach as nationalLobsterHatchery.ts.
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
