import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * The Suffolk Coast — "Gather Prizes" couples' getaway prize draw
 * (thesuffolkcoast.co.uk/competition-entry-2), run directly by The Suffolk
 * Coast Ltd, the area's official tourism board. An ASP.NET WebForms form
 * embedded on the page: title, name, email, full address, year of birth,
 * phone. Two optional marketing checkboxes (Suffolk Coast offers, prize
 * provider offers) are deliberately never ticked; the "I agree to terms
 * and conditions" checkbox is ticked since that's acceptance of the
 * competition's own rules, not a marketing consent.
 */
export const suffolkCoastAdapter: CompetitionAdapter = {
  key: "suffolk-coast",
  siteName: "The Suffolk Coast",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    const cookieDecline = page.locator("#CybotCookiebotDialogBodyButtonDecline");
    if (await cookieDecline.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cookieDecline.click();
      await log.info("Dismissed cookie banner (declined non-essential cookies)");
    }

    const form = page.locator("#ctl00_contentBody_panelFormFoodDrink");
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (#ctl00_contentBody_panelFormFoodDrink) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    if (!profile.dateOfBirth) {
      await log.warn("Profile is missing dateOfBirth — this form requires a Year of Birth");
      return { status: "FAILED", message: "Profile missing dateOfBirth required by this form" };
    }
    if (!profile.phone || !profile.addressLine1 || !profile.city || !profile.region || !profile.postalCode) {
      await log.warn("Profile is missing phone/address fields required by this form");
      return { status: "FAILED", message: "Profile missing phone/address fields required by this form" };
    }

    // Title (Mr/Mrs/Ms/...) has no equivalent field in our Profile model —
    // left as whatever the form defaults to rather than guessed.
    await log.info("Profile has no title field — leaving the form's default Title selection as-is");

    await page.locator("#ctl00_contentBody_txtName").fill(profile.firstName);
    await page.locator("#ctl00_contentBody_txtSName").fill(profile.lastName);
    await page.locator("#ctl00_contentBody_txtEmail").fill(profile.email);
    await page.locator("#ctl00_contentBody_txtAddress").fill(profile.addressLine1 ?? "");
    if (profile.addressLine2) {
      await page.locator("#ctl00_contentBody_txtAddress2").fill(profile.addressLine2);
    }
    await page.locator("#ctl00_contentBody_txtTown").fill(profile.city ?? "");
    await page.locator("#ctl00_contentBody_txtCounty").fill(profile.region ?? "");
    await page.locator("#ctl00_contentBody_txtPostcode").fill(profile.postalCode ?? "");
    const birthYear = String(new Date(profile.dateOfBirth).getUTCFullYear());
    await page.locator("#ctl00_contentBody_txtYearBirth").selectOption(birthYear);
    await page.locator("#ctl00_contentBody_txtPhone").fill(profile.phone);
    await log.info("Filled name, email, address, year of birth, and phone");

    // Required to enter at all — accepting the competition's own rules, not marketing.
    await page.locator("#ctl00_contentBody_chkAgree").check();
    // Both left unchecked deliberately: #chkTheSuffolkCoastoffers, #chkPrizeproviderOffers

    const submit = page.locator("#ctl00_contentBody_btEstablishmentSend");
    if ((await submit.count()) === 0) {
      await log.warn("Submit link (#ctl00_contentBody_btEstablishmentSend) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();
    await page.waitForLoadState("networkidle").catch(() => {});

    const bodyText = await page.locator("body").innerText().catch(() => "");
    const lower = bodyText.toLowerCase();
    if (lower.includes("thank you") || lower.includes("good luck") || lower.includes("entered")) {
      await log.info("Confirmation text found after submit");
      return { status: "SUCCESS" };
    }
    if (lower.includes("this field is required") || lower.includes("please enter") || lower.includes("invalid")) {
      await log.warn("Validation error text found after submit");
      return { status: "FAILED", message: "Form appears to have rejected the submission (validation error text present)" };
    }

    await log.warn("No confirmation or error text recognised after submit — outcome unclear");
    return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
  },
};
