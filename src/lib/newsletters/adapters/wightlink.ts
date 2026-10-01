import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Wightlink Ferries' own newsletter ("Discounts, inspiration and news from
 * Wightlink", wightlink.co.uk/newsletter, redirects to a ClickDimensions
 * form on form.wightlink.co.uk) — same platform as, but a distinct form
 * from, the wightlink-parkdean-resorts competition entry. Confirmed
 * directly from the page's own embedded form config (a JSON blob read
 * straight from the served HTML, same approach as futurePlcNewsletter.ts):
 * a single page asking for First name, Last name, Email, Post code, all
 * required, no marketing-channel checkbox to leave unticked. The form
 * itself is rendered client-side into an empty #root div by
 * ClickDimensions' newer form-editor script, so there are no static
 * input ids to select on — fields are matched by their real on-page
 * label text instead (same wording the JSON config declares). The config
 * also declares navigateToUrl to a "preferencecentre" page on successful
 * completion, so a navigation there is this form's real success signal,
 * not a guessed one.
 */
export const wightlinkNewsletterAdapter: NewsletterAdapter = {
  key: "wightlink-newsletter",
  siteName: "Wightlink Ferries",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load" });

    if (!profile.postalCode) {
      await log.warn("Profile is missing postalCode, required by this form");
      return { status: "FAILED", message: "Profile missing postalCode required by this form" };
    }

    const firstNameField = page.getByLabel("First name");
    try {
      await firstNameField.waitFor({ state: "visible", timeout: 15000 });
    } catch {
      await log.warn("Form never rendered into #root within 15s — expected label 'First name' not found");
      return { status: "FAILED", message: "Newsletter form did not render on page" };
    }

    await firstNameField.fill(profile.firstName);
    await page.getByLabel("Last name").fill(profile.lastName);
    await page.getByLabel("Email address").fill(profile.email);
    await page.getByLabel("Post code").fill(profile.postalCode);
    await log.info("Filled first name, last name, email, postcode");

    const submit = page.getByRole("button", { name: /next/i });
    if ((await submit.count()) === 0) {
      await log.warn("Submit button ('Next') not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    const formUrl = page.url();
    await submit.first().click();

    // The form's own config declares navigateToUrl to a "preferencecentre"
    // page on success — the real completion signal for this form, not a
    // guessed one. Fall back to matching visible error wording if that
    // navigation never happens.
    try {
      await page.waitForURL((url) => url.toString().includes("preferencecentre"), { timeout: 15000 });
      await log.info(`Navigated to ${page.url()} — this form's own configured success redirect`);
      return { status: "SUCCESS", message: "Reached the configured post-signup preference centre" };
    } catch {
      // fall through to error/ambiguity handling below
    }

    const error = page.getByText(/required|invalid|error|something went wrong|please enter/i);
    if (await error.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      const errorText = (await error.first().innerText().catch(() => "")).trim();
      await log.warn(`Form error: ${errorText}`);
      return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
    }

    if (page.url() !== formUrl) {
      await log.info(`Form navigated away to ${page.url()}, but not to the expected preferencecentre URL — treating the navigation as evidence of a submission, but worth checking`);
      return { status: "SUCCESS", message: `Navigated to ${page.url()} after submit, not the expected preferencecentre URL` };
    }

    await log.warn("No success redirect, error text, or navigation observed after submit");
    return { status: "FAILED", message: "No confirmation, error, or navigation observed after submit — outcome unclear" };
  },
};
