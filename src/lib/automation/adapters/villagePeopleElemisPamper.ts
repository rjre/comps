import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Village People Magazine — "WIN the ultimate Elemis pamper experience at
 * John Lewis Norwich", on village-people.info/enter-our-competition/. Same
 * site/page as village-people-banham-zoo and village-people-ultimate-ears,
 * a genuinely separate Contact Form 7 instance (id 103089) with the
 * identical field shape (name / single address textarea / phone / email),
 * no marketing checkbox on the form itself.
 *
 * Same site-wide reCAPTCHA v3 caveat as villagePeopleUltimateEars.ts: this
 * install has already been confirmed (on form 103083) to consistently
 * score-reject submissions as spam regardless of a valid-looking token.
 * Built anyway (never solved/evaded) so the real outcome for this specific
 * form is confirmed rather than assumed.
 */
export const villagePeopleElemisPamperAdapter: CompetitionAdapter = {
  key: "village-people-elemis-pamper",
  siteName: "Village People Magazine",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded" });

    // Silktide's older CookieConsent plugin — configured (per the site's
    // own inline script) with a dismiss button labelled "Okay"; matched by
    // that exact configured wording rather than a guessed class, since the
    // plugin's markup isn't present in the static page.
    const dismissCookieBanner = async (timeout: number) => {
      const okay = page.getByRole("button", { name: "Okay", exact: true }).or(page.getByRole("link", { name: "Okay", exact: true }));
      if (await okay.first().isVisible({ timeout }).catch(() => false)) {
        await okay.first().click();
        await log.info("Dismissed cookie consent banner");
      }
    };
    await dismissCookieBanner(10000);

    // This specific competition's form, identified by its Contact Form 7
    // instance id — the page hosts several unrelated competitions, each
    // with their own separate <form data-wpcf7-id="...">.
    const form = page.locator('form:has(input[name="_wpcf7"][value="103089"])');
    if ((await form.count()) === 0) {
      await log.warn("Elemis pamper entry form (wpcf7 id 103089) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    if (!profile.addressLine1 || !profile.city || !profile.postalCode) {
      await log.warn("Profile is missing address fields (addressLine1/city/postalCode) required by this form's single address textarea");
      return { status: "FAILED", message: "Profile missing address fields required by this form" };
    }
    if (!profile.phone) {
      await log.warn("Profile is missing phone, required by this form");
      return { status: "FAILED", message: "Profile missing phone required by this form" };
    }

    const fullName = `${profile.firstName} ${profile.lastName}`.trim();
    const addressLines = [profile.addressLine1, profile.addressLine2, profile.city, profile.region, profile.postalCode]
      .filter((line): line is string => Boolean(line))
      .join("\n");

    await form.locator('input[name="your-name"]').fill(fullName);
    await form.locator('textarea[name="address"]').fill(addressLines);
    await form.locator('input[name="phone"]').fill(profile.phone);
    await form.locator('input[name="your-email"]').fill(profile.email);
    await log.info(`Filled name (${fullName}), address, phone, email`);

    await dismissCookieBanner(3000);

    const submit = form.locator('input[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found in entry form");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    // Same REST API submit mechanics as villagePeopleBanhamZoo.ts (this
    // form's own endpoint, id 103089) — the displayed message is generic,
    // so the raw JSON `status` field is read directly instead.
    const [ajaxResponse] = await Promise.all([
      page
        .waitForResponse((r) => r.url().includes("/contact-forms/103089/feedback") && r.request().method() === "POST", { timeout: 15000 })
        .catch(() => null),
      submit.click(),
    ]);

    const responseOutput = form.locator(".wpcf7-response-output");
    try {
      await responseOutput.waitFor({ state: "visible", timeout: 10000 });
    } catch {
      await log.warn("No response message appeared in the form within 10s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    const responseText = (await responseOutput.innerText().catch(() => "")).trim();
    const ajaxJson = await ajaxResponse?.json().catch(() => null);
    const realStatus = ajaxJson?.status as string | undefined;

    if (realStatus === "mail_sent") {
      await log.info(`Entry submitted: ${responseText}`);
      return { status: "SUCCESS", message: responseText || undefined };
    }

    if (realStatus === "spam") {
      await log.warn(`CF7 flagged this submission as spam (reCAPTCHA v3 score rejection) — UI showed: "${responseText}"`);
      return { status: "FAILED", message: "Blocked by reCAPTCHA v3 spam-score rejection — not solved or evaded" };
    }

    await log.warn(`Form response (status: ${realStatus ?? "unknown"}): ${responseText}`);
    return { status: "FAILED", message: `Form rejected submission (${realStatus ?? "unknown"}): ${responseText || "unknown error"}` };
  },
};
