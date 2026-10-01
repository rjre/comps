import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Best Days Out Cornwall — "Golden Ticket" prize draw
 * (bestdaysoutcornwall.co.uk/competitions/), run by the Cornwall
 * Association of Tourist Attractions (a genuine regional tourism
 * consortium, company no. 12469987 — same kind of organisation as the
 * already-tracked devons-top-attractions and north-norfolk-attractions).
 * No purchase necessary (confirmed via the page's own T&Cs: "There is no
 * entry fee and no purchase necessary to enter this competition"). Prize:
 * a Golden Ticket giving four people free entry to 30+ Cornwall attractions
 * for one year from March 2027. Closes 31 Dec 2026 (long runway); winner
 * drawn 3 Jan 2027.
 *
 * The competitions page hosts two separate Elementor Forms: this
 * competition's own (name/email/county, confirmed directly from the served
 * HTML — form_id "188d3752") and a second, unrelated newsletter-only form
 * further down the page (just an email field) — only the first is targeted
 * here, matched by its form_id hidden input rather than "the first form on
 * the page" so a future page reorder can't silently swap them.
 *
 * This site runs the "Simple Cloudflare Turnstile" WordPress plugin, which
 * injects a Turnstile widget after every Elementor form site-wide
 * (confirmed directly from its own embedded config:
 * `{"sitekey":"0x4AAAAAAAQcOXBXZVSPWB-5","position":"afterform",
 * "appearance":"always"}`) — the widget itself isn't in the static HTML
 * (added client-side at "afterform" position, id `cf-turnstile188d3752`
 * for this form), so it can't be seen without a live render. "always"
 * appearance still usually resolves non-interactively for a normal
 * browser session (Cloudflare's whole point), so this fills the form and
 * waits for the widget's own response token to populate rather than
 * assuming either success or a block up front — only failing loudly if a
 * real interactive challenge iframe renders or the token never appears,
 * same "don't solve or evade" policy as every other Turnstile/reCAPTCHA
 * adapter in this project.
 */
export const bestDaysOutCornwallGoldenTicketAdapter: CompetitionAdapter = {
  key: "best-days-out-cornwall-golden-ticket",
  siteName: "Best Days Out Cornwall",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 });

    const cookieReject = page.locator(".cky-btn-reject");
    if (await cookieReject.first().isVisible({ timeout: 8000 }).catch(() => false)) {
      await cookieReject.first().click();
      await log.info("Dismissed cookie banner (rejected non-essential cookies)");
    }

    const form = page.locator('form:has(input[name="form_id"][value="188d3752"])');
    if ((await form.count()) === 0) {
      await log.warn("Expected entry form (form_id 188d3752) not found — page may have changed");
      return { status: "FAILED", message: "Entry form not found on page" };
    }

    if (!profile.region) {
      await log.warn("Profile is missing region (county), required by this form");
      return { status: "FAILED", message: "Profile missing region required by this form" };
    }

    await form.locator('input[name="form_fields[name]"]').fill(`${profile.firstName} ${profile.lastName}`.trim());
    await form.locator('input[name="form_fields[email]"]').fill(profile.email);
    await form.locator('input[name="form_fields[field_be77762]"]').fill(profile.region);
    await log.info("Filled name, email, county");

    const submit = form.locator('button[type="submit"]');
    if ((await submit.count()) === 0) {
      await log.warn("Submit button not found in entry form");
      return { status: "FAILED", message: "Submit control not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    await submit.click();

    // The Turnstile widget for this form renders (client-side, "afterform")
    // as #cf-turnstile188d3752 — wait briefly for its response token to
    // populate (normal, non-interactive completion) and only treat it as a
    // genuine block if a challenge iframe is actually visible.
    const turnstileContainer = page.locator("#cf-turnstile188d3752");
    if (await turnstileContainer.count()) {
      const challengeFrame = turnstileContainer.locator('iframe[src*="challenges.cloudflare.com"]');
      const tokenField = turnstileContainer.locator('input[name="cf-turnstile-response"]');
      const tokenPopulated = await tokenField
        .evaluate((el) => (el as HTMLInputElement).value.length > 0, { timeout: 15000 })
        .catch(() => false);
      if (!tokenPopulated && (await challengeFrame.isVisible({ timeout: 3000 }).catch(() => false))) {
        await log.warn("This form requires solving a visible Cloudflare Turnstile challenge — not attempting to solve it");
        return { status: "FAILED", message: "Blocked by a visible Cloudflare Turnstile challenge — not solved or evaded" };
      }
    }

    const success = page.getByText(/thank you|you'?re entered|good luck|entry received|successfully entered|your message was sent/i);
    const error = page.getByText(/already entered|invalid|error|something went wrong|please enter/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 20000 }),
        error.first().waitFor({ state: "visible", timeout: 20000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation nor an error message appeared within 20s after submit");
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
