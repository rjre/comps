import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Visit Essex's NewMind/eCMS prize draws — "Win tickets to BBC Gardeners'
 * World Autumn Fair"
 * (visitessex.com/inspire-me/competitions/win-tickets-to-bbc-gardeners-world-autumn-fair)
 * and its sibling "Win a meal for two at Downham Hall"
 * (visitessex.com/inspire-me/competitions/win-a-meal-for-two-at-downham-hall),
 * both run directly by Visit Essex (the official Essex destination
 * management organisation) on the same platform already documented in
 * northNorfolkAttractions.ts. Same quiz-question-with-a-verifiable-answer
 * shape as that adapter, matched per-URL below since the question and
 * correct answer differ each time (never guessed — each is stated
 * directly in that competition's own page copy). The Gardeners' World
 * form also has a County field the Downham Hall one doesn't (confirmed by
 * fetching both directly) — filled only when present. Two optional
 * consent checkboxes (Visit Essex e-newsletter, prize giver's
 * e-newsletter) are deliberately never ticked; leaving both unticked
 * triggers a one-time "are you sure" confirmation panel rather than
 * blocking submission, so that's handled here too. Protected by an
 * invisible reCAPTCHA — we don't attempt to solve or evade that, just
 * submit normally and fail loudly if it blocks the automated browser.
 */
const QUESTION_ANSWERS: Record<string, RegExp> = {
  "https://www.visitessex.com/inspire-me/competitions/win-tickets-to-bbc-gardeners-world-autumn-fair":
    /Audley End House and Gardens/i, // stated in the competition's own copy: fair takes place at Audley End House and Gardens, Saffron Walden
  "https://www.visitessex.com/inspire-me/competitions/win-a-meal-for-two-at-downham-hall":
    /North Wing Restaurant/i, // stated in the competition's own copy: "...meal for two people in the North Wing Restaurant"
};

export const visitEssexGardenersWorldAdapter: CompetitionAdapter = {
  key: "visit-essex-gardeners-world",
  siteName: "Visit Essex",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    const answerPattern = QUESTION_ANSWERS[competitionUrl];
    if (!answerPattern) {
      await log.warn(`No researched quiz answer recorded for ${competitionUrl} — add one to QUESTION_ANSWERS before this can run`);
      return { status: "FAILED", message: "No quiz answer recorded for this competition URL" };
    }

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

    if (!profile.postalCode) {
      await log.warn("Profile is missing postalCode, required by this form");
      return { status: "FAILED", message: "Profile missing postalCode required by this form" };
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

    // Only the Gardeners' World form has a County field — confirmed
    // directly the Downham Hall sibling doesn't, so it's filled only when
    // present rather than assumed required across every competition this
    // adapter covers.
    const countyField = page.locator("#questioncounty");
    if ((await countyField.count()) > 0) {
      if (!profile.region) {
        await log.warn("Profile is missing county (region), required by this competition's form");
        return { status: "FAILED", message: "Profile missing region required by this form" };
      }
      await countyField.fill(profile.region);
    }

    await page.locator("#questionpostcode").fill(profile.postalCode);
    await page.locator("#questionemail").fill(profile.email);
    await log.info("Filled title, forename, surname, postcode, email" + ((await countyField.count()) > 0 ? ", county" : ""));

    await dismissCookieBanner(3000);

    // The question's radio group id suffix (e.g. "question-29101") isn't
    // guaranteed stable across page loads, so match the answer by its
    // label text instead — the correct answer, taken from each
    // competition's own copy above the form (QUESTION_ANSWERS), not
    // guessed.
    const correctAnswer = page.getByLabel(answerPattern);
    if ((await correctAnswer.count()) === 0) {
      await log.warn(`Expected quiz answer option (${answerPattern}) not found — question text may have changed`);
      return { status: "FAILED", message: "Quiz answer option not found on page" };
    }
    await correctAnswer.first().check();
    await log.info(`Selected quiz answer matching ${answerPattern}`);

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
