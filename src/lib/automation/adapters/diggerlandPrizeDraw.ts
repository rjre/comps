import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Diggerland UK (diggerland.com/prize-draw/) — a genuine recurring monthly
 * prize draw ("Each month, Diggerland UK Theme Park give you the
 * opportunity to win a fantastic prize"), run directly by the theme park
 * group (Diggerland Kent/Devon/Durham/Yorkshire + the H E Group's other
 * brands). No purchase necessary. Entry is a Google Form embedded via
 * iframe on the page — confirmed directly from the served HTML/embedded
 * form JSON, not guessed. Modelled the same way as tui-monthly-giveaway:
 * one Competition row per month reusing this adapter, since the prize and
 * the underlying Google Form both change monthly (a fresh form id each
 * time, read live from the page's current iframe rather than hardcoded).
 *
 * Only two real fields (Name, Email Address), plus two REQUIRED Yes/No
 * radio questions ("Would you like to receive prize draw information,
 * special offers & news from Diggerland/myFirst via email?") — answering
 * "No" to both is what this project's no-auto-consent rule wants here:
 * declining marketing, not opting into it, and the form can't be
 * submitted at all without an answer either way (confirmed from the
 * form's own embedded validation rules).
 */
export const diggerlandPrizeDrawAdapter: CompetitionAdapter = {
  key: "diggerland-prize-draw",
  siteName: "Diggerland UK",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 });

    // Complianz (WordPress GDPR plugin) cookie banner.
    const dismissCookieBanner = async (timeout: number) => {
      const deny = page.locator("button.cmplz-deny");
      if (await deny.first().isVisible({ timeout }).catch(() => false)) {
        await deny.first().click();
        await log.info("Dismissed cookie banner (denied non-essential cookies)");
      }
    };
    await dismissCookieBanner(10000);

    const formFrameLocator = page.locator('iframe[src*="docs.google.com/forms"]');
    if ((await formFrameLocator.count()) === 0) {
      await log.warn("No embedded Google Form iframe found on the prize draw page — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }
    const frameSrc = await formFrameLocator.first().getAttribute("src");
    await log.info(`Found embedded Google Form: ${frameSrc}`);
    const form = page.frameLocator('iframe[src*="docs.google.com/forms"]').first();

    const fullName = `${profile.firstName} ${profile.lastName}`.trim();
    await form.getByRole("textbox", { name: "Name" }).fill(fullName);
    await form.getByRole("textbox", { name: "Email Address" }).fill(profile.email);
    await log.info(`Filled name (${fullName}) and email`);

    // Two independently-required marketing questions, each its own
    // Yes/No radio group scoped by the question text it belongs to (both
    // groups share identical "Yes"/"No" option labels, so can't match on
    // the option label alone) — "No" on both, declining marketing, not
    // opting in.
    const diggerlandQuestion = form.locator('[role="listitem"]', { hasText: "Diggerland via email" });
    const diggerlandNo = diggerlandQuestion.getByRole("radio", { name: "No", exact: true });
    if ((await diggerlandNo.count()) === 0) {
      await log.warn("Diggerland marketing-consent question (No option) not found — form may have changed");
      return { status: "FAILED", message: "Required marketing-consent question not found on page" };
    }
    await diggerlandNo.click();

    const myFirstQuestion = form.locator('[role="listitem"]', { hasText: "myFirst via email" });
    const myFirstNo = myFirstQuestion.getByRole("radio", { name: "No", exact: true });
    if ((await myFirstNo.count()) === 0) {
      await log.warn("myFirst marketing-consent question (No option) not found — form may have changed");
      return { status: "FAILED", message: "Required marketing-consent question not found on page" };
    }
    await myFirstNo.click();
    await log.info("Declined both required marketing-consent questions (answered 'No')");

    await dismissCookieBanner(3000);

    const submit = form.getByRole("button", { name: "Submit" });
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found in Google Form");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // This form's own embedded confirmation copy ("Thank you for
    // entering. Good luck!"), read directly from its config, not guessed.
    // Google Forms shows this on the same iframe after a client-side
    // navigation to the formResponse page, so keep watching inside the
    // frame rather than the top-level page.
    const success = form.getByText(/thank you for entering/i);
    const error = form.getByText(/something went wrong|please enter a valid|this is a required question/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 20000 }),
        error.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error appeared within 20s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Entry submitted: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
