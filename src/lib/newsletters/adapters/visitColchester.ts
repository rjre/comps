import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

/**
 * Visit Colchester — Colchester City Council's own tourism newsletter
 * ("What's On from Visit Colchester"), signed up for via a standalone
 * e-shot.net (Wired Plus) landing page linked from the footer of
 * visitcolchester.com (pages.comms.colchester.gov.uk/pages/visit), not any
 * competition form. A genuinely different organisation from the
 * already-tracked colchester-zoo-newsletter (council tourism board vs. the
 * zoo itself).
 *
 * Confirmed via curl: the whole signup form is real static server-rendered
 * HTML, not a JS-built widget — a single required email field
 * (`Columns[0].Value`), plus:
 *   - a classic honeypot text input named "website", visually hidden via
 *     inline absolute-positioning-off-canvas CSS on its wrapper div, not a
 *     `type="hidden"` input — a bot that blindly fills every input on the
 *     page would trip it. Left strictly untouched.
 *   - a CSRF token and a handful of fixed hidden config fields
 *     (FormID, HostedWithinLandingPage, QrCodeID, HasCAPTCHA, SendID,
 *     ForSocialSharing, SignUpFormType) already present with correct
 *     values in the page's own markup — none of these need touching.
 *   - a "CapToken" hidden input wired to a small proof-of-work widget
 *     (cap.e-shot.net) loaded by /Scripts/bundles/cap/widget — unlike a
 *     traditional CAPTCHA this isn't a visible challenge for a human to
 *     solve, it's a script that's expected to silently compute and fill
 *     the token on page load. We don't attempt to solve or replicate
 *     anything ourselves either way: just give the widget's own script
 *     time to run, then check the token actually got populated before
 *     submitting — if it's still empty, that's treated the same as a
 *     genuine CAPTCHA block (fail loudly, not guess/submit blind).
 *
 * `SignUpFormType` is `DoubleOptIn` — a real double opt-in list, so a
 * successful submit here just means the confirmation email was triggered,
 * not that the subscription is fully live yet; nothing further to do on
 * our side either way (no separate confirmation-click step this adapter
 * could automate without a mailbox).
 *
 * The form posts via unobtrusive AJAX (`data-ajax="true"`, jquery.unobtrusive-ajax)
 * and swaps in a response fragment in place of #div26057 on completion —
 * there's no plain full-page POST/redirect to wait on, so success is read
 * from that swapped-in DOM content instead.
 *
 * Note: this session's own sandboxed Playwright could not complete a live
 * render of this domain (net::ERR_CONNECTION_RESET once routed through
 * this environment's mandatory egress proxy — the same sandbox networking
 * artifact already documented against devonsTopAttractions.ts and
 * c2cBlowoutCompany.ts, not a site-side block: curl reached the real page
 * and its full form markup cleanly, no anti-automation response). The
 * CapToken behaviour in particular is worth a human's eyes on the very
 * first live run, since it couldn't be observed running here.
 */
export const visitColchesterNewsletterAdapter: NewsletterAdapter = {
  key: "visit-colchester-newsletter",
  siteName: "Visit Colchester",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "load", timeout: 45000 });

    const form = page.locator("#eshotSignUpForm26057");
    if ((await form.count()) === 0) {
      await log.warn("Expected signup form (#eshotSignUpForm26057) not found — page may have changed");
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

    await form.locator("#Columns_0__Value").fill(profile.email);
    await log.info("Filled email");

    // Give the proof-of-work widget (cap.e-shot.net) time to run and
    // populate its token — it's meant to do this silently on page load,
    // not something we solve ourselves.
    const capToken = page.locator("#CapToken");
    let capTokenValue = "";
    if ((await capToken.count()) > 0) {
      try {
        await page.waitForFunction(
          () => {
            const el = document.getElementById("CapToken") as HTMLInputElement | null;
            return !!el && el.value.length > 0;
          },
          { timeout: 15000 },
        );
        capTokenValue = await capToken.inputValue();
        await log.info("Anti-bot CapToken populated by the page's own widget");
      } catch {
        await log.warn("Anti-bot CapToken (cap.e-shot.net proof-of-work widget) never populated within 15s");
      }
    }
    if (!capTokenValue) {
      await log.warn("No CapToken value available — this looks like an anti-bot check we can't satisfy; not submitting blind");
      return { status: "FAILED", message: "Anti-bot CapToken widget did not produce a token — not attempting to solve or evade it" };
    }

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

    // Unobtrusive-AJAX swap replaces #div26057's content in place — no
    // navigation to wait on. Match on real wording rather than a guessed
    // class, since the replacement markup wasn't observed directly.
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
