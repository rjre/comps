import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Template adapter — copy this file per real site once we know which
 * giveaway platforms/forms to target. It shows the shape every adapter
 * should follow: navigate, fill the profile's fields into that site's
 * actual field names, submit, and interpret the result page. Log at each
 * step — those log lines are what make a broken adapter fixable without
 * re-running it under a debugger.
 */
export const exampleAdapter: CompetitionAdapter = {
  key: "example",
  siteName: "Example (template — not a real target)",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    // Real adapters replace these selectors with the site's actual form
    // field names/ids, gathered from that specific competition page.
    const emailField = page.locator('input[type="email"]');
    if ((await emailField.count()) === 0) {
      await log.warn("Entry form not found on page");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    await emailField.fill(profile.email);
    await page.locator('input[name="firstName"]').fill(profile.firstName).catch(() => {});
    await page.locator('input[name="lastName"]').fill(profile.lastName).catch(() => {});
    await log.info("Filled form fields");

    // Never auto-check boxes that grant marketing consent or third-party
    // data sharing on the person's behalf — leave those to a human.
    const submit = page.locator('button[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found");
      return { status: "FAILED", message: "Submit button not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();
    await log.info("Submitted entry form");
    return { status: "SUCCESS" };
  },
};
