import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Official London Theatre (run by the Society of London Theatre, SOLT) —
 * "Win two tickets for the UK tour of Heathers The Musical"
 * (officiallondontheatre.com/webforms/win-two-tickets-for-the-uk-tour-of-heathers-the-musical/).
 * Same organisation already tracked for its newsletter
 * (newsletters/adapters/officialLondonTheatre.ts) but this is a genuinely
 * separate form on a separate URL, not a reuse of that signup. No purchase
 * necessary — prize draw runs 01.09.2026 to midnight 08.09.2026 (per the
 * page's own T&Cs), one pair of tickets per tour venue, winner picked at
 * random.
 *
 * The whole form is server-rendered as real static HTML (confirmed via
 * curl — no client JS execution needed to discover it) alongside a JSON
 * "webform-state" schema that documents each field's purpose 1:1 with the
 * rendered inputs, so nothing here is guessed. Fields: a required radio
 * group to choose the tour venue (one pair of tickets per venue — we pick
 * "Chelmsford Chelmsford Theatre", the nearest venue to this profile's
 * Essex base, out of the 20 on offer), First Name, Last Name, Email,
 * optional Postcode, two optional third-party marketing checkboxes
 * (Theatre Tokens emails; Heathers The Musical's own emails) left
 * deliberately unticked, and a required "I confirm I am 18+ and have read
 * the prize draw T&Cs" checkbox (competition-rules acceptance, not
 * marketing, so ticked).
 *
 * Submission is a client-side fetch() POST to
 * /wp/wp-admin/admin-ajax.php (action=solt_webform_save_entry) that the
 * page's own inline script performs after preventDefault on the form's
 * submit event — there is no plain HTML form POST to wait on. On
 * `{success:true}` the script redirects to a "/webforms-thank-you/" page;
 * on any other outcome it writes an error message into #olt-webform-error
 * instead of navigating anywhere. We watch the actual admin-ajax.php
 * response and its parsed JSON `success` flag directly (the same signal
 * the page's own script branches on) rather than racing the DOM error text
 * or the redirect, since that's the most direct read of what really
 * happened.
 *
 * This domain runs a Cloudflare bot-management challenge script
 * (cdn-cgi/challenge-platform) — non-blocking in every observation made
 * while building this adapter (curl fetched the full real page and form
 * cleanly with no interstitial), same as the already-tracked
 * official-london-theatre-newsletter on this same domain, but checked for
 * explicitly below anyway since a challenge page would otherwise look like
 * a generic "form not found" failure. This site is also JS-heavy (its own
 * submit handling is entirely client-side) — waits for the `load` event
 * plus settle time, not just domcontentloaded, before interacting.
 *
 * Note: this session's own sandboxed Playwright could not complete a live
 * render of this domain (net::ERR_CONNECTION_RESET once routed through
 * this environment's mandatory egress proxy — the same sandbox networking
 * artifact already documented against devonsTopAttractions.ts and
 * c2cBlowoutCompany.ts, not a site-side block: curl reached the real page
 * and its full form markup, including the JSON schema quoted above, with
 * no anti-automation response). Worth double-checking the very first live
 * run actually reaches the form.
 */
const VENUE_RADIO_NAME = "76e25972-86b3-457b-9747-b5b801d7f3d5";
const CHOSEN_VENUE_VALUE = "Chelmsford"; // "Chelmsford Chelmsford Theatre" — nearest tour venue to this profile's Essex base
const FIRST_NAME_FIELD = "28c30211-ebb2-4b55-b69d-2799bc88e9d2";
const LAST_NAME_FIELD = "bd426128-7c8d-4c05-b1c4-492b4a7145df";
const EMAIL_FIELD = "e4497b3a-04d5-4592-8c33-a91752324d8f";
const POSTCODE_FIELD = "c653b671-7695-4fc0-93a4-e0c6d0201fa8";
const OVER18_TERMS_FIELD = "06f3e4ca-8071-4f7f-bf16-84fea704f277";
// Left deliberately unticked (marketing, not required to enter):
//   b4fdd5c9-2e6b-42b3-a608-842c5abadc72 — Theatre Tokens emails
//   dd3b7a93-a3f8-4b75-8e01-3f480f18a1cf — Heathers The Musical's own emails
const AJAX_URL = "https://officiallondontheatre.com/wp/wp-admin/admin-ajax.php";

export const officialLondonTheatreHeathersAdapter: CompetitionAdapter = {
  key: "official-london-theatre-heathers",
  siteName: "Official London Theatre (SOLT) — Heathers The Musical",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 });
    // This is a JS-heavy page (client-side AJAX submit, a floating consent
    // widget that (re)inserts itself on a timer) — give it a moment to
    // finish settling after the load event before touching anything.
    await page.waitForTimeout(2000);

    const title = await page.title().catch(() => "");
    if (/just a moment|attention required|checking your browser/i.test(title)) {
      await log.warn(`Landed on what looks like a Cloudflare challenge page (title: "${title}") instead of the entry form`);
      return { status: "FAILED", message: "Blocked by Cloudflare challenge before the form could be reached" };
    }

    // Same floating consent widget as officialLondonTheatre.ts's newsletter
    // adapter on this domain — re-created on a timer and can sit on top of
    // form controls. We're not granting it consent either way, so
    // neutralise it outright rather than chase its buttons.
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

    const venueOption = form.locator(`input[name="${VENUE_RADIO_NAME}"][value="${CHOSEN_VENUE_VALUE}"]`);
    if ((await venueOption.count()) === 0) {
      await log.warn(`Expected venue option "${CHOSEN_VENUE_VALUE}" not found in the venue radio group — page may have changed`);
      return { status: "FAILED", message: "Expected venue option not found on page" };
    }
    await venueOption.check();
    await log.info(`Selected venue: Chelmsford Chelmsford Theatre (nearest tour date to this profile's Essex base)`);

    await form.locator(`input[name="${FIRST_NAME_FIELD}"]`).fill(profile.firstName);
    await form.locator(`input[name="${LAST_NAME_FIELD}"]`).fill(profile.lastName);
    await form.locator(`input[name="${EMAIL_FIELD}"]`).fill(profile.email);
    if (profile.postalCode) {
      await form.locator(`input[name="${POSTCODE_FIELD}"]`).fill(profile.postalCode);
    }
    await log.info(`Filled first name, last name, email${profile.postalCode ? ", postcode" : ""}`);

    const termsCheckbox = form.locator(`input[name="${OVER18_TERMS_FIELD}"]`);
    if ((await termsCheckbox.count()) === 0) {
      await log.warn(`Expected required 18+/terms checkbox (name="${OVER18_TERMS_FIELD}") not found`);
      return { status: "FAILED", message: "Required 'I confirm I am 18+' checkbox not found on page" };
    }
    await termsCheckbox.check();
    await log.info("Ticked required 'I confirm I am 18+ and have read the prize draw Terms and Conditions' checkbox — left both third-party marketing checkboxes (Theatre Tokens, Heathers The Musical) unticked");

    const submit = form.locator("#olt-webform-submit");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#olt-webform-submit) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // The page's own script preventDefaults the submit and does a fetch()
    // POST to admin-ajax.php, branching on the parsed JSON's `success`
    // flag — read that same response directly rather than guessing at a
    // DOM confirmation.
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

    const json = await response.json().catch(() => null);
    if (json && json.success) {
      await log.info("admin-ajax.php returned success:true — entry accepted");
      return { status: "SUCCESS", message: "Entry accepted (Chelmsford Chelmsford Theatre)" };
    }

    const errorMessage = json?.data?.message ? String(json.data.message) : "Response did not indicate success";
    await log.warn(`Form rejected submission: ${errorMessage}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorMessage}` };
  },
};
