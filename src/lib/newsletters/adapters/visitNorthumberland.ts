import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Visit Northumberland's own "Newsletter Sign Up" modal, triggered from a
 * button on the homepage (visitnorthumberland.com) and reused elsewhere on
 * the site. The already-tracked visit-northumberland *competition* adapter
 * documents a same-named modal embedded on competition pages that turns
 * out to be a copy-pasted duplicate of the competition-entry component
 * itself (same Pure360ListName, "featured in this competition" wording) —
 * not a real newsletter. This is a different instance: confirmed directly
 * from the served homepage HTML and the site's own core-js-bundle.js that
 * this one is a genuinely separate JS component (`.js-modal-newsletter` /
 * `.js-newsletter-submit`, its own `newsletter` object in the bundle, no
 * Pure360ListName or competition wording anywhere in its markup) posting
 * to a distinct endpoint (POST /api/newsletter, invisible reCAPTCHA v3
 * action "newsletter" — not solved/evaded, just executed) rather than the
 * competition form's /api/competition.
 *
 * Fields (all required except the optional "Interests" checkboxes, which
 * are content preferences left untouched): Title, FirstName, LastName,
 * Email, Address1, Town, County, Postcode, Country (a full <select>,
 * United Kingdom chosen). The one checkbox, #EmailMe, is labelled "Yes,
 * Visit Northumberland can email me" and is itself required to submit at
 * all — that's the newsletter's own actual opt-in, not a bundled
 * partner/marketing box, so it's ticked here (this is the newsletter
 * adapter; the sibling competition adapter leaves the same-named field on
 * its own page unticked).
 *
 * On success the bundle hides `.form` and reveals a `.confirmation` block
 * already present in the static page ("Thank you for joining our
 * newsletter"); on failure it fills `.newsletter_response` with "There was
 * an issue submitting your request". Neither element is visible on load,
 * so matched by wording once the submit click resolves.
 */
export const visitNorthumberlandNewsletterAdapter: NewsletterAdapter = {
  key: "visit-northumberland-newsletter",
  siteName: "Visit Northumberland",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 }).catch(async () => {
      await log.warn("Page 'load' event didn't fire within 45s — continuing anyway");
    });

    // Same self-hosted CookieConsent banner as the competition adapter on
    // this site — matched by accessible text, not a guessed selector, and
    // re-checked right before the modal-opening click below too.
    const dismissCookieBanner = async (timeout: number) => {
      const reject = page.getByRole("button", { name: /reject all|necessary only|decline/i });
      if (await reject.first().isVisible({ timeout }).catch(() => false)) {
        await reject.first().click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
      }
    };
    await dismissCookieBanner(8000);

    const wrapper = page.locator(".js-modal-newsletter").first();
    if ((await wrapper.count()) === 0) {
      await log.warn("Expected newsletter modal (.js-modal-newsletter) not found on page");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    // The modal starts hidden ("hide" class) until a trigger button opens
    // it — several buttons share this data-tgl-target, including the
    // modal's own close button, so exclude that one explicitly.
    const trigger = page.locator('button[data-tgl-target=".js-modal-newsletter"]:not(.modal_close)').first();
    if ((await trigger.count()) === 0) {
      await log.warn("Expected newsletter modal trigger button not found on page");
      return { status: "FAILED", message: "Newsletter modal trigger not found on page" };
    }
    await dismissCookieBanner(3000);
    await trigger.click();
    await wrapper.waitFor({ state: "visible", timeout: 10000 });
    await log.info("Opened the newsletter modal");

    if (!profile.addressLine1 || !profile.city || !profile.region || !profile.postalCode) {
      await log.warn("Profile is missing address fields (addressLine1/city/region/postalCode) required by this form");
      return { status: "FAILED", message: "Profile missing address fields required by this form" };
    }

    if (profile.title) {
      const titleSelect = wrapper.locator("#Title");
      const hasOption = (await titleSelect.locator(`option[value="${profile.title}"]`).count()) > 0;
      if (hasOption) {
        await titleSelect.selectOption(profile.title);
        await log.info(`Selected title: ${profile.title}`);
      } else {
        await log.warn(`Profile title "${profile.title}" isn't one of this form's options — leaving unselected`);
      }
    } else {
      await log.warn("Profile has no title set — this form's Title field is required");
      return { status: "FAILED", message: "Profile missing title required by this form" };
    }

    await wrapper.locator("#FirstName").fill(profile.firstName);
    await wrapper.locator("#LastName").fill(profile.lastName);
    await wrapper.locator("#Email").fill(profile.email);
    await wrapper.locator("#Address1").fill(profile.addressLine1);
    await wrapper.locator("#Town").fill(profile.city);
    await wrapper.locator("#County").fill(profile.region);
    await wrapper.locator("#Postcode").fill(profile.postalCode);
    await wrapper.locator("#Country").selectOption("United Kingdom");
    await log.info("Filled title, name, email, and address");

    // Interests[] checkboxes left untouched deliberately (content
    // preferences, not consent). #EmailMe IS this newsletter's own real
    // opt-in and is required to submit at all — ticked here on purpose.
    const emailMe = wrapper.locator('label[for="EmailMe"]');
    await emailMe.click();
    const emailMeChecked = await wrapper.locator("#EmailMe").isChecked();
    if (!emailMeChecked) {
      await log.warn("Clicking the 'Yes, Visit Northumberland can email me' label did not check the underlying checkbox");
      return { status: "FAILED", message: "Could not tick the required newsletter opt-in checkbox" };
    }
    await log.info("Ticked the newsletter opt-in checkbox (this form's own required consent)");

    await dismissCookieBanner(3000);

    const submit = wrapper.locator(".js-newsletter-submit");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (.js-newsletter-submit) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    const confirmation = wrapper.getByText(/thank you for joining our newsletter/i);
    const error = wrapper.getByText(/there was an issue submitting your request/i);
    try {
      await Promise.race([
        confirmation.first().waitFor({ state: "visible", timeout: 30000 }),
        error.first().waitFor({ state: "visible", timeout: 30000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 30s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await confirmation.first().isVisible().catch(() => false)) {
      const text = (await confirmation.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
