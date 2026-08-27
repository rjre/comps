import { createHash } from "crypto";
import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * comps.marieclaire.co.uk — Marie Claire's official reader competitions
 * club (Future PLC, in partnership with DMRI, a white-label reader-comps
 * platform used by several UK magazine publishers). Found via
 * competitionstoday.co.uk (an aggregator, used only as a lead source —
 * this adapter enters on Future/Marie Claire's own domain, and that
 * aggregator page is what supplied the researched trivia answers below).
 * Genuinely no purchase necessary, real registered UK publisher.
 *
 * Unlike a one-shot competition, this platform runs DAILY prize draws —
 * its own confirmation text says "you can enter this prize draw once each
 * day so enter again tomorrow to increase your chances". Competition rows
 * using this adapter should be given a high `maxEntries` (not the default
 * 1) so the scheduler keeps re-querying them as PENDING and re-entering
 * daily until they close, rather than marking ENTERED after the first win.
 *
 * Entering requires a free Marie Claire competitions-club account — this
 * is the organiser's own official membership system, not an unrelated
 * third-party lead-gen hub (distinct from the earlier Cruise Collective
 * skip), so building an account-creation flow here is in scope. Since
 * AdapterContext doesn't hand back a previously-stored credential on
 * retry, the password is derived deterministically from profile.email (a
 * fixed salt + sha256, formatted to satisfy the site's own password rule:
 * starts with a letter, 8+ characters, at least one number) so every
 * run — whether registering for the first time or logging back in on a
 * later day — computes the same password without needing it fed back in.
 *
 * This domain returns a hard 403 for Playwright's default Chromium user
 * agent string specifically (confirmed directly: the exact same request
 * succeeds with a realistic desktop Chrome UA) — set explicitly before
 * navigating, unlike every other adapter in this project which has never
 * needed to.
 *
 * Confirmed directly, live, that the login endpoint silently creates a
 * minimal account on its very first successful attempt with a brand-new
 * email — no separate "you must register first" step. That minimal
 * account has no address or personal details saved yet, and a competition
 * page's in-page "complete your profile" modal for supplying them turned
 * out to be unreliable (transient/stale frame references, a duplicate
 * `#submit-comp-button` id colliding with an unrelated "Continue" button,
 * and fields that appeared to fill successfully but never actually
 * persisted — confirmed directly by checking /account afterwards and
 * finding them still blank). The dedicated /account page is a real,
 * stable, non-modal form for the exact same fields and reliably persists
 * them ("Thank you. We have successfully updated your account."), so
 * profile completion always goes through that page instead, whether this
 * is a brand-new account or one that's missing details from an earlier
 * silent auto-creation.
 *
 * Each competition here poses its own multiple-choice trivia question — a
 * couple of genuinely factual, independently verifiable options rather
 * than a fill-in-the-blank or subjective prompt (e.g. "How many rooms does
 * Tewkesbury Park have?", answered from the competition page's own
 * descriptive copy). `TRIVIA_ANSWERS` maps each competition URL to its
 * researched correct answer text, matched against the option labels
 * actually rendered (their underlying ids/values are dynamically
 * generated per competition, so matching is done by visible label text).
 *
 * After answering the quiz, submitting can land on a rotating third-party
 * "would you like more information from <some comping/tips newsletter>"
 * opt-in page before the entry is actually confirmed (seen offering both
 * "Across the Leagues EXTRA" and "Coffee Break Winner" on different runs —
 * confirmed directly the exact partner shown varies) — its own "Yes
 * Please" / "No Thank You" radio is answered "Yes Please" (more marketing
 * signup surfaces more competition leads, same policy as elsewhere in this
 * project), matched by that literal radio value since the surrounding
 * id/name is rotated per partner. This can repeat across more than one
 * partner in a row, so it's handled in a loop until a "Confirm Entry" step
 * appears, which is what actually finalises the entry.
 *
 * Every checkbox/radio interaction anywhere on this site (opt-ins, quiz
 * answers, the partner-offer radio) is done via direct DOM property
 * assignment + a dispatched `change` event rather than a Playwright click
 * — native clicks on these particular controls were confirmed, repeatedly
 * and live, to hang indefinitely for a reason never fully isolated
 * (stability checks pass, then nothing — no "intercepts pointer events"
 * message, just a timeout).
 */
const TRIVIA_ANSWERS: Record<string, string> = {
  "https://comps.marieclaire.co.uk/competition/a_two_night_stay_at_tewkesbury_park_marieclaire/122613.php": "93",
};

function derivedPassword(email: string): string {
  const hash = createHash("sha256").update(`marie-claire-comps:${email}`).digest("hex");
  return `Mc${hash.slice(0, 10)}9`;
}

