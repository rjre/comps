import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Advantage Travel Partnership — "Win a Caribbean cruise for two with
 * Ambassador Cruise Line" (advantagetravelcompetition.co.uk). Advantage
 * Travel Partnership is a genuine, large UK travel trade association (its
 * own dedicated competitions domain, not a lead-gen aggregator listing
 * other orgs' draws) — found via cruisemummy.co.uk as a lead, entered here
 * on the promoter's own domain. No purchase necessary (confirmed via its
 * own T&Cs: "The prize draw is free to enter, and no purchase is
 * necessary"), UK residents 18+, one entry per household. Closes 3 Sept
 * 2026 (tight).
 *
 * A SeedProd landing page with an embedded Gravity Forms form (id 6):
 * First Name, Last Name, Email + confirm Email, Phone, Address line 1,
 * Town/City, Postcode (country hardcoded "United Kingdom"), a required
 * "Have you ever cruised before?" Yes/No radio (answered "No" — no prior
 * cruise history on this profile to draw on), an opt-OUT "Do Not Contact"
 * checkbox (left unticked — we want to be contactable, more marketing
 * reach means more competition leads found), and a required "I agree to
 * the competition terms and conditions" consent checkbox (ticked).
 *
 * Also has a real, empty honeypot text field (`input_21`, `autocomplete
 * ="new-password"`, visually hidden) — a standard Gravity Forms anti-spam
 * trap. Left completely untouched/blank, same as any genuine human visitor
 * would leave it (filling it would flag the submission as spam — this
 * isn't something to fill in, it's something to not touch).
 *
 * reCAPTCHA is explicitly disabled on this page (confirmed directly via
 * its own inline script: `seeprod_enable_recaptcha = 0`).
 */
export const advantageTravelAmbassadorCaribbeanAdapter: CompetitionAdapter = {
  key: "advantage-travel-ambassador-caribbean",
  siteName: "Advantage Travel Partnership — Ambassador Cruise Line Caribbean cruise",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(1500);

    const form = page.locator("#gform_6");
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (#gform_6) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    await form.locator('input[name="input_1.3"]').fill(profile.firstName);
    await form.locator('input[name="input_1.6"]').fill(profile.lastName);
    await form.locator('input[name="input_2"]').fill(profile.email);
    await form.locator('input[name="input_2_2"]').fill(profile.email);
    await log.info("Filled first name, last name, email, confirm email — left the honeypot field (input_21) untouched");

    if (profile.phone) {
      await form.locator('input[name="input_8"]').fill(profile.phone);
    }
    if (!profile.addressLine1 || !profile.city || !profile.postalCode) {
      await log.warn("Profile is missing address/city/postcode — required by this form");
      return { status: "FAILED", message: "Profile missing required address fields" };
    }
    await form.locator('input[name="input_9.1"]').fill(profile.addressLine1);
    await form.locator('input[name="input_9.3"]').fill(profile.city);
    await form.locator('input[name="input_9.5"]').fill(profile.postalCode);
    await log.info("Filled phone, address, town, postcode (country is hardcoded to United Kingdom)");

    const cruisedBeforeNo = form.locator('input[name="input_20"][value="No"]');
    if ((await cruisedBeforeNo.count()) === 0) {
      await log.warn('Expected "Have you ever cruised before?" No option not found — page may have changed');
      return { status: "FAILED", message: "Required radio option not found" };
    }
    await cruisedBeforeNo.check();
    await log.info('Answered "Have you ever cruised before?" — No. Left the "Do Not Contact" checkbox unticked (we want to be contactable)');

    const consentCheckbox = form.locator('input[name="input_5.1"]');
    if ((await consentCheckbox.count()) === 0) {
      await log.warn("Required T&Cs consent checkbox (input_5.1) not found");
      return { status: "FAILED", message: "Required T&Cs consent checkbox not found on page" };
    }
    await consentCheckbox.check();
    await log.info("Ticked required 'I agree to the competition terms and conditions' checkbox");

    const submit = form.locator("#gform_submit_button_6");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#gform_submit_button_6) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    const confirmation = page.getByText(/thank you|you'?re entered|good luck|entry received|successfully entered|entered the (prize draw|competition)/i);
    const error = page.getByText(/already entered|invalid|error|something went wrong|please enter|is required/i);
    try {
      await Promise.race([
        confirmation.first().waitFor({ state: "visible", timeout: 20000 }),
        error.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 20s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await confirmation.first().isVisible().catch(() => false)) {
      const text = (await confirmation.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Form rejected submission: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
