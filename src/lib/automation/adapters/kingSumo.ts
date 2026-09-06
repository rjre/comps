import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * KingSumo — a third-party giveaway-widget platform, the same "one adapter
 * covers many unrelated brands" shape as gleam.ts: every giveaway resolves
 * to kingsumo.com/g/<id>/<slug>, sharing one plain (non-SPA) HTML form
 * posted straight to `/giveaways/<id>/enter`.
 *
 * Confirmed directly across several live pages: the form is always
 * `#giveaway-signup-form`, always asks for email, and sometimes also asks
 * for a name — both shapes are a genuine sweepstakes entry (the page's own
 * copy: "Enter sweepstakes and receive exclusive offers from
 * <organiser>"), not a newsletter signup, even when email is the only
 * field. That's why this doesn't reuse the generic adapter: its
 * email-only-looks-like-a-newsletter heuristic would (and, per this
 * project's failure logs, does) wrongly decline a real KingSumo entry that
 * only asks for an email.
 *
 * Confirmed directly: a real submission is a genuine navigation (not an
 * AJAX call) — both of this project's two prior successful KingSumo
 * entries were logged as "accepted (navigation)" — so navigation away from
 * the entry page is treated as success here, the same evidence generic.ts
 * already uses.
 *
 * A giveaway whose own page says "Giveaway Ended" gets a clean, immediate
 * decline instead of an opaque form-shaped failure — confirmed directly on
 * two already-closed giveaways discovered by this project, both showing
 * that exact text with the form still present (so nothing else here would
 * have caught it).
 *
 * If a giveaway's entry form asks for more than name/email (a password,
 * say — not confirmed to happen, but KingSumo does support account-gated
 * giveaways in general), this declines rather than guessing at an
 * unfamiliar flow, the same policy generic.ts applies to a login wall.
 */
export const kingSumoAdapter: CompetitionAdapter = {
  key: "kingsumo",
  siteName: "KingSumo (giveaway widget platform)",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    const response = await page.goto(competitionUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (response && !response.ok()) {
      return { status: "FAILED", message: `Blocked — HTTP ${response.status()} ${response.statusText()}` };
    }

    const ended = await page.getByText("Giveaway Ended", { exact: true }).first().isVisible().catch(() => false);
    if (ended) {
      await log.info("This giveaway has already ended");
      return { status: "SKIPPED_RULES", message: "Giveaway already ended" };
    }

    const form = page.locator("#giveaway-signup-form");
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (#giveaway-signup-form) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    if ((await form.locator('input[type="password"]').count()) > 0) {
      await log.info("This giveaway requires creating an account (password field present) — declining");
      return { status: "SKIPPED_RULES", message: "Entry requires an account/login" };
    }

    const emailField = form.locator('input[type="email"]').first();
    if ((await emailField.count()) === 0) {
      return { status: "FAILED", message: "Could not confidently match any form fields" };
    }
    await emailField.fill(profile.email);
    let filledCount = 1;

    const nameField = form.locator('input[name="name"]').first();
    if ((await nameField.count()) > 0) {
      await nameField.fill(`${profile.firstName} ${profile.lastName}`.trim());
      filledCount += 1;
    }
    await log.info(`Filled ${filledCount} field(s)`);

    const submit = form.locator('button[type="submit"], input[type="submit"]').first();
    if ((await submit.count()) === 0) {
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info(`Dry run — filled ${filledCount} field(s), not submitting`);
      return { status: "SUCCESS", message: `Dry run: would have submitted ${filledCount} filled field(s)` };
    }

    const urlBefore = page.url();
    await submit.click();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    if (page.url() === urlBefore) {
      await log.warn("Submitted, but the page never navigated away from the entry form");
      return {
        status: "FAILED",
        message: `Filled ${filledCount} field(s) and submitted, but saw no confirmation, navigation or form change — entry not confirmed`,
      };
    }

    return { status: "SUCCESS", message: `Filled ${filledCount} field(s); accepted (navigation)` };
  },
};
