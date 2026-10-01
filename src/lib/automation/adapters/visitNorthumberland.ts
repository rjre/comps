import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Visit Northumberland (visitnorthumberland.com), the official Northumberland
 * destination management organisation — a distinct "Competition Form" widget
 * (its own JS component, `.js-competitionform-wrapper` / `.js-competitionform-submit`,
 * not the NewMind/eCMS "quesionaireform" engine used by Visit Essex/North
 * Norfolk/Lake District). Shared by every competition on this site, so one
 * adapter covers all of them: fields are First/Last Name, Email, Address 1,
 * Town, County, Postcode, Country (a UK-first <select>), an optional
 * "Interests" checkbox group, and two independently optional marketing
 * checkboxes (Visit Northumberland's own emails, and the featured prize
 * provider's) — both deliberately left unticked.
 *
 * Confirmed directly from the served HTML/JS (core-js-bundle.js): submit is
 * an invisible reCAPTCHA v3 token (action "competition", not solved or
 * evaded — just executed) followed by a JSON POST to /api/competition. On
 * success the form gets a "hide" class and a sibling `.confirmation` block
 * ("Thank you for signing up to the competition") loses its own "hide"
 * class; on failure `.competitionform_response` is filled with "There was
 * an issue submitting your request" and its wrapper loses "hide". Neither
 * message is present in the static page, so matched by wording, not a
 * guessed selector.
 *
 * The exact same field IDs (FirstName, Email, etc.) are duplicated
 * elsewhere on the page inside a hidden "Newsletter Sign Up" modal that
 * turns out to be a copy-pasted instance of this *same* competition-form
 * component (same Pure360ListName, same "featured in this competition"
 * wording) rather than a genuine separate newsletter — not a real signup
 * target, so every locator here is scoped to the one visible
 * `.js-competitionform-wrapper` rather than a bare `#FirstName`-style
 * selector, which would otherwise be ambiguous.
 */
export const visitNorthumberlandAdapter: CompetitionAdapter = {
  key: "visit-northumberland",
  siteName: "Visit Northumberland",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 }).catch(async () => {
      await log.warn("Page 'load' event didn't fire within 45s — continuing anyway");
    });

    // A self-hosted CookieConsent banner (bottom-right box) — its exact
    // markup isn't visible from static HTML (rendered by its own init
    // script), so match the reject option by its accessible text rather
    // than a guessed class, same principle used for post-submit text
    // elsewhere in this project.
    const dismissCookieBanner = async (timeout: number) => {
      const reject = page.getByRole("button", { name: /reject all|necessary only|decline/i });
      if (await reject.first().isVisible({ timeout }).catch(() => false)) {
        await reject.first().click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(8000);

    const wrapper = page.locator(".js-competitionform-wrapper").first();
    if ((await wrapper.count()) === 0) {
      await log.warn("Expected entry form (.js-competitionform-wrapper) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    if (!profile.addressLine1 || !profile.city || !profile.region || !profile.postalCode) {
      await log.warn("Profile is missing address fields (addressLine1/city/region/postalCode) required by this form");
      return { status: "FAILED", message: "Profile missing address fields required by this form" };
    }

    await wrapper.locator("#FirstName").fill(profile.firstName);
    await wrapper.locator("#LastName").fill(profile.lastName);
    await wrapper.locator("#Email").fill(profile.email);
    await wrapper.locator("#Address1").fill(profile.addressLine1);
    await wrapper.locator("#Town").fill(profile.city);
    await wrapper.locator("#County").fill(profile.region);
    await wrapper.locator("#Postcode").fill(profile.postalCode);
    await wrapper.locator("#Country").selectOption("United Kingdom");
    await log.info("Filled first name, last name, email, and address");

    // Interests checkboxes left untouched (optional, no consent implication).
    // Both marketing checkboxes left unticked deliberately: #EmailMe (Visit
    // Northumberland's own newsletter — see NewsletterAdapter for opting in
    // via a standalone signup instead) and #RdParty (the featured prize
    // provider's marketing).

    await dismissCookieBanner(3000);

    const submit = wrapper.locator(".js-competitionform-submit");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (.js-competitionform-submit) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    const confirmation = wrapper.getByText(/thank you for signing up to the competition/i);
    const error = wrapper.getByText(/there was an issue submitting your request/i);
    try {
      await Promise.race([
        confirmation.first().waitFor({ state: "visible", timeout: 30000 }),
        error.first().waitFor({ state: "visible", timeout: 30000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 30s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await confirmation.first().isVisible().catch(() => false)) {
      const text = (await confirmation.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
