import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Future PLC's shared "newsletterForm" widget — confirmed directly on both
 * marieclaire.co.uk/newsletter and womanandhome.com/newsletter (identical
 * markup/config, just a different NEWSLETTER_CODE/SOURCE baked into the
 * page), the same publisher whose DMRI reader-competitions platform
 * (dmriComps.ts) this project already tracks a Marie Claire/Woman's Weekly
 * competition on. Written generically against the widget rather than one
 * brand's page, same reasoning as dmriComps.ts: adding another Future PLC
 * title's newsletter later is just a new NewsletterSource row pointing at
 * this same adapterKey, not a new file.
 *
 * The widget renders a real <form> (hydrated client-side from a JSON config
 * embedded in the page, confirmed directly by reading that config out of
 * the raw HTML) with: a hidden NAME field (left as-is, no value to give it
 * here), the visible email input (name="MAIL"), hidden NEWSLETTER_CODE/
 * LANG/SOURCE/COUNTRY fields (left as-is), two independently-optional
 * checkboxes — CONTACT_OTHER_BRANDS ("Contact me with news and offers from
 * other Future brands") and CONTACT_PARTNERS ("Receive email from us on
 * behalf of our trusted partners or sponsors") — both deliberately left
 * unticked, since both are broader third-party/other-brand marketing, not
 * this newsletter itself. Submits via a "Sign me up" button; the widget's
 * own embedded config supplies its exact success/failure copy, matched
 * here rather than guessed.
 *
 * Same Sourcepoint CMP (an iframe on privacy-mgmt.com) as dmriComps.ts on
 * this publisher's comps.* subdomains — dismissed the same way (no
 * one-click reject-all offered, only "Agree").
 */
export const futurePlcNewsletterAdapter: NewsletterAdapter = {
  key: "future-plc-newsletter",
  siteName: "Future PLC newsletter",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1500);

    const spFrame = page.frames().find((f) => f.url().includes("privacy-mgmt.com"));
    if (spFrame) {
      await spFrame
        .getByRole("button", { name: "Agree", exact: true })
        .click({ timeout: 8000 })
        .catch(() => {});
      await log.info("Dismissed consent modal (Agree — no one-click reject-all offered)");
    }
    await page.waitForTimeout(500);

    const widget = page.locator('[id^="slice-container-newsletterForm"], [data-component-name="Newsletter:NewsletterForm"]').first();
    const emailField = widget.locator('input[name="MAIL"]');
    if ((await emailField.count()) === 0) {
      await log.warn("Expected newsletter widget email field (input[name=MAIL]) not found — page may have changed or widget hasn't hydrated");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    await emailField.fill(profile.email);
    await log.info("Filled email field");
    // CONTACT_OTHER_BRANDS ("other Future brands") and CONTACT_PARTNERS
    // ("trusted partners or sponsors") both deliberately left unticked —
    // broader marketing, not this newsletter itself.

    const submit = widget.getByRole("button", { name: "Sign me up" }).or(widget.locator('input[type="submit"][value="Sign me up"]'));
    if ((await submit.count()) === 0) {
      await log.warn("Submit control ('Sign me up') not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.first().click();

    // Exact copy read directly out of this widget's own embedded config
    // (successMessage/failureMessage), not guessed.
    const success = page.getByText(/thank you for signing up|you are now subscribed|your newsletter sign-up was successful/i);
    const error = page.getByText(/there was a problem|please refresh the page|account already exists/i);
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
      await log.info(`Subscribed: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText || "unknown error"}` };
  },
};
