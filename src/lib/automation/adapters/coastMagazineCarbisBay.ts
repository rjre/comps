import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Coast Magazine (Kelsey Media) — "Win a four-night luxury family holiday
 * in Cornwall" (prize at the Carbis Bay Estate, provided by Beach
 * Retreats), same publisher/platform as coastMagazineSuffolkCoast.ts. The
 * magazine article (coastmagazine.co.uk/competitions/win-a-luxury-family-
 * holiday-in-cornwall/) just links out to the actual entry form, a
 * dotdigital/Kelsey "Easy Editor" landing page at coast.kelseydirect.com —
 * this adapter navigates straight there, same reason as the Suffolk Coast
 * one (avoids the article page's separate Sourcepoint cookie-consent CMP
 * entirely; the entry-form domain itself has none). The quiz question
 * ("What is the name of St Ives' most famous gallery?") has a directly
 * researchable answer (Tate St Ives — confirmed independently, not just
 * taken from the competition's own copy). Three required Yes/No radios are
 * separate from the quiz and always answered No (two Kelsey newsletters,
 * one "offers and promotions" question); a fourth, unrelated checkbox
 * offering Carbis Bay Estate's own newsletter is present but left
 * unticked, since this is a competition entry, not a newsletter signup.
 * Closes midnight 30 September 2026. Free entry, no purchase necessary,
 * per Kelsey's own T&Cs on the article page.
 */
const ENTRY_URL = "https://coast.kelseydirect.com/p/5D8F-KQW/carbis-bay";

export const coastMagazineCarbisBayAdapter: CompetitionAdapter = {
  key: "coast-magazine-carbis-bay",
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
    await log.info("Selected quiz answer: A) Tate St Ives");

    await page.locator('input[name="1"]').fill(profile.firstName);
    await page.locator('input[name="5"]').fill(profile.lastName);
    await page.locator('input[name="3"]').fill(profile.email);
    if (!profile.postalCode) {
      await log.warn("Profile is missing postalCode, required by this form");
      return { status: "FAILED", message: "Profile missing postalCode required by this form" };
    }
    await page.locator('input[name="2"]').fill(profile.postalCode);
    await log.info("Filled first name, surname, email, postcode");
    if (profile.phone) {
      await page.locator('input[name="4"]').fill(profile.phone);
      await log.info("Filled phone (optional field on this form)");
    }

    await page.locator('input[name="32"][value="1"]').check();
    await log.info("Answered 'Are you aged 18 or over?': Yes");

    await page.locator('input[name="22"][value="2"]').check();
    await page.locator('input[name="34"][value="2"]').check();
    await page.locator('input[name="24"][value="2"]').check();
    await log.info("Declined Coast Beachcomber newsletter, Coast Property newsletter, and Kelsey Media offers/promotions (all required Yes/No questions, answered No)");
    // #consent-47 ("receive news and offers from Carbis Bay Estate via
    // email") deliberately left unticked — see NewsletterAdapter for
    // opting into an organisation's own newsletter via a standalone signup
    // instead.

    const termsCheckbox = page.locator("#consent-9");
    if ((await termsCheckbox.count()) === 0) {
      await log.warn("Expected 'I have read the Terms & Conditions' checkbox (#consent-9) not found");
      return { status: "FAILED", message: "Required terms checkbox not found on page" };
    }
    await termsCheckbox.check();
    await log.info("Ticked 'I have read the Terms & Conditions' — required to enter, not a marketing consent");

    // This dotdigital page engine's submit control is only made visible
    // once the visible required fields are filled, and different pages on
    // the same engine render it as either a <button> or an
    // <input type="submit"> with the same class (same engine as
    // coastMagazine.ts and coastMagazineSuffolkCoast.ts) — :visible picks
    // out whichever is actually the real, clickable control right now.
    const submit = page.locator(".paging-button-submit:visible");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found or not yet visible");
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
    // the other Kelsey adapters in this project.
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
