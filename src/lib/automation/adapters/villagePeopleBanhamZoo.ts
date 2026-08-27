import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Village People Magazine — "WIN a wild family adventure!" (Banham Zoo &
 * Africa Alive family day out), on village-people.info/enter-our-competition/.
 * Village People is a genuine Norfolk/Suffolk regional print magazine
 * (villagepeoplemagazines.co.uk) running its own reader competition — a
 * plain Contact Form 7 form, not a third-party data-capture hub. Several
 * unrelated competitions share this one page, each with its own separate
 * <form>; this adapter targets only the Banham Zoo/Africa Alive form
 * (Contact Form 7 id 103083) by its specific field values, not just "the
 * first form on the page". No marketing/newsletter checkbox exists on this
 * form at all, so there's nothing to deliberately leave unticked here.
 *
 * CORRECTED (was previously misdiagnosed as a genuine site-side mail
 * bug): this form runs CF7's reCAPTCHA v3 module (real Google API script,
 * real token, confirmed populated correctly before every submit — this
 * isn't a client-side failure). The generic "Sorry, there was a problem
 * sending your entry" text hides the real reason — read the raw AJAX JSON
 * response directly and it's `"status":"spam"` every time, i.e. Google's
 * invisible risk-scoring rejects the token despite it looking valid,
 * consistently, across many attempts over many hours. This is the same
 * "don't solve or evade" category as every other reCAPTCHA-fronted
 * adapter in this project, just with an unusually misleading UI message —
 * marked SKIPPED rather than retried forever expecting a mail-server
 * fix that was never the actual problem.
 */
export const villagePeopleBanhamZooAdapter: CompetitionAdapter = {
  key: "village-people-banham-zoo",
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
    const form = page.locator('form:has(input[name="_wpcf7"][value="103083"])');
    if ((await form.count()) === 0) {
      await log.warn("Banham Zoo/Africa Alive entry form (wpcf7 id 103083) not found — page may have changed");
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

    // Contact Form 7 (this version) submits via its REST API endpoint
    // (/wp-json/contact-form-7/v1/contact-forms/103083/feedback, confirmed
    // directly — not the older admin-ajax.php pattern) and injects a
    // status message into this specific form's own .wpcf7-response-output
    // div. Its displayed text is a generic "there was a problem sending
    // your entry" regardless of the real reason, so the raw JSON response
    // is read directly too — confirmed live it carries a `status` field
    // ("mail_sent"/"spam"/"validation_failed"/etc.) that's far more
    // specific than the UI copy.
    const [ajaxResponse] = await Promise.all([
      page
        .waitForResponse((r) => r.url().includes("/contact-forms/103083/feedback") && r.request().method() === "POST", { timeout: 15000 })
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
      // Confirmed directly, repeatedly: this form's reCAPTCHA v3 token
      // generates correctly but is consistently score-rejected server-
      // side — Google's invisible risk-scoring flagging this as likely
      // automated, not solved or evaded, same policy as every other
      // reCAPTCHA-fronted adapter in this project.
      await log.warn(`CF7 flagged this submission as spam (reCAPTCHA v3 score rejection) — UI showed: "${responseText}"`);
      return { status: "FAILED", message: "Blocked by reCAPTCHA v3 spam-score rejection — not solved or evaded" };
    }

    await log.warn(`Form response (status: ${realStatus ?? "unknown"}): ${responseText}`);
    return { status: "FAILED", message: `Form rejected submission (${realStatus ?? "unknown"}): ${responseText || "unknown error"}` };
  },
};
