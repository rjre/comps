import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Coast Magazine (Kelsey Media) — "Win a Unique Break on the Suffolk
 * Coast", created in partnership with The Suffolk Coast tourism board.
 * The magazine's article (coastmagazine.co.uk/competitions/...) just links
 * out to the actual entry form, a dotdigital/Kelsey "Easy Editor" landing
 * page at coast.kelseydirect.com — this adapter navigates straight there
 * to avoid that article page's separate Sourcepoint cookie-consent CMP
 * entirely (the entry-form domain itself has none). The quiz question
 * ("Which organisation is responsible for looking after Orford Ness?") has
 * a directly researchable answer (National Trust — confirmed independently,
 * not just taken from the competition's own copy). Three required Yes/No
 * radios are separate from the quiz and always answered No (two Kelsey
 * newsletters, one "offers and promotions" question); a fourth, unrelated
 * checkbox offering The Suffolk Coast's own newsletter is present but left
 * unticked, since this is a competition entry, not a newsletter signup —
 * see visitEssex.ts/theSuffolkCoast.ts for the pattern of opting into an
 * organisation's newsletter via its own standalone signup instead. The
 * entry domain sits behind Cloudflare with a bot-management script
 * present; we don't attempt to solve or evade that, just submit normally
 * and fail loudly if a challenge page appears instead of the form.
 */
const ENTRY_URL = "https://coast.kelseydirect.com/p/5D8F-KL4/suffolk-coast";

export const coastMagazineSuffolkCoastAdapter: CompetitionAdapter = {
  key: "coast-magazine-suffolk-coast",
  siteName: "Coast Magazine (Kelsey Media)",
  async enterCompetition({ page, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating directly to entry form: ${ENTRY_URL}`);
    await page.goto(ENTRY_URL, { waitUntil: "domcontentloaded" });

    const title = await page.title().catch(() => "");
    if (/just a moment|attention required|checking your browser/i.test(title)) {
      await log.warn(`Landed on what looks like a Cloudflare challenge page (title: "${title}") instead of the entry form`);
      return { status: "FAILED", message: "Blocked by Cloudflare challenge before the form could be reached" };
    }

    const quizAnswer = page.locator('input[name="19"][value="35"]');
    if ((await quizAnswer.count()) === 0) {
      await log.warn("Expected entry form (quiz radio name=19) not found — page may have changed, or a challenge page was served");
      return { status: "FAILED", message: "Entry form not found on page" };
    }
    await quizAnswer.check();
    await log.info("Selected quiz answer: A) National Trust (Orford Ness)");

    await page.locator('input[name="1"]').fill(profile.firstName);
    await page.locator('input[name="5"]').fill(profile.lastName);
    await page.locator('input[name="3"]').fill(profile.email);
    if (profile.phone) {
      await page.locator('input[name="4"]').fill(profile.phone);
    }
    if (!profile.postalCode) {
      await log.warn("Profile is missing postalCode, required by this form");
      return { status: "FAILED", message: "Profile missing postalCode required by this form" };
    }
    await page.locator('input[name="2"]').fill(profile.postalCode);
    await log.info("Filled first name, surname, email, phone (if set), postcode");

    await page.locator('input[name="32"][value="1"]').check();
    await log.info("Answered 'Are you aged 18 or over?': Yes");

    await page.locator('input[name="22"][value="2"]').check();
    await page.locator('input[name="34"][value="2"]').check();
    await page.locator('input[name="24"][value="2"]').check();
    await log.info("Declined Coast Beachcomber newsletter, Coast Property newsletter, and Kelsey Media offers/promotions (all required Yes/No questions, answered No)");
    // #consent-47 ("receive news and offers from Suffolk Coast via email")
    // deliberately left unticked — see NewsletterAdapter for opting into
    // that organisation's own newsletter via a standalone signup instead.

    const termsCheckbox = page.locator("#consent-9");
    if ((await termsCheckbox.count()) === 0) {
      await log.warn("Expected 'I have read the Terms & Conditions' checkbox (#consent-9) not found");
      return { status: "FAILED", message: "Required terms checkbox not found on page" };
    }
    await termsCheckbox.check();
    await log.info("Ticked 'I have read the Terms & Conditions' — required to enter, not a marketing consent");

    const submit = page.locator('input.paging-button-submit[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // This dotdigital landing-page engine renders its confirmation inline
    // (no client-visible text present until after a live submit), so match
    // broadly by wording rather than a guessed selector, same approach as
    // the NewMind-based adapters in this project.
    const success = page.getByText(/thank you|entry received|good luck|you're entered|successfully entered/i);
    const error = page.getByText(/already entered|invalid|error|something went wrong|please answer/i);
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
