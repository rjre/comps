import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * H Bauer Publishing's shared reader-competitions widget — confirmed
 * directly on fateandfortunemagazine.co.uk's monthly competitions page
 * (form posts to competitionform.bauersecure.com/formhandler.php,
 * hidden brand_code=FAF/issue_number=FAF2609): every issue bundles several
 * unrelated competitions (a puzzle page, a sudoku, a star chart, a named
 * prize) onto ONE form, one text-input answer field per competition
 * (id/name is a numeric CMS content ID, e.g. 114028), and you only fill in
 * the one(s) you're actually entering — the rest stay blank. Same
 * publisher runs this identical widget across its other UK magazine
 * titles (Spirit & Destiny confirmed sharing spiritanddestiny.co.uk's own
 * instance of the same platform), so this is written generically keyed by
 * competition URL rather than one brand's page — adding another Bauer
 * title's competition later is a new BAUER_ENTRIES record, not a new file.
 *
 * Only competitions whose answer is given directly in the page's own copy
 * (never a puzzle/sudoku/wordplay answer that needs the print magazine
 * itself to solve) are ever registered here — e.g. "Page 49 The Angel
 * Almanac by Angela McGerr - Please answer ANGEL to enter" states its own
 * answer verbatim. The sibling Prize Sudoku/Skeleton Puzzle/Star Chart
 * fields on the same page are deliberately never filled — this project
 * never guesses a quiz answer, and those need the physical magazine.
 *
 * Three marketing opt-ins (brand_opt_in / group_opt_in / partner_opt_in —
 * "Fate & Fortune", "Bauer" and "Partner" competitions/offers alerts
 * respectively) are all left unticked; only the required
 * terms_and_conditions checkbox (accepting the competition's own rules,
 * not marketing) is ticked.
 *
 * Cookie consent is Bauer's own CMP, hosted on a per-title subdomain
 * (cmp.fateandfortunemagazine.co.uk) that 403s to a direct fetch, so its
 * exact button wording couldn't be confirmed from static HTML alone —
 * this tries a handful of common "reject non-essential" labels inside any
 * iframe hosted on that subdomain, falling back to accepting only if no
 * reject-style control is offered at all, same "no one-click reject-all"
 * fallback already proven necessary on Future PLC's Sourcepoint CMP
 * (futurePlcNewsletter.ts). Never blocks the rest of the flow if the
 * banner doesn't render at all.
 *
 * Unlike suffolkCoast.ts/theSuffolkCoast.ts (which default an errorless
 * HTTP 200 to SUCCESS), that shortcut isn't taken here: those adapters
 * earned it by confirming live that their form genuinely shows no
 * confirmation text at all, ever. Nobody has watched a real submission
 * through this Bauer form (this project never live-submits fabricated
 * profile data to find out), so the safer default on an errorless
 * response is still FAILED with the response logged for diagnosis —
 * never a guessed SUCCESS. Update the matching below with whatever the
 * first real run's logged response actually contains.
 */
const BAUER_ENTRIES: Record<string, { fieldId: string; answer: string }> = {
  "https://www.fateandfortunemagazine.co.uk/competitions/latest-competitions/fate-fortune-october/": {
    fieldId: "114028",
    answer: "ANGEL", // page's own copy: "Please answer ANGEL to enter"
  },
};

