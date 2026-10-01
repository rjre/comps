import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Official London Theatre (SOLT) — "Win two tickets to Into The Woods plus
 * an overnight stay and meal at Z Hotels Covent Garden"
 * (officiallondontheatre.com/webforms/win-two-tickets-to-into-the-woods-plus-an-overnight-stay-and-meal-at-z-hotels-covent-garden/),
 * a sibling of officialLondonTheatreHeathers.ts on the same
 * webforms/"prizeDraw" template — but every field id here is a fresh GUID
 * scoped to this instance (confirmed directly), so it needs its own
 * adapter rather than reusing that one's hardcoded ids. Free to enter, one
 * entry per person, prize draw runs 26.09.2026 to 10.10.2026 (per this
 * competition's own T&Cs, in the same expandable <details> block as
 * Heathers' — no purchase necessary).
 *
 * Fields (from this instance's own "webform-state" JSON, confirmed via
 * curl — no client JS execution needed to discover them): First Name,
 * Last Name, Email, optional Postcode, and a required numeric "Total
 * number of people in your party (maximum of 6 places)" — genuinely asking
 * how many the entrant wants tickets for, not a guessed quiz value, so
 * filled with 2 to match this competition's own advertised prize (a pair
 * of tickets, a stay "for 2 ppl"). Three optional third-party/OLT
 * marketing checkboxes (Theatre Tokens, Official London Theatre's own
 * emails, Z Hotels) are deliberately left unticked; only the required
 * "I confirm I am 18+ and have read the T&Cs" checkbox is ticked
 * (competition-rules acceptance, not marketing).
 *
 * Submission mechanics, Cloudflare bot-management note, and the floating
 * consent-widget workaround are all identical to
 * officialLondonTheatreHeathers.ts on this same domain/theme — see that
 * file for the detail. This one has no venue-choice radio group (single
 * prize, not one-per-tour-venue).
 */
const FIRST_NAME_FIELD = "27af740f-acf5-4980-8b66-c89264239b8a";
const LAST_NAME_FIELD = "9fa286b7-1234-4f85-920f-4c23cd8c759a";
const EMAIL_FIELD = "68f8800b-03e7-47c0-a0e4-be1502a5c727";
const POSTCODE_FIELD = "38b7bc41-cf95-45b6-a896-18cafa76be76";
const PARTY_SIZE_FIELD = "a04a4d8a-837d-435e-9f8b-1ba9825d2db1";
const PARTY_SIZE_VALUE = "2"; // matches this competition's own advertised prize (a pair of tickets, a stay "for 2 ppl")
const OVER18_TERMS_FIELD = "5859e474-225d-456a-8d2a-8eb167be5179";
// Left deliberately unticked (marketing, not required to enter):
//   4c770c92-f47e-4efe-b564-c2a7cf14bcc6 — Theatre Tokens emails
//   a6a33d1a-765f-4753-93b6-b901a4eb88ef — Official London Theatre's own emails
//   e6e2f634-6dc8-44b8-a4a1-4946fa912a78 — Z Hotels emails
const AJAX_URL = "https://officiallondontheatre.com/wp/wp-admin/admin-ajax.php";

