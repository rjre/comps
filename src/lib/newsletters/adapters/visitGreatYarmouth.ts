import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Visit Great Yarmouth's own e-newsletter signup
 * (visitgreatyarmouth.co.uk/visitor-information/enewsletter-sign-up), run
 * directly by the Great Yarmouth tourism board. Same NewMind/eCMS platform
 * already documented in visitEssexGardenersWorld.ts and
 * northNorfolkAttractions.ts (confirmed directly: identical
 * `window.NewMind` config object and `NewMind.ETWP.Forms.*` calls in the
 * page's own inline script) — this org's own Golden Ticket competition
 * (visitgreatyarmouth.co.uk/whats-on/golden-ticket-competition) was checked
 * the same run but is a seasonal summer draw that had already closed
 * (entries ran 15 Jul-10 Aug 2026), so only the newsletter is tracked here;
 * worth rechecking the competition next summer.
 *
 * This control's field `name` attributes are opaque per-field hashes, but
 * each field also has a stable, human-readable `id` (suffixed `_66805`,
 * this control's own id — matches the page's `sys_control c66805` block),
 * so fields are targeted by id rather than the hash. Title (optional),
 * First Name / Last Name / Email / Confirm Email (all required, confirmed
 * via each field's own `*` mandatory marker) plus a single required
 * "I am happy to be emailed by Visit Great Yarmouth." consent checkbox
 * (`name="consentstatementsaccepted"`) — this page's sole purpose, so
 * ticked deliberately, same as visitEssex.ts and the other NewMind
 * newsletter-only pages in this project. An invisible reCAPTCHA v2
 * (`NewMind.ETWP.Forms.SetupRecaptcha`, same call already seen on other
 * NewMind sites) fronts the submit — not solved or evaded, just submitted
 * normally and failed loudly if it blocks the automated browser.
 */
export const visitGreatYarmouthNewsletterAdapter: NewsletterAdapter = {
  key: "visit-great-yarmouth-newsletter",
  siteName: "Visit Great Yarmouth",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    // NewMind's own native cookie bar (ctl_CookieWarning), same as the
    // fallback already documented in visitNorthNorfolk.ts for this platform
    // family — checked again right before the submit click below too.
    const dismissCookieBanner = async (timeout: number) => {
      const nativeHide = page.locator("div.ctl_CookieWarning a.CookieWarningHide");
      if (await nativeHide.first().isVisible({ timeout }).catch(() => false)) {
        await nativeHide.first().click();
        await log.info("Dismissed cookie warning bar");
      }
    };
    await dismissCookieBanner(10000);

    const form = page.locator("form.form66805");
    if ((await form.count()) === 0) {
      await log.warn("Expected e-newsletter signup form (form.form66805) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    if (profile.title) {
      const titleSelect = page.locator("#title_66805");
      const normalized = profile.title.replace(/\.$/, "").toLowerCase();
      const options = await titleSelect.locator("option").allTextContents();
      const match = options.find((o) => o.replace(/\.$/, "").toLowerCase() === normalized);
      if (match) {
        await titleSelect.selectOption({ label: match });
        await log.info(`Selected title: ${match}`);
      } else {
        await log.warn(`Profile title "${profile.title}" isn't one of this form's options — leaving the default`);
      }
    }

    await page.locator("#forename_66805").fill(profile.firstName);
    await page.locator("#surname_66805").fill(profile.lastName);
    await page.locator("#email_66805").fill(profile.email);
    await page.locator("#email2_66805").fill(profile.email);
    await log.info("Filled title, first name, last name, email, confirm email");

    const consentCheckbox = page.locator('input[name="consentstatementsaccepted"]');
    if ((await consentCheckbox.count()) === 0) {
      await log.warn("Expected consent checkbox (consentstatementsaccepted) not found — page may have changed");
      return { status: "FAILED", message: "Required consent checkbox not found on page" };
    }
    await consentCheckbox.check();
    await log.info("Ticked required 'I am happy to be emailed by Visit Great Yarmouth' consent checkbox — this page's sole purpose");

    await dismissCookieBanner(3000);

    const submit = form.locator('input[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit control not found in signup form");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // This site injects no confirmation copy into the static page, so
    // match broadly by wording rather than a guessed selector, same
    // approach as visitEssexGardenersWorld.ts on the same platform.
    const success = page.getByText(/thank you|you're subscribed|successfully subscribed|sign ?up (complete|successful)/i);
    const error = page.getByText(/invalid|error|something went wrong|please enter|already subscribed/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 15s after submit — may indicate the invisible reCAPTCHA blocked submission");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Subscribed: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