async function checkViaJs(frameOrPage: { evaluate: Function }, selector: string) {
  await frameOrPage.evaluate((sel: string) => {
    document.querySelectorAll<HTMLInputElement>(sel).forEach((el) => {
      el.checked = true;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }, selector);
}

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const LOG_OUT_TEXT = /log\s*out/i;

export const marieClaireCompsAdapter: CompetitionAdapter = {
  key: "marie-claire-comps",
  siteName: "Marie Claire Competitions (Future PLC / DMRI)",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    const answer = TRIVIA_ANSWERS[competitionUrl];
    if (!answer) {
      await log.warn(`No researched trivia answer recorded for ${competitionUrl} — refusing to guess`);
      return { status: "FAILED", message: "No verified answer available for this competition's question" };
    }

    await page.setExtraHTTPHeaders({ "User-Agent": USER_AGENT });
    await log.info(`Navigating to ${competitionUrl}`);
    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 });
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

    const password = derivedPassword(profile.email);

    const loginLink = page.getByText("Log In Now", { exact: true });
    if ((await loginLink.count()) === 0) {
      await log.warn("Expected 'Log In Now' prompt not found — page may have changed");
      return { status: "FAILED", message: "Login prompt not found on page" };
    }
    await loginLink.click();
    await page.waitForTimeout(1500);
    const loginFrame = page.frames().find((f) => f.url().includes("existingMember"));
    if (!loginFrame) {
      await log.warn("Expected login iframe (existingMember) not found");
      return { status: "FAILED", message: "Login form not found on page" };
    }
    await loginFrame.locator("#Login_email").fill(profile.email);
    await loginFrame.locator("#Login_password").fill(password);
    // Clicking #action-login triggers a real navigation of its own — waiting
    // for it (rather than checking in place, or racing it with a manual
    // reload) is what's reliable; confirmed directly, both alternatives
    // produced false negatives.
    await Promise.all([
      page.waitForNavigation({ waitUntil: "load", timeout: 15000 }).catch(() => {}),
      loginFrame.locator("#action-login").click(),
    ]);
    await page.waitForTimeout(1000);
    const loggedIn = await page.getByText(LOG_OUT_TEXT).first().isVisible().catch(() => false);

    if (!loggedIn) {
      await log.info("Login didn't succeed (no account yet) — registering a new Marie Claire competitions account");
      const createLink = page.getByText("Create Free Account", { exact: true });
      if ((await createLink.count()) === 0) {
        await log.warn("Expected 'Create Free Account' link not found — page may have changed");
        return { status: "FAILED", message: "Registration entry point not found on page" };
      }
      await createLink.first().click();
      await page.waitForTimeout(2000);

      const step1 = page.frames().find((f) => f.url().includes("login/step1"));
      if (!step1) return { status: "FAILED", message: "Registration step 1 (password) did not load" };
      await step1.locator("#Register_email").fill(profile.email);
      await step1.locator("#Register_password").fill(password);
      await checkViaJs(step1, "#loginOptIns input[type=checkbox]");
      await log.info("Filled email/password and ticked all opt-ins (T&Cs required, marketing opt-ins deliberate)");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "load", timeout: 15000 }).catch(() => {}),
        step1.locator("#loginNextButton").click(),
      ]);
      await page.waitForTimeout(1000);
    } else {
      await log.info("Logged in with existing account");
    }

    // The account may still be missing address/name/DOB — either a brand
    // new signup (which only just did step 1 above) or an account that was
    // implicitly created by a bare login attempt on some earlier run.
    // /account is the stable, reliable place to check and fill these (see
    // the file-level comment for why the in-page wizard isn't used).
    await page.goto("https://comps.marieclaire.co.uk/account", { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1000);
    const firstNameField = page.locator("#AccountFormUpdate_firstname");
    const currentFirstName = await firstNameField.inputValue().catch(() => "");
    if (!currentFirstName) {
      if (!profile.addressLine1 || !profile.city || !profile.postalCode) {
        await log.warn("Profile is missing address/city/postcode — required by this form");
        return { status: "FAILED", message: "Profile missing required address fields" };
      }
      if (!profile.dateOfBirth) {
        await log.warn("Profile is missing a date of birth — required by this form");
        return { status: "FAILED", message: "Profile missing date of birth" };
      }
      if (profile.title) {
        await page
          .locator("#AccountFormUpdate_title")
          .selectOption({ label: profile.title.replace(/\.$/, "") })
          .catch(() => {});
      }
      await firstNameField.fill(profile.firstName);
      await page.locator("#AccountFormUpdate_surname").fill(profile.lastName);
      if (profile.phone) await page.locator("#AccountFormUpdate_telephone").fill(profile.phone);
      const dob = new Date(profile.dateOfBirth);
      await page.locator("#dobDay").fill(String(dob.getUTCDate()));
      await page.locator("#dobMonth").fill(String(dob.getUTCMonth() + 1));
      await page.locator("#dobYear").fill(String(dob.getUTCFullYear()));
      await page.locator("#paf_address1").fill(profile.addressLine1);
      if (profile.addressLine2) await page.locator("#paf_address2").fill(profile.addressLine2);
      await page.locator("#paf_city").fill(profile.city);
      if (profile.region) await page.locator("#paf_region").fill(profile.region);
      await page.locator("#paf_postcode").fill(profile.postalCode);
      await log.info("Filled account details (title/name/phone/DOB/address)");

      if (dryRun) {
        await log.info("Dry run — account details filled but not submitted");
        return { status: "SUCCESS", message: "Dry run: would have completed profile and entered" };
      }
      await page.locator("#register-button").click();
      await page.waitForTimeout(2000);
      const updateConfirmed = await page
        .getByText(/successfully updated your account/i)
        .first()
        .isVisible()
        .catch(() => false);
      if (!updateConfirmed) {
        await log.warn("Account details update did not show its usual confirmation — may not have saved");
        return { status: "FAILED", message: "Could not confirm account details were saved" };
      }
      await log.info("Account details saved");
    } else if (dryRun) {
      await log.info("Dry run — account already complete, not entering");
      return { status: "SUCCESS", message: "Dry run: would have entered" };
    }

    await page.goto(competitionUrl, { waitUntil: "load", timeout: 45000 });
    await page.waitForTimeout(1500);

    const alreadyDoneToday = await page
      .getByText(/already entered|come back tomorrow|entered today|entered this competition before/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (alreadyDoneToday) {
      await log.info("Already entered this competition's daily draw today");
      return { status: "SKIPPED_ALREADY_ENTERED", message: "Already entered today's draw" };
    }

    const answerLabel = page.locator("label").filter({ hasText: new RegExp(`^${answer}$`) }).first();
    if ((await answerLabel.count()) === 0) {
      await log.warn(`Expected answer option "${answer}" not found among the quiz choices — page may have changed`);
      return { status: "FAILED", message: "Expected quiz answer option not found" };
    }
    const answerFor = await answerLabel.getAttribute("for");
    if (!answerFor) return { status: "FAILED", message: "Could not resolve quiz answer input" };
    await page.evaluate((id: string) => {
      const input = document.getElementById(id) as HTMLInputElement | null;
      if (input) {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }, answerFor);
    await log.info(`Selected quiz answer: ${answer}`);

    // Not `#submit-comp-button` — that id collides with an unrelated
    // "Continue" button elsewhere on a fully-completed-profile version of
    // this page (confirmed directly: two elements share the id, a strict
    // Playwright locator throws). Matched by this button's own value
    // instead, which is unambiguous.
    const enterSelector = 'input[value="Enter Competition!"]';
    if ((await page.locator(enterSelector).count()) === 0) {
      await log.warn("'Enter Competition!' button not found");
      return { status: "FAILED", message: "Submit control not found" };
    }
    await page.locator(enterSelector).click();
    await page.waitForTimeout(2500);

    // Submitting can land on a rotating third-party "more info from <some
    // comping newsletter>" opt-in page zero or more times before the entry
    // is actually confirmed — looped until it stops appearing.
    let offerRounds = 0;
    while ((await page.locator('input[value="Yes Please"]').count()) > 0 && offerRounds < 5) {
      await page.evaluate(() => {
        const input = document.querySelector<HTMLInputElement>('input[value="Yes Please"]');
        if (input) {
          input.checked = true;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      await page.locator(enterSelector).click();
      await page.waitForTimeout(2500);
      offerRounds += 1;
    }
    if (offerRounds > 0) {
      await log.info(`Accepted ${offerRounds} rotating third-party marketing offer(s) required to proceed`);
    }

    const confirmButton = page.getByText("Confirm Entry", { exact: true });
    if ((await confirmButton.count()) > 0) {
      await confirmButton.click();
      await page.waitForTimeout(2000);
    }

    const success = page.getByText(/your answer was correct|you have been entered/i);
    const wrongAnswer = page.getByText(/your answer was (incorrect|wrong)/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        wrongAnswer.first().waitFor({ state: "visible", timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a success nor a wrong-answer message appeared within 15s after confirming entry");
      return { status: "FAILED", message: "No confirmation appeared after submitting entry — outcome unclear" };
    }

    if (await success.first().isVisible().catch(() => false)) {
      const text = (await success.first().innerText().catch(() => "")).trim();
      await log.info(`Confirmed: ${text}`);
      return {
        status: "SUCCESS",
        message: text || "Entered",
        credentials: { username: profile.email, password },
      };
    }

    await log.warn(`Quiz answer "${answer}" was marked wrong by the site — researched answer may be stale`);
    return { status: "FAILED", message: `Answer "${answer}" was rejected as incorrect` };
  },
};
