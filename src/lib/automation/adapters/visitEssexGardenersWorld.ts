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
  async enterCompetition({ page, competitionUrl, profile, log }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    const form = page.locator("#quesionaireform");
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (#quesionaireform) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    if (!profile.region || !profile.postalCode) {
      await log.warn("Profile is missing county (region) or postcode, both required by this form");
      return { status: "FAILED", message: "Profile missing region/postalCode required by this form" };
    }

    await page.locator("#questionforename").fill(profile.firstName);
    await page.locator("#questionsurname").fill(profile.lastName);
    await page.locator("#questioncounty").fill(profile.region);
    await page.locator("#questionpostcode").fill(profile.postalCode);
    await page.locator("#questionemail").fill(profile.email);
    await log.info("Filled forename, surname, county, postcode, email");

    // This form has a required free-text "Title" field (Mr/Mrs/Ms/...) with
    // no default value and no equivalent in our Profile model. Unlike
    // suffolkCoast.ts's Title *dropdown* (which already has a sensible
    // default we can safely leave alone), this is a required text input —
    // leaving it blank would just fail the form's own client-side
    // validation, so fail loudly here instead of guessing a title.
    const titleField = page.locator("#questiontitle");
    if ((await titleField.count()) === 0) {
      await log.warn("Expected Title field (#questiontitle) not found — page may have changed");
      return { status: "FAILED", message: "Title field not found on page" };
    }
    await log.warn("Form requires a 'Title' field (Mr/Mrs/Ms/...) which Profile has no equivalent for");
    return {
      status: "FAILED",
      message: "Profile is missing a title field required by this form (Mr/Mrs/Ms/...) — cannot fill it without guessing",
    };

    // The rest of the flow, for once a title-equivalent field exists on
    // Profile:
    //
    // 1. Fill #questiontitle from that field.
    // 2. Select the radio in the "question-29101" group via its label text
    //    (the numeric id suffix isn't guaranteed stable) matching
    //    /Audley End House and Gardens/i — the answer given in the page's
    //    own copy above the form.
    // 3. Leave both `input[name="consent"]` checkboxes (Visit Essex
    //    e-newsletter, prize giver's e-newsletter) unticked — see the
    //    NewsletterAdapter system for opting into either deliberately via
    //    a standalone signup instead.
    // 4. Click `input[name="Submit"][value="Submit Answers"]`. If the
    //    no-consent confirmation panel (#policy-warning) appears, click its
    //    own `input[name="Submit"][value="Proceed"]` — that only dismisses
    //    the "are you sure you don't want to be contacted" prompt, it
    //    doesn't tick any consent box.
    // 5. This site injects no confirmation copy into the static page, so
    //    match broadly by wording (e.g.
    //    page.getByText(/thank you|you're entered|good luck/i)) alongside
    //    an error-text match, and treat neither appearing within a
    //    reasonable timeout as an unclear/FAILED outcome rather than a
    //    false-positive success — same approach as nationalLobsterHatchery.ts.
  },
};