export const officialLondonTheatreIntoTheWoodsAdapter: CompetitionAdapter = {
  key: "official-london-theatre-into-the-woods",
  siteName: "Official London Theatre (SOLT) — Into The Woods / Z Hotels",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2000);

    const title = await page.title().catch(() => "");
    if (/just a moment|attention required|checking your browser/i.test(title)) {
      await log.warn(`Landed on what looks like a Cloudflare challenge page (title: "${title}") instead of the entry form`);
      return { status: "FAILED", message: "Blocked by Cloudflare challenge before the form could be reached" };
    }

    // Same floating consent widget as officialLondonTheatre.ts's newsletter
    // adapter and officialLondonTheatreHeathers.ts on this domain — neutralise
    // it outright rather than chase its buttons.
    await page.addStyleTag({
      content:
        "div[class*='_flo-consent']{ display: none !important; pointer-events: none !important; } " +
        "body[class*='_flo-consent']{ overflow: auto !important; }",
    });

    const form = page.locator("#olt-webform");
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (#olt-webform) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    await form.locator(`input[name="${FIRST_NAME_FIELD}"]`).fill(profile.firstName);
    await form.locator(`input[name="${LAST_NAME_FIELD}"]`).fill(profile.lastName);
    await form.locator(`input[name="${EMAIL_FIELD}"]`).fill(profile.email);
    if (profile.postalCode) {
      await form.locator(`input[name="${POSTCODE_FIELD}"]`).fill(profile.postalCode);
    }
    await form.locator(`input[name="${PARTY_SIZE_FIELD}"]`).fill(PARTY_SIZE_VALUE);
    await log.info(`Filled first name, last name, email${profile.postalCode ? ", postcode" : ""}, party size (${PARTY_SIZE_VALUE})`);

    // Same custom-styled, label-wrapped checkbox pattern as
    // officialLondonTheatreHeathers.ts — each checkbox field also pairs with
    // a hidden `type="hidden" value="false"` input sharing the same name, so
    // this is scoped to the real checkbox specifically.
    const termsCheckbox = form.locator(`input[type="checkbox"][name="${OVER18_TERMS_FIELD}"]`);
    if ((await termsCheckbox.count()) === 0) {
      await log.warn(`Expected required 18+/terms checkbox (name="${OVER18_TERMS_FIELD}") not found`);
      return { status: "FAILED", message: "Required 'I confirm I am 18+' checkbox not found on page" };
    }
    await termsCheckbox.locator("xpath=ancestor::label[1]").click();
    await page.waitForTimeout(300);
    const termsChecked = await termsCheckbox.isChecked().catch(() => false);
    if (!termsChecked) {
      await log.warn("Clicking the T&Cs checkbox's label did not check it — page may have changed");
      return { status: "FAILED", message: "Could not tick the required T&Cs checkbox" };
    }
    await log.info("Ticked required 'I confirm I am 18+ and have read the prize draw Terms and Conditions' checkbox — left Theatre Tokens/OLT/Z Hotels marketing checkboxes unticked");

    const submit = form.locator("#olt-webform-submit");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#olt-webform-submit) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // Same AJAX + PRG-style redirect signal as officialLondonTheatreHeathers.ts.
    const [response] = await Promise.all([
      page
        .waitForResponse((r) => r.url() === AJAX_URL && r.request().method() === "POST", { timeout: 20000 })
        .catch(() => null),
      submit.click(),
    ]);

    if (!response) {
      await log.warn("Never observed a POST response to admin-ajax.php for the entry form submission");
      return { status: "FAILED", message: "No response observed for the form submission" };
    }
    if (!response.ok()) {
      await log.warn(`admin-ajax.php POST returned HTTP ${response.status()}`);
      return { status: "FAILED", message: `Form submission returned HTTP ${response.status()}` };
    }

    await page.waitForURL(/\/webforms-thank-you\//, { timeout: 10000 }).catch(() => {});
    if (/\/webforms-thank-you\//.test(page.url())) {
      const pageTitle = await page.title().catch(() => "");
      await log.info(`Redirected to the thank-you page (title: "${pageTitle}") — entry accepted`);
      return { status: "SUCCESS", message: pageTitle || "Redirected to thank-you page" };
    }

    const json = await response.json().catch(() => null);
    if (json && json.success) {
      await log.info("admin-ajax.php returned success:true — entry accepted");
      return { status: "SUCCESS", message: "Entry accepted" };
    }

    const errorMessage = json?.data?.message ? String(json.data.message) : "Response did not indicate success";
    await log.warn(`Form rejected submission: ${errorMessage}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorMessage}` };
  },
};
