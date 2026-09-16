import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Explore Essex (Essex County Council's own Country Parks / Culture Essex
 * tourism arm, explore-essex.com) — monthly e-newsletter. A genuinely
 * separate organisation from the already-tracked Visit Essex (visitessex.com,
 * the county's destination management org) despite the similar name.
 *
 * The newsletter-subscribe page itself is just a wrapper; the real form is
 * a same-platform e-shot.net (Wired Plus) landing page embedded via
 * `<iframe src="https://news.news.essex.gov.uk/Signup/...">`
 * (confirmed via curl) — same platform already documented in
 * visitColchester.ts, but this particular form instance has no CapToken
 * anti-bot widget (confirmed absent from the served HTML, unlike
 * Colchester's). We navigate straight to that iframe's own URL rather than
 * the wrapper page, sidestepping cross-origin iframe interaction entirely.
 *
 * Fields: optional First name (`Columns[0].Value`), required Email
 * (`Columns[1].Value`), a classic honeypot text input named "website"
 * (visually hidden via inline off-canvas CSS on its wrapper div, not
 * type="hidden" — left strictly untouched), and one optional preference
 * checkbox ("Kids and Activities" — more specific info about children's/
 * family outdoor sessions) left deliberately unticked, same as any other
 * optional non-essential box in this project. `SignUpFormType` is
 * `DoubleOptIn`, so a successful submit here just triggers Essex County
 * Council's own confirmation email — nothing further to automate on our
 * side without a mailbox.
 *
 * The form posts via unobtrusive AJAX and swaps in a response fragment in
 * place of its own wrapper div — no navigation to wait on, so success is
 * read from that swapped-in wording rather than a guessed selector, same
 * approach as visitColchester.ts.
 */
export const exploreEssexNewsletterAdapter: NewsletterAdapter = {
  key: "explore-essex-newsletter",
  siteName: "Explore Essex",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });

    const form = page.locator("#eshotSignUpForm259689");
    if ((await form.count()) === 0) {
      await log.warn("Expected signup form (#eshotSignUpForm259689) not found — page may have changed");
      return { status: "FAILED", message: "Newsletter signup form not found on page" };
    }

    const honeypot = form.locator('input[name="website"]');
    if ((await honeypot.count()) > 0) {
      const honeypotValue = await honeypot.inputValue().catch(() => "");
      if (honeypotValue) {
        await log.warn("Honeypot field 'website' is unexpectedly non-empty before we've touched anything — aborting rather than risk tripping spam detection");
        return { status: "FAILED", message: "Unexpected pre-filled honeypot field" };
      }
    }
    // Deliberately never filled — a real visitor leaves it blank; only a
    // bot filling every input on the page would set it.

    await form.locator("#Columns_0__Value").fill(profile.firstName);
    await form.locator("#Columns_1__Value").fill(profile.email);
    await log.info("Filled first name, email — left the optional 'Kids and Activities' preference checkbox unticked");

    const submit = form.locator('button[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found in signup form");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // Unobtrusive-AJAX swap replaces the form's own wrapper div content in
    // place — no navigation to wait on. Match on real wording rather than a
    // guessed class, same approach as visitColchester.ts on the same platform.
    const success = page.getByText(/thank you|you.?re signed up|you have been added|check your email|confirm your subscription|successfully subscribed/i);
    const error = page.locator(".eshot-hook-model-error-msg").filter({ hasText: /.+/ });
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 20000 }),
        error.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a success message nor an error appeared within 20s after submit");
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
