import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * TUI's "Monthly Giveaway" — win £500 off a TUI holiday, run directly by
 * TUI UK Limited on tui.co.uk. A WPForms form (id 93) that doubles as
 * their newsletter signup: entering itself opts you into TUI Group email
 * marketing (stated plainly on the page, no separate optional checkbox to
 * decline it) — which is fine here since that's TUI's own first-party
 * marketing, and the whole point of this project's newsletter side is to
 * be signed up for exactly this kind of thing anyway.
 *
 * This draw recurs every calendar month with a new countdown, so — same
 * as this project's existing one-Competition-row-per-instance pattern —
 * each month gets tracked as its own Competition row ("TUI Monthly
 * Giveaway — <Month> <Year>", closesAt = end of that month) reusing this
 * one adapter, rather than trying to make a single row re-enterable
 * forever. Whoever registers next month's row just needs a fresh one.
 *
 * The form itself lazy-loads its real fields several seconds after the
 * page settles (confirmed directly — 0 form elements present even 8s
 * after load, 13 present at 15-20s) — everything is waited for
 * generously rather than assumed present immediately.
 */
export const tuiMonthlyGiveawayAdapter: CompetitionAdapter = {
  key: "tui-monthly-giveaway",
  siteName: "TUI",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    // This page never reaches "domcontentloaded" within a normal timeout
    // (confirmed directly — 30s wasn't enough), likely heavy analytics/tag
    // manager scripts; "commit" (navigation started) plus waiting for the
    // lazy-loaded form below is what actually works here.
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "commit", timeout: 20000 });

    const emailField = page.locator("#wpforms-93-field_2");
    try {
      await emailField.waitFor({ state: "attached", timeout: 25000 });
    } catch {
      await log.warn("Entry form (WPForms id 93) never appeared within 25s — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    // Confirmed directly: submitting before the page's "load" event finishes
    // gets rejected server-side with "Attempt to submit corrupted post
    // data." even though every field/checkbox was filled correctly — some
    // script that finishes around full load (page has ~14 cookies set by
    // then, incl. a bot-mitigation "bm_s"/"bm_so" pair and "_wpfuuid") is
    // apparently required for a valid submission. Waiting here (this does
    // NOT block navigation above, which already committed) fixed it.
    await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {
      log.warn("Page 'load' event didn't fire within 30s — continuing anyway");
    });

    await page.locator("#wpforms-93-field_3").fill(profile.firstName);
    await page.locator("#wpforms-93-field_6").fill(profile.lastName);
    await emailField.fill(profile.email);
    await log.info("Filled first name, surname, email");

    // A "We value your privacy" cookie modal (Tealium-based) renders late
    // — confirmed directly, it wasn't present during earlier checks but
    // appeared mid-interaction and intercepted a checkbox click. Declining
    // rather than accepting, consistent with the rest of this project.
    const cookieDecline = page.getByRole("button", { name: "Decline", exact: true });
    if (await cookieDecline.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cookieDecline.click();
      await log.info("Dismissed cookie banner (declined non-essential cookies)");
    }

    const titleSelect = page.locator("#wpforms-93-field_5");
    if (profile.title) {
      const normalizedTitle = profile.title.replace(/\.$/, "").toLowerCase();
      const options = await titleSelect.locator("option").allTextContents();
      const match = options.find((o) => o.replace(/\.$/, "").toLowerCase() === normalizedTitle);
      if (match) {
        await titleSelect.selectOption({ label: match });
        await log.info(`Selected title: ${match}`);
      } else {
        await log.warn(`Profile title "${profile.title}" isn't one of this form's options (${options.join(", ")}) — leaving the default`);
      }
    } else {
      await log.info("Profile has no title set — leaving the form's default Title selection as-is");
    }

    if (await cookieDecline.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cookieDecline.click();
      await log.info("Dismissed cookie banner (declined non-essential cookies)");
    }

    // Both required to enter at all — accepting the competition's own
    // rules, not an optional marketing checkbox (there isn't one here;
    // the marketing consent is inherent to entering, stated on the page).
    await page.locator("#wpforms-93-field_8_1").check();
    await page.locator("#wpforms-93-field_8_2").check();
    await log.info("Ticked both required agreement checkboxes (T&Cs and Monthly Giveaway T&Cs)");

    const submit = page.locator("#wpforms-submit-93");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#wpforms-submit-93) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // Confirmed directly: the AJAX submit can take well over 15s to resolve,
    // and the confirmation panel isn't ".wpforms-confirmation-container-full"
    // on this site (that guessed selector never matched) — matched on the
    // actual wording instead, same approach used elsewhere in this project
    // when a confirmation is only injected into the DOM post-submit.
    const confirmation = page.getByText(/successfully entered the newsletter monthly giveaway/i);
    const fieldError = page.locator(".wpforms-error").first();
    try {
      await Promise.race([
        confirmation.first().waitFor({ state: "visible", timeout: 30000 }),
        fieldError.waitFor({ state: "visible", timeout: 30000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation message nor a validation error appeared within 30s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await confirmation.first().isVisible().catch(() => false)) {
      const text = (await confirmation.first().innerText()).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text };
    }

    const errorText = (await fieldError.innerText()).trim();
    await log.warn(`Form validation error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
