import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * c2c (Trenitalia c2c Limited) — the train operator this project already
 * tracks a competition for (c2cBlowoutCompany.ts). Its own "sign-up" page
 * (c2c-online.co.uk/sign-up/) advertises the newsletter but renders no
 * actual form — confirmed directly, the page is just a heading and benefit
 * blurbs with a single "Email preferences" link. That link goes to a real
 * Salesforce Marketing Cloud SmartCapture form
 * (cloud.mail-c2c-online.co.uk/preferences) with one field (email) and no
 * consent checkboxes at all, so this adapter targets that page directly
 * rather than the sign-up page that merely links to it.
 *
 * Double opt-in: the form's own embedded confirmation copy says a link
 * must still be clicked in the inbox to activate ("Please check your inbox
 * for a link to modify your contact preferences") — same as
 * nationalLobsterHatchery.ts's Mailchimp signup. This adapter's job ends at
 * a confirmed submission; completing the double opt-in (if wired up at
 * all) is a separate concern.
 */
export const c2cNewsletterAdapter: NewsletterAdapter = {
  key: "c2c-newsletter",
  siteName: "c2c",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });

    const form = page.locator("#smartcapture-block-lkv2msofdr");
    if ((await form.count()) === 0) {
      await log.warn("Expected SmartCapture form (#smartcapture-block-lkv2msofdr) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter form not found on page" };
    }

    const emailField = form.locator('input[name="Email"]');
    await emailField.fill(profile.email);
    await log.info("Filled email field");

    const submit = form.getByRole("button", { name: "Submit", exact: true });
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found in newsletter form");
      return { status: "FAILED", message: "Submit button not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // Exact copy read directly out of this form's own embedded
    // confirmationMessage config, not guessed.
    const success = page.getByText(/thank you for your submission/i);
    const error = page.getByText(/please enter a valid|something went wrong|error/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 15s after submit");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Subscribed: ${text} (note: double opt-in — a confirmation link in the inbox must still be clicked to activate)`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Newsletter form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
