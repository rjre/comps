import type { CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Template adapter — copy this file per real site once we know which
 * giveaway platforms/forms to target. It shows the shape every adapter
 * should follow: navigate, fill the profile's fields into that site's
 * actual field names, submit, and interpret the result page.
 */
export const exampleAdapter: CompetitionAdapter = {
  key: "example",
  siteName: "Example (template — not a real target)",
  async enterCompetition(page, competitionUrl, profile): Promise<EntryOutcome> {
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    // Real adapters replace these selectors with the site's actual form
    // field names/ids, gathered from that specific competition page.
    const emailField = page.locator('input[type="email"]');
    if ((await emailField.count()) === 0) {
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    await emailField.fill(profile.email);
    await page.locator('input[name="firstName"]').fill(profile.firstName).catch(() => {});
    await page.locator('input[name="lastName"]').fill(profile.lastName).catch(() => {});

    // Never auto-check boxes that grant marketing consent or third-party
    // data sharing on the person's behalf — leave those to a human.
    const submit = page.locator('button[type="submit"]');
    if ((await submit.count()) === 0) {
      return { status: "FAILED", message: "Submit button not found" };
    }

    await submit.click();
    return { status: "SUCCESS" };
  },
};