export const bauerCompetitionFormAdapter: CompetitionAdapter = {
  key: "bauer-competition-form",
  siteName: "Bauer Media reader competitions",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    const entry = BAUER_ENTRIES[competitionUrl];
    if (!entry) {
      await log.warn(`No researched answer recorded for ${competitionUrl} — add one to BAUER_ENTRIES before this can run`);
      return { status: "FAILED", message: "No answer field mapping recorded for this competition URL" };
    }

    if (!profile.addressLine1 || !profile.city || !profile.postalCode) {
      await log.warn("Profile is missing address fields required by this form");
      return { status: "FAILED", message: "Profile missing address fields required by this form" };
    }

    await log.info(`Navigating to ${competitionUrl}`);
    // This page loads a heavy analytics/experimentation bundle (VWO) —
    // wait for the full load event, not just DOMContentLoaded, before
    // touching the form.
    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1500);

    const dismissConsent = async (timeout: number) => {
      const cmpFrame = page.frames().find((f) => f.url().includes("cmp.fateandfortunemagazine.co.uk") || f.url().includes("cmp.spiritanddestiny.co.uk"));
      const target = cmpFrame ?? page;
      const rejectButton = target
        .getByRole("button", { name: /reject all|do not accept|i do not accept|necessary only|disagree/i })
        .first();
      if (await rejectButton.isVisible({ timeout }).catch(() => false)) {
        await rejectButton.click();
        await log.info("Dismissed cookie/consent banner (rejected non-essential cookies)");
        return;
      }
      // No dedicated one-click reject offered — same fallback already
      // proven necessary on this publisher's other CMP (futurePlcNewsletter.ts).
      const agreeButton = target.getByRole("button", { name: /^(accept all|agree|i accept)$/i }).first();
      if (await agreeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await agreeButton.click();
        await log.warn("Consent banner offered no reject-all option — accepted (no other way to proceed)");
      }
    };
    await dismissConsent(10000);

    const form = page.locator('form[name="competition-form"]');
    if ((await form.count()) === 0) {
      await log.warn('Expected entry form (form[name="competition-form"]) not found — page may have changed');
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    const answerField = form.locator(`#${entry.fieldId}`);
    if ((await answerField.count()) === 0) {
      await log.warn(`Expected answer field (#${entry.fieldId}) not found — page may have changed or renumbered its competitions`);
      return { status: "FAILED", message: "Recorded answer field not found on page" };
    }

    await form.locator("#first_name").fill(profile.firstName);
    await form.locator("#last_name").fill(profile.lastName);
    await form.locator("#email").fill(profile.email);
    if (profile.phone) {
      await form.locator("#phone").fill(profile.phone);
    }
    await form.locator("#address_1").fill(profile.addressLine1);
    if (profile.addressLine2) {
      await form.locator("#address_2").fill(profile.addressLine2);
    }
    await form.locator("#city").fill(profile.city);
    if (profile.region) {
      await form.locator("#state").fill(profile.region);
    }
    await form.locator("#postcode").fill(profile.postalCode);
    await answerField.fill(entry.answer);
    await log.info(`Filled name, email, address, and this competition's answer ("${entry.answer}") — every other competition's answer field on this page left blank`);
    // brand_opt_in / group_opt_in / partner_opt_in deliberately never ticked.

    await dismissConsent(3000);

    const termsCheckbox = form.locator("#terms_and_conditions");
    if ((await termsCheckbox.count()) === 0) {
      await log.warn("Required T&Cs checkbox (#terms_and_conditions) not found");
      return { status: "FAILED", message: "T&Cs checkbox not found" };
    }
    await form.locator('label[for="terms_and_conditions"]').first().click();
    if (!(await termsCheckbox.isChecked().catch(() => false))) {
      await log.warn("Clicking the T&Cs label did not check the underlying checkbox");
      return { status: "FAILED", message: "Could not tick the required T&Cs checkbox" };
    }

    const submit = form.getByRole("button", { name: "Enter", exact: true }).or(form.locator('input[type="submit"][value="Enter"]'));
    if ((await submit.count()) === 0) {
      await log.warn("Submit control ('Enter') not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    const [response] = await Promise.all([
      page
        .waitForResponse((r) => r.request().method() === "POST" && r.url().includes("bauersecure.com/formhandler.php"), { timeout: 20000 })
        .catch(() => null),
      submit.first().click(),
    ]);

    if (!response) {
      await log.warn("Never observed a POST to competitionform.bauersecure.com/formhandler.php after submit");
      return { status: "FAILED", message: "No response observed for the form submission" };
    }

    let html: string;
    if (response.status() >= 300 && response.status() < 400) {
      await log.info(`Form POST redirected (HTTP ${response.status()}) — following to the landing page`);
      await page.waitForLoadState("load").catch(() => {});
      html = await page.content().catch(() => "");
    } else if (!response.ok()) {
      await log.warn(`Form POST returned HTTP ${response.status()}`);
      return { status: "FAILED", message: `Form submission returned HTTP ${response.status()}` };
    } else {
      html = await response.text();
    }

    if (/error|invalid|sorry|something went wrong|problem/i.test(html)) {
      await log.warn("Response after submit contains error-like text — treating as a rejected submission");
      return { status: "FAILED", message: "Form response contained error-like text after submit" };
    }

    const success = /thank you|you're entered|you are entered|entry received|successfully entered|good luck/i.test(html);
    if (success) {
      await log.info("Response after submit contains recognisable confirmation text — treating as accepted");
      return { status: "SUCCESS", message: "Confirmation text present in response after submit" };
    }

    // No known confirmation or error copy either way — genuinely ambiguous.
    // Log a snippet so a real run's outcome can be diagnosed and this
    // matcher updated, rather than guessing SUCCESS on silence.
    const snippet = html.replace(/\s+/g, " ").slice(0, 500);
    await log.warn(`No recognised confirmation or error text after submit — outcome unclear. Response snippet: ${snippet}`);
    return { status: "FAILED", message: "No recognised confirmation text after submit — outcome unclear, needs adapter update" };
  },
};
