import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Park Holidays UK — "Win a holiday home worth over £60,000"
 * (parkholidays.com/caravan-holiday-homes-for-sale/win-a-holiday-home).
 * Park Holidays UK Limited is a genuine, large UK holiday-park operator
 * (FCA registered, real T&Cs on the page itself). No purchase necessary,
 * closes 31 Dec 2026. A two-step modal (click "Enter now" to open it):
 * step 1 is just an email field (the informational "I have read and
 * agree..." text underneath it is NOT a checkbox — confirmed directly,
 * there's no input associated with it at all; the "Start competition
 * entry" button enables purely from a valid email); step 2 asks for
 * county/title/name/phone/a required "Looking to buy a holiday home?"
 * radio (answered "No, I'd just like to enter the competition" — the
 * honest, no-purchase-intent option) and two independently optional
 * marketing-channel checkboxes (Email, Telephone & Text) left unticked,
 * same "never tick marketing on a competition form" rule as everywhere
 * else in this project.
 *
 * The radio/checkbox inputs in this modal have no name/id/value
 * attributes at all (a React component library rendering bare native
 * inputs) — matched by their own wrapping label's text instead, same
 * "click the label, not the bare input" pattern already used elsewhere
 * in this project for custom-styled controls.
 *
 * Cookie banner: OneTrust, with the same backdrop-lingers-after-dismiss
 * behaviour hit on several other sites — the "Enter now" click that
 * opens the modal is wrapped in the same dismiss-then-DOM-removal
 * fallback already proven elsewhere in this project.
 */
export const parkHolidaysWinAHolidayHomeAdapter: CompetitionAdapter = {
  key: "park-holidays-win-a-holiday-home",
  siteName: "Park Holidays UK",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 });

    const cookieReject = page.getByRole("button", { name: "Reject All Cookies", exact: true });
    if (await cookieReject.isVisible({ timeout: 8000 }).catch(() => false)) {
      await cookieReject.click();
      await page.locator("#onetrust-consent-sdk").waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
      await log.info("Dismissed cookie banner (rejected non-essential cookies)");
    }
    await page.waitForTimeout(1000);

    const enterNow = page.getByRole("button", { name: "Enter now", exact: true }).first();
    if ((await enterNow.count()) === 0) {
      await log.warn("'Enter now' button not found — page may have changed");
      return { status: "FAILED", message: "Entry button not found on page" };
    }
    try {
      await enterNow.click({ timeout: 8000 });
    } catch {
      await log.warn("'Enter now' click was blocked by a re-rendered cookie backdrop — removing it and retrying");
      await page.evaluate(() => document.querySelector("#onetrust-consent-sdk")?.remove());
      await enterNow.click();
    }
    await page.waitForTimeout(1500);

    const emailField = page.locator('input[name="email"]').first();
    if ((await emailField.count()) === 0) {
      await log.warn("Step 1 email field not found — page may have changed");
      return { status: "FAILED", message: "Entry form did not open" };
    }
    await emailField.fill(profile.email);
    await log.info("Filled email (step 1 of 2)");

    const startEntry = page.getByRole("button", { name: "Start competition entry", exact: true });
    if ((await startEntry.count()) === 0 || (await startEntry.isDisabled())) {
      await log.warn("'Start competition entry' button not found or still disabled after filling email");
      return { status: "FAILED", message: "Could not advance past step 1" };
    }
    await startEntry.click();

    const firstNameField = page.locator('input[name="firstName"]');
    try {
      await firstNameField.waitFor({ state: "visible", timeout: 10000 });
    } catch {
      await log.warn("Step 2 fields never appeared within 10s after step 1 submit");
      return { status: "FAILED", message: "Step 2 of the form did not load" };
    }

    const countySelect = page.locator('select[name="county"]');
    if (profile.region) {
      const options = await countySelect.locator("option").allTextContents();
      const match = options.find((o) => o.trim().toLowerCase() === profile.region!.toLowerCase());
      if (match) {
        await countySelect.selectOption({ label: match });
      } else {
        await log.warn(`Profile region "${profile.region}" isn't one of this form's county options — leaving unselected`);
      }
    }
    if (profile.title) {
      const titleSelect = page.locator('select[name="title"]');
      const normalized = profile.title.replace(/\.$/, "").toLowerCase();
      const options = await titleSelect.locator("option").allTextContents();
      const match = options.find((o) => o.replace(/\.$/, "").toLowerCase() === normalized);
      if (match) {
        await titleSelect.selectOption({ label: match });
      }
    }
    await firstNameField.fill(profile.firstName);
    await page.locator('input[name="lastName"]').fill(profile.lastName);
    if (profile.phone) {
      await page.locator('input[name="phone"]').fill(profile.phone);
    }
    await log.info("Filled county, title, first name, last name, phone (step 2 of 2)");

    const noThanksRadio = page.getByText("No, I'd just like to enter the competition", { exact: true });
    if ((await noThanksRadio.count()) === 0) {
      await log.warn("Expected 'No, I'd just like to enter the competition' radio option not found — page may have changed");
      return { status: "FAILED", message: "Required radio option not found" };
    }
    await noThanksRadio.click();
    await log.info("Selected 'No, I'd just like to enter the competition' — left both optional marketing checkboxes (Email, Telephone & Text) unticked");

    const submit = page.getByRole("button", { name: "Enter Now", exact: true });
    if ((await submit.count()) === 0) {
      await log.warn("Final submit button ('Enter Now') not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    // Confirmed directly (live): this page runs an invisible Cloudflare
    // Turnstile check gating the final submit button (no visible widget
    // element anywhere in the DOM, but the console repeatedly logs
    // "[Turnstile Error] 600010" and the button never leaves its
    // disabled state as a result) — a managed/invisible challenge, same
    // "don't solve or evade" category as a visible one, just with
    // nothing to point a selector at. Detected here via the console
    // error instead, since there's no DOM element to check for.
    let turnstileErrorSeen = false;
    page.on("console", (msg) => {
      if (/turnstile error/i.test(msg.text())) turnstileErrorSeen = true;
    });

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    try {
      await submit.click({ timeout: 15000 });
    } catch {
      if (turnstileErrorSeen) {
        await log.warn("Submit button never became enabled — an invisible Cloudflare Turnstile check errored (console: '[Turnstile Error] 600010') and is blocking it. Not solved or evaded.");
        return { status: "FAILED", message: "Blocked by an invisible Cloudflare Turnstile check — not solved or evaded" };
      }
      await log.warn("Submit button never became enabled within 15s, for an unclear reason");
      return { status: "FAILED", message: "Submit control never became enabled" };
    }

    const confirmation = page.getByText(/thank you|you'?re entered|good luck|entry received|successfully entered|entered the competition/i);
    const error = page.getByText(/already entered|invalid|error|something went wrong|please enter/i);
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
    await log.warn(`Form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
