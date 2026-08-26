import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Solmar Villas (solmarvillas.com) is nominated in nine categories at the
 * British Travel Awards this year; voting for them (on the awards' own
 * site, britishtravelawards.com — not solmarvillas.com itself) enters you
 * into a draw for a £5,000 villa holiday. No purchase necessary. This is
 * a genuine mechanical selection (pick a specific named company across
 * fixed categories), not a fabricated personal/creative opinion, so it's
 * within this project's bounds the same way a researched trivia answer is.
 *
 * The vote URL (?nominee=solmar-villas) pre-selects Solmar Villas in all
 * nine of its nominated categories via client-side JS reading the query
 * string, and — confirmed directly via screenshot — the page lands
 * straight on the "Confirm Your Vote" review step (page 2 of the
 * wizard), skipping "Choose your Winner" (page 1) entirely rather than
 * requiring a "Continue" click through it first. Page 2 ("Confirm Vote"
 * review) → page 3 (Name/Email/Phone + an optional, unticked "receive
 * updates" consent checkbox) → final submit labelled "Verify your vote".
 *
 * That label is a deliberate red flag: the phone field's own description
 * says "We'll use this to verify your vote" — if that turns out to mean
 * an SMS/call one-time-code step, this adapter can't complete it (same
 * "don't solve/evade a verification challenge" rule as CAPTCHAs) and
 * fails loudly instead of guessing. Confirmed only that page 3's fields
 * exist via curl'd HTML, not that the actual post-submit flow is
 * automatable end-to-end — first live run needs a human's eyes on the
 * screenshot either way.
 */
export const solmarVillasBritishTravelAwardsAdapter: CompetitionAdapter = {
  key: "solmar-villas-british-travel-awards",
  siteName: "British Travel Awards (Solmar Villas)",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    const cookieReject = page.locator("#onetrust-reject-all-handler, button:has-text('Reject')");
    if (await cookieReject.first().isVisible({ timeout: 8000 }).catch(() => false)) {
      await cookieReject.first().click();
      await log.info("Dismissed cookie banner (rejected non-essential cookies)");
    }

    // Confirm the URL's nominee param actually pre-selected the ballot
    // client-side before proceeding, rather than assuming it.
    const selectedCount = await page.locator("text=Solmar Villas").count();
    if (selectedCount === 0) {
      await log.warn("No pre-selected Solmar Villas entries found on the ballot — page may have changed");
      return { status: "FAILED", message: "Expected pre-selected category votes, found none" };
    }
    await log.info(`Confirmed the ballot is pre-selected for Solmar Villas (${selectedCount} on-page mentions)`);

    // The page lands directly on the "Confirm Your Vote" review step
    // (page 2), not "Choose your Winner" (page 1) — confirmed directly,
    // there's no "Continue" button to click through first.
    const confirmVote = page.locator('input[value="Confirm Vote"]');
    try {
      await confirmVote.waitFor({ state: "visible", timeout: 15000 });
    } catch {
      await log.warn("'Confirm Vote' review page never appeared within 15s");
      return { status: "FAILED", message: "Vote review page did not load" };
    }
    await confirmVote.click();
    await log.info("Reviewed and confirmed the ballot");

    const nameField = page.locator("#input_2_7");
    try {
      await nameField.waitFor({ state: "visible", timeout: 15000 });
    } catch {
      await log.warn("Contact-details page (#input_2_7) never appeared within 15s");
      return { status: "FAILED", message: "Contact-details page did not load" };
    }
    await nameField.fill(`${profile.firstName} ${profile.lastName}`);
    await page.locator("#input_2_8").fill(profile.email);
    if (!profile.phone) {
      await log.warn("Profile has no phone number set, but this form requires one — cannot proceed");
      return { status: "FAILED", message: "Profile phone number is required for this entry but is not set" };
    }
    await page.locator("#input_2_15").fill(profile.phone);
    await log.info("Filled name, email, phone — left the optional 'receive updates' consent checkbox unticked");

    const submit = page.locator("#gform_submit_button_2");
    if ((await submit.count()) === 0) {
      await log.warn("Final submit button (#gform_submit_button_2) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    const confirmation = page.getByText(/vote (has been )?(recorded|confirmed|verified|received)|thank you for voting|check your (phone|email)|enter.*code|verification code/i);
    const fieldError = page.locator(".gfield_validation_message, .validation_message").first();
    try {
      await Promise.race([
        confirmation.first().waitFor({ state: "visible", timeout: 20000 }),
        fieldError.waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor a validation error appeared within 20s after the final submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    const confirmationText = (await confirmation.first().innerText().catch(() => "")).trim();
    if (/enter.*code|verification code/i.test(confirmationText)) {
      await log.warn(`This form requires entering a one-time verification code sent by phone/email — not attempting to solve or evade this: "${confirmationText}"`);
      return { status: "FAILED", message: "Blocked by a one-time verification code step — not solved or evaded" };
    }

    if (await confirmation.first().isVisible().catch(() => false)) {
      await log.info(`Confirmation shown: ${confirmationText}`);
      return { status: "SUCCESS", message: confirmationText || undefined };
    }

    const errorText = (await fieldError.innerText().catch(() => "")).trim();
    await log.warn(`Form validation error: ${errorText || "(no error text found)"}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText || "unknown validation error"}` };
  },
};
