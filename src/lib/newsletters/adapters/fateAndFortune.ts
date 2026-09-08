import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Fate & Fortune magazine's own newsletter signup
 * (fateandfortunemagazine.co.uk/newsletter-sign-up/) — a genuinely separate
 * page from the "latest competitions" page already tracked as
 * bauer-competition-form, and on a different platform (that one posts to
 * competitionform.bauersecure.com; this one is a Bauer-wide Wayin/
 * EngageSciences ("Marigold") widget). The outer page is a Next.js
 * client-rendered block that only shows the widget's embed div once
 * hydrated — its own data-flatplan-embed-url resolves through a static
 * redirect chain (confirmed directly, no JS execution needed to follow
 * it: display.engagesciences.com/embed/<id> -> a document.write'd
 * <iframe src="https://xd.wayin.com/display/container/dc/<id>"> -> the
 * real <form id="xCampaignForm"> itself) to the genuine, fully inspectable
 * form this adapter fills in. Fields confirmed directly from that form's
 * own markup:
 *   - #name_Firstname, #name_Lastname, #email (all required)
 *   - #brand_opt_in_check — "the free, curated Fate & Fortune newsletter,
 *     as well as special offers and competitions" — THIS is the
 *     newsletter itself, ticked here.
 *   - #group_opt_in_check ("sister brands in the Bauer Media Group") and
 *     #third_party_opt_in_check ("carefully selected partners") — both
 *     broader third-party marketing, left unticked per README's
 *     no-auto-consent rule.
 * The widget's own embedded config states `"captcha":"none"` for this
 * form — not solved/evaded, just confirmed absent; fails loudly if one
 * ever appears. The submit button (labelled "Register") sits in a
 * Parsley-validated container that only reveals itself once the required
 * fields pass client-side validation on blur, so a Tab press follows the
 * last fill to trigger that before looking for it.
 *
 * Nobody has watched a real submission through this widget (this project
 * never live-submits fabricated profile data to find out) and no
 * confirmation copy could be found anywhere in the widget's static
 * config, so — same caution as bauerCompetitionForm.ts — an errorless
 * response is never defaulted to SUCCESS here. It fails loudly with the
 * response logged, to be tightened once a real run's log shows the
 * actual outcome.
 */
export const fateAndFortuneNewsletterAdapter: NewsletterAdapter = {
  key: "fate-and-fortune-newsletter",
  siteName: "Fate & Fortune",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    // This page's newsletter widget only mounts after the Next.js bundle
    // hydrates and its own lazy-load logic runs — wait for the full load
    // event, not just DOMContentLoaded, same reasoning as
    // bauerCompetitionForm.ts on the same publisher's competitions page.
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });

    const dismissConsent = async (timeout: number) => {
      const cmpFrame = page.frames().find((f) => f.url().includes("cmp.fateandfortunemagazine.co.uk"));
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
      // proven necessary on this publisher's other CMP
      // (bauerCompetitionForm.ts, futurePlcNewsletter.ts).
      const agreeButton = target.getByRole("button", { name: /^(accept all|agree|i accept)$/i }).first();
      if (await agreeButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await agreeButton.click();
        await log.warn("Consent banner offered no reject-all option — accepted (no other way to proceed)");
      }
    };
    await dismissConsent(10000);

    // Scroll the embed block into view in case the widget is genuinely
    // lazy-loaded on intersection (its container div carries a sibling
    // "lazyLoad" element in the static markup), then poll for the wayin
    // iframe to actually mount — it isn't present at initial load.
    await page
      .locator('[data-flatplan-embed-type="engage-sciences"]')
      .first()
      .scrollIntoViewIfNeeded()
      .catch(() => {});

    let widgetFrame = null;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      widgetFrame = page.frames().find((f) => f.url().includes("xd.wayin.com"));
      if (widgetFrame) break;
      await page.waitForTimeout(500);
    }
    if (!widgetFrame) {
      await log.warn("Newsletter widget iframe (xd.wayin.com) never appeared — page may have changed or failed to lazy-load");
      return { status: "FAILED", message: "Newsletter widget iframe not found" };
    }

    const form = widgetFrame.locator("#xCampaignForm");
    if ((await form.count()) === 0) {
      await log.warn("Expected widget form (#xCampaignForm) not found inside the iframe — widget may have changed");
      return { status: "FAILED", message: "Newsletter form not found in widget" };
    }

    await form.locator("#name_Firstname").fill(profile.firstName);
    await form.locator("#name_Lastname").fill(profile.lastName);
    await form.locator("#email").fill(profile.email);
    // Trigger the widget's on-blur (Parsley) validation, which is what
    // reveals the submit button — confirmed directly it starts inside a
    // CSS-hidden container.
    await form.locator("#email").press("Tab");
    await log.info("Filled first name, last name, email");

    const brandOptIn = form.locator("#brand_opt_in_check");
    if ((await brandOptIn.count()) === 0) {
      await log.warn("Expected newsletter opt-in checkbox (#brand_opt_in_check) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter opt-in checkbox not found" };
    }
    await brandOptIn.check();
    await log.info("Ticked the Fate & Fortune newsletter opt-in — left the Bauer sister-brand and partner opt-ins unticked");
    // #group_opt_in_check (Bauer sister brands) and #third_party_opt_in_check
    // (Bauer's "selected partners") deliberately never ticked.

    await dismissConsent(3000);

    const submit = form.getByRole("button", { name: "Register", exact: true });
    if ((await submit.count()) === 0) {
      await log.warn("Submit button ('Register') not found");
      return { status: "FAILED", message: "Submit control not found" };
    }
    if (!(await submit.isVisible({ timeout: 5000 }).catch(() => false))) {
      await log.warn("Submit button is present but never became visible — required-field validation may not have passed");
      return { status: "FAILED", message: "Submit control never became visible after filling required fields" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    const [response] = await Promise.all([
      page
        .waitForResponse((r) => r.request().method() === "POST" && r.url().includes("api.eu.experiences.engageplatform.com/api/interact/d/record"), {
          timeout: 20000,
        })
        .catch(() => null),
      submit.click(),
    ]);

    if (!response) {
      await log.warn("Never observed a POST to api.eu.experiences.engageplatform.com/api/interact/d/record after submit");
      return { status: "FAILED", message: "No response observed for the form submission" };
    }
    if (!response.ok()) {
      await log.warn(`Form POST returned HTTP ${response.status()}`);
      return { status: "FAILED", message: `Form submission returned HTTP ${response.status()}` };
    }

    const body = await response.text().catch(() => "");
    if (/captcha|human check/i.test(body)) {
      await log.warn("Response after submit mentions a captcha/human check — not solved or evaded");
      return { status: "FAILED", message: "Blocked by a captcha/human check — not solved or evaded" };
    }
    if (/error|invalid|sorry|something went wrong|problem/i.test(body)) {
      await log.warn("Response after submit contains error-like text — treating as a rejected submission");
      return { status: "FAILED", message: "Form response contained error-like text after submit" };
    }

    // No confirmed success copy exists anywhere in this widget's static
    // config (see file header) — an errorless response is deliberately
    // not defaulted to SUCCESS. Logged for diagnosis so this can be
    // tightened once a real run shows the actual response shape.
    const snippet = body.replace(/\s+/g, " ").slice(0, 500);
    await log.warn(`No recognised confirmation text after submit — outcome unclear. Response snippet: ${snippet}`);
    return { status: "FAILED", message: "No recognised confirmation text after submit — outcome unclear, needs adapter update" };
  },
};
