import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Ambassador Cruise Line & England Golf — "Win a Balcony Cabin for Two on
 * Ambassador's Cricket Cruise and a Fourball at Woodhall Spa"
 * (ambassadorcruiseline.com/competitions/england-golf-eg2602/). Found via
 * cruisemummy.co.uk (an aggregator/blog, used only as a lead source — this
 * adapter enters on the organiser's own domain, not the aggregator).
 *
 * Genuine free prize draw, no purchase necessary (confirmed via the page's
 * own T&Cs: "By submitting your details you agree to be entered into the
 * free prize draw"). Closes 13 Sept 2026. A HubSpot form embedded in an
 * iframe (portal 146566557, form e303c2c3-52c1-41f3-b807-449972abce79):
 * First Name, Last Name, Email (all required), optional Phone, plus two
 * independently optional marketing opt-in checkboxes — "double your entry"
 * (Ambassador Cruise Line marketing) and a separate England Golf marketing
 * opt-in. Both ticked deliberately: more marketing mail is more competition
 * leads, and the "double your entry" box gives an actual second entry too.
 *
 * No reCAPTCHA anywhere on this form (checked directly, live). Submission
 * posts to forms-eu1.hsforms.com's public submissions API — that response
 * is the most direct success signal (its ok()/JSON shape), rather than
 * guessing at whatever text HubSpot renders in place of the form.
 *
 * The site's own "Use of Cookies" consent dialog (a headlessui React
 * portal, not OneTrust) doesn't render at initial load — confirmed directly
 * (live) it appears partway through and its backdrop then intercepts the
 * final submit click, timing out with "…subtree intercepts pointer events"
 * even though the button itself is visible/enabled. It offers no one-click
 * "reject all", only "Manage Cookies" or "Accept & Close" — dismissed via
 * the latter. Checked both up front and immediately before the submit click
 * (a DOM-removal fallback if it re-renders again), same pattern used for
 * OneTrust backdrops elsewhere in this project.
 */
const HUBSPOT_SUBMIT_URL_FRAGMENT = "forms-eu1.hsforms.com/submissions/v3/public/submit/formsnext/multipart/146566557/e303c2c3-52c1-41f3-b807-449972abce79";

export const ambassadorCruiseLineEnglandGolfAdapter: CompetitionAdapter = {
  key: "ambassador-cruise-line-england-golf",
  siteName: "Ambassador Cruise Line & England Golf",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(2000);

    const dismissCookieDialog = async () => {
      const acceptButton = page.getByRole("button", { name: "Accept & Close", exact: true });
      if (await acceptButton.isVisible({ timeout: 3000 }).catch(() => false)) {
        await acceptButton.click({ timeout: 5000 }).catch(() => {});
        await log.info("Dismissed cookie consent dialog (Accept & Close — no one-click reject option offered)");
      }
    };
    await dismissCookieDialog();

    const hsFrame = page.frames().find((f) => f.url().includes("hsforms.net/ui-forms-embed"));
    if (!hsFrame) {
      await log.warn("Expected embedded HubSpot form iframe not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    const firstNameField = hsFrame.locator('input[name$="/firstname"]');
    const lastNameField = hsFrame.locator('input[name$="/lastname"]');
    const emailField = hsFrame.locator('input[name$="/email"]');
    if ((await firstNameField.count()) === 0 || (await lastNameField.count()) === 0 || (await emailField.count()) === 0) {
      await log.warn("Expected name/email fields not found inside the HubSpot form — page may have changed");
      return { status: "FAILED", message: "Expected form fields not found" };
    }
    await firstNameField.fill(profile.firstName);
    await lastNameField.fill(profile.lastName);
    await emailField.fill(profile.email);
    await log.info("Filled first name, last name, email");

    if (profile.phone) {
      const phoneField = hsFrame.locator('input[type="tel"]');
      if ((await phoneField.count()) > 0) {
        await phoneField.fill(profile.phone);
        await log.info("Filled phone");
      }
    }

    const marketingCheckboxes = hsFrame.locator('input[type="checkbox"]');
    const marketingCount = await marketingCheckboxes.count();
    for (let i = 0; i < marketingCount; i++) {
      const box = marketingCheckboxes.nth(i);
      if (!(await box.isChecked().catch(() => true))) {
        await box.check().catch(() => {});
      }
    }
    await log.info(`Ticked ${marketingCount} optional marketing checkbox(es) (Ambassador Cruise Line 'double your entry' opt-in, England Golf opt-in)`);

    const submit = hsFrame.locator('button[type="submit"], input[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found inside the HubSpot form");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await dismissCookieDialog();

    const clickSubmit = async () => {
      try {
        await submit.first().click({ timeout: 8000 });
      } catch {
        await log.warn("Submit click was blocked by a re-rendered cookie dialog — removing it and retrying");
        await page.evaluate(() => document.getElementById("headlessui-portal-root")?.remove());
        await submit.first().click();
      }
    };

    const [response] = await Promise.all([
      page
        .waitForResponse((r) => r.url().includes(HUBSPOT_SUBMIT_URL_FRAGMENT) && r.request().method() === "POST", { timeout: 20000 })
        .catch(() => null),
      clickSubmit(),
    ]);

    if (!response) {
      await log.warn("Never observed a POST response to HubSpot's public submissions API for this form");
      return { status: "FAILED", message: "No response observed for the form submission" };
    }
    if (!response.ok()) {
      const body = await response.text().catch(() => "");
      await log.warn(`HubSpot submissions API returned HTTP ${response.status()}: ${body.slice(0, 300)}`);
      return { status: "FAILED", message: `Form submission returned HTTP ${response.status()}` };
    }

    const json = await response.json().catch(() => null);
    if (json?.errors?.length) {
      const errorMessage = json.errors.map((e: { message?: string }) => e.message).join("; ");
      await log.warn(`HubSpot rejected submission: ${errorMessage}`);
      return { status: "FAILED", message: `Form rejected submission: ${errorMessage}` };
    }

    await log.info("HubSpot submissions API accepted the entry (HTTP 200, no errors in response)");
    return { status: "SUCCESS", message: "Entry accepted" };
  },
};
