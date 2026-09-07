import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Wightlink Ferries — "Win a Parkdean Resorts holiday worth £750" (a
 * Wightlink Ltd prize draw promoting its Isle of Wight ferry routes,
 * co-branded with Parkdean Resorts as the holiday-voucher prize provider).
 * The listing page (wightlink.co.uk/ways-to-save/competitions/parkdean-resorts)
 * embeds the real entry form as a ClickDimensions (Dynamics 365 Marketing)
 * form hosted on a Wightlink subdomain (form.wightlink.co.uk) — this
 * adapter navigates straight to that form URL rather than the embedding
 * page, sidestepping the iframe entirely. Minimal form: first name, last
 * name, email, postcode — no marketing checkbox to leave unticked.
 * Confirmed directly from the form's own client-side script
 * (cdform.min.noanalytics.js): its submit handler does a real
 * `form.submit()` (classic full-page POST), not an AJAX/fetch call, so
 * outcome is read from whatever page the browser lands on afterward
 * (PRG-style), not a same-page DOM swap. That script also only blocks
 * submission on a `grecaptcha` challenge if one has been added to the
 * page — none was present in the served form, but checked defensively
 * each run in case that changes.
 */
export const wightlinkParkdeanResortsAdapter: CompetitionAdapter = {
  key: "wightlink-parkdean-resorts",
  siteName: "Wightlink Ferries",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "load" });

    const form = page.locator("#clickdimensionsForm");
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (#clickdimensionsForm) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    if (!profile.postalCode) {
      await log.warn("Profile is missing postalCode, required by this form");
      return { status: "FAILED", message: "Profile missing postalCode required by this form" };
    }

    // Field ids are ClickDimensions-generated GUIDs baked into this specific
    // form, not stable across forms — matched by their leadField attribute
    // instead, which names the underlying CRM field regardless of id.
    await page.locator('input[leadField="firstname"]').fill(profile.firstName);
    await page.locator('input[leadField="lastname"]').fill(profile.lastName);
    await page.locator('input[leadField="emailaddress1"]').fill(profile.email);
    await page.locator('input[leadField="address1_postalcode"]').fill(profile.postalCode);
    await log.info("Filled first name, last name, email, postcode");

    // Not present on the form as served, but the form's own submit script
    // only enforces this when a widget has actually been added to the
    // page, so check live rather than assume it's still absent.
    const recaptcha = page.locator("iframe[src*='recaptcha'], .g-recaptcha");
    if (await recaptcha.first().isVisible({ timeout: 3000 }).catch(() => false)) {
      await log.warn("This form now shows a reCAPTCHA challenge — not attempting to solve it");
      return { status: "FAILED", message: "Blocked by a reCAPTCHA challenge — not solved or evaded" };
    }

    const submit = page.locator("#btnSubmit");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#btnSubmit) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    const formUrl = page.url();
    await submit.click();

    // A real full-page POST/redirect, so wait for the browser to actually
    // land somewhere new before reading the result, same PRG handling as
    // theSuffolkCoast.ts's newsletter form.
    await page.waitForURL((url) => url.toString() !== formUrl, { timeout: 20000 }).catch(() => {});
    await page.waitForLoadState("load").catch(() => {});

    const success = page.getByText(/thank you|entered|submitted|success|good luck/i);
    const error = page.getByText(/required|invalid|error|something went wrong|please enter/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      if (page.url() !== formUrl) {
        await log.info(`Form navigated away to ${page.url()} with no matching confirmation/error text — treating the navigation itself as evidence of a real submission`);
        return { status: "SUCCESS", message: `Navigated to ${page.url()} after submit, no explicit confirmation text found` };
      }
      await log.warn("No confirmation or error appeared, and the page never navigated away from the form");
      return { status: "FAILED", message: "No confirmation, error, or navigation observed after submit — outcome unclear" };
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
