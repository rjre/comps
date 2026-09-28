import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Reach plc's shared reader-competitions widget — a JotForm instance
 * embedded via a same-template <iframe src="https://data.reachplc.com/...">
 * on individual competition articles across Reach's national and local
 * titles (confirmed directly on mirror.co.uk; the same platform is used
 * site-wide across Reach's other titles — Express, Daily Star, OK!, and
 * its local "Live" network — so this is written generically rather than
 * scoped to one masthead). Every instance checked (Butlin's, P&O Cruises,
 * Alton Towers, Oak Furnitureland — all Sept 2026) uses IDENTICAL internal
 * JotForm field ids regardless of the competition or brand, because
 * they're all clones of the same template: #input_59 (first name),
 * #input_58 (last name), #input_6 (email), #input_32_0 (a single required
 * "Yes I understand" T&Cs-acknowledgement radio — legal acceptance, not
 * marketing), #input_2 (submit). This adapter is therefore keyed on the
 * iframe's presence rather than per-competition field maps — a new Reach
 * plc competition is just a new Competition row with this adapterKey, no
 * new code.
 *
 * Each instance also carries several genuinely optional newsletter
 * checkboxes (name="q132_dontMiss[]", Mirror-brand topics) and a "receive
 * emails from across the Reach Plc family" checkbox (name="q155_typeA[]"),
 * plus sometimes a sponsor-specific opt-in (e.g. Oak Furnitureland's
 * name="q157_oakFurnitureland[]" — confirmed NOT to carry the HTML
 * `required` attribute despite its asterisked label). None of these are
 * ever ticked — only the T&Cs radio, which is required to enter at all.
 *
 * A visible (explicit-render, not invisible/managed) Google reCAPTCHA v2
 * checkbox gates submission on every instance checked. Not solved or
 * evaded: its presence is checked for and the adapter fails loudly before
 * ever clicking submit, same as kentAttractions.ts.
 *
 * Cookie consent is Reach's own "CIPA" notice
 * (data-testid="cipa-accept-button") — confirmed directly it offers only
 * one "Accept" button, no one-click reject-all, same situation already
 * handled on Future PLC/Bauer's CMPs elsewhere in this project.
 */
export const reachPlcCompetitionAdapter: CompetitionAdapter = {
  key: "reachplc-competition",
  siteName: "Reach plc reader competitions",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    // This page loads a heavy ad/consent/analytics stack before the
    // competition iframe settles — wait for the full load event, not just
    // DOMContentLoaded.
    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(2000);

    const dismissCookieBanner = async (timeout: number) => {
      const rejectButton = page
        .getByRole("button", { name: /reject all|do not accept|i do not accept|necessary only|disagree|manage preferences/i })
        .first();
      if (await rejectButton.isVisible({ timeout }).catch(() => false)) {
        await rejectButton.click();
        await log.info("Dismissed cookie banner (rejected non-essential cookies)");
        return;
      }
      const acceptButton = page.locator('[data-testid="cipa-accept-button"]');
      if (await acceptButton.isVisible({ timeout: 2000 }).catch(() => false)) {
        await acceptButton.click();
        await log.warn("Cookie banner offered no reject-all option (Reach's CIPA notice) — accepted (no other way to proceed)");
      }
    };
    await dismissCookieBanner(10000);

    const iframeLocator = page.locator('iframe[src*="data.reachplc.com"]');
    if ((await iframeLocator.count()) === 0) {
      await log.warn("No Reach plc competition-form iframe (data.reachplc.com) found on the page — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }
    const form = page.frameLocator('iframe[src*="data.reachplc.com"]').first();

    const firstName = form.locator("#input_59");
    if ((await firstName.count()) === 0) {
      await log.warn("Expected first-name field (#input_59) not found in the competition iframe — form may have changed");
      return { status: "FAILED", message: "Entry form fields not found in iframe" };
    }

    await firstName.fill(profile.firstName);
    await form.locator("#input_58").fill(profile.lastName);
    await form.locator("#input_6").fill(profile.email);
    await log.info("Filled first name, last name, email");
    // Every "q<n>_..." newsletter/marketing checkbox on this form (Mirror
    // topics, Reach Plc family, any sponsor-specific opt-in) is left
    // deliberately unticked.

    await dismissCookieBanner(3000);

    const termsRadio = form.locator("#input_32_0");
    if ((await termsRadio.count()) === 0) {
      await log.warn("Required T&Cs acknowledgement radio (#input_32_0) not found");
      return { status: "FAILED", message: "T&Cs acknowledgement control not found" };
    }
    await termsRadio.check();
    await log.info("Checked required 'Yes I understand' T&Cs-acknowledgement radio (acceptance of entry rules, not marketing)");

    // Explicit-render Google reCAPTCHA v2 (the classic "I'm not a robot"
    // checkbox widget, not an invisible/managed challenge) gates submit on
    // every instance checked. Not attempting to solve it — just detecting
    // it and failing loudly rather than submitting into a guaranteed
    // rejection. Checking the frame's own presence directly (rather than a
    // nested locator's visibility) — confirmed more reliable on this page,
    // which loads dozens of unrelated ad-tech iframes that can otherwise
    // make a scoped visibility check flaky.
    await page.waitForTimeout(3000);
    const hasVisibleRecaptcha = page.frames().some((f) => f.url().includes("google.com/recaptcha/api2/anchor"));
    if (hasVisibleRecaptcha) {
      await log.warn("This form requires solving a visible reCAPTCHA challenge — not attempting to solve it");
      return { status: "FAILED", message: "Blocked by a visible reCAPTCHA challenge — not solved or evaded" };
    }

    const submit = form.locator("#input_2");
    if ((await submit.count()) === 0) {
      await log.warn("Submit button (#input_2) not found");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // JotForm's own JS intercepts this submit (the <form> itself posts to
    // https://data.reachplc.com/submit/<formID>, PRG-style, but nobody has
    // watched a real submission through this widget to confirm whether it
    // swaps the iframe's content in place or navigates it — this project
    // never live-submits fabricated profile data to find out). Wait
    // generously, since an AJAX-driven submit through a reCAPTCHA-gated
    // JotForm can take far longer than a short fixed timeout, then match
    // broadly by wording rather than a guessed selector.
    const success = form.getByText(/thank you|you're entered|you are entered|entry received|successfully entered|good luck/i);
    const error = form.getByText(/already entered|invalid|error|something went wrong|please enter|please complete the security check/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 45000 }),
        error.first().waitFor({ state: "visible", timeout: 45000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 45s after submit — the reCAPTCHA may have silently blocked the automated browser");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmation shown: ${text}`);
      return { status: "SUCCESS", message: text || undefined };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Form error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
