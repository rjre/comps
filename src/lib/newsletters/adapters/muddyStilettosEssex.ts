import { randomBytes } from "crypto";
import type { NewsletterAdapter, NewsletterAdapterContext, SubscriptionOutcome } from "../types";

// Values from the county checkbox list on the signup form — selecting
// every region this project already targets for competitions, plus their
// flagship "Muddy Stilettos" newsletter.
const TARGET_COUNTY_VALUES = [
  "22", // Essex
  "24", // London
  "12", // Norfolk
  "15", // Suffolk & Cambridgeshire
  "10", // Kent
  "9", // Cornwall
  "14", // Devon
  "30", // Wales
  "1", // Muddy Stilettos (flagship)
];

function generatePassword(): string {
  return randomBytes(18).toString("base64url");
}

/**
 * Muddy Stilettos — a regional days-out/lifestyle media brand covering
 * exactly this project's target counties. Unlike a simple email-list
 * opt-in, their newsletter requires creating a real account (username +
 * password), so this adapter generates a password and returns it via
 * SubscriptionOutcome.credentials for the runner to store on the
 * NewsletterSource record — never logged in plaintext.
 */
export const muddyStilettosEssexAdapter: NewsletterAdapter = {
  key: "muddy-stilettos-essex",
  siteName: "Muddy Stilettos (Essex sign-up)",
  async subscribe({ page, sourceUrl, profile, log, dryRun }: NewsletterAdapterContext): Promise<SubscriptionOutcome> {
    await log.info(`Navigating to ${sourceUrl}`);
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded" });

    // Quantcast Choice CMP — no stable id, match by button text instead. It
    // can render after our first check (same class of timing issue as the
    // cookie banner on suffolkCoast.ts), so this is called again right
    // before the checkbox loop below too. Its container also keeps
    // intercepting clicks for a moment after DISAGREE is clicked (closing
    // animation), so wait for it to actually go away rather than just
    // firing the click and moving on.
    const dismissConsentBanner = async (timeout: number) => {
      const disagree = page.locator("#qc-cmp2-ui button", { hasText: "DISAGREE" });
      if (!(await disagree.first().isVisible({ timeout }).catch(() => false))) {
        return;
      }
      await disagree.first().click();
      const containerGone = await page
        .locator("#qc-cmp2-container")
        .waitFor({ state: "hidden", timeout: 10000 })
        .then(() => true)
        .catch(() => false);
      if (!containerGone) {
        await log.warn("Cookie/consent container did not disappear within 10s after clicking DISAGREE");
      }
      await log.info("Dismissed cookie/consent banner (rejected non-essential processing)");
    };
    await dismissConsentBanner(10000);

    const usernameField = page.locator("#name");
    if ((await usernameField.count()) === 0) {
      await log.warn("Expected sign-up form (#name) not found — page may have changed");
      return { status: "FAILED", message: "Sign-up form not found on page" };
    }

    const username = `${profile.firstName}${profile.lastName}`.replace(/\s+/g, "");
    const password = generatePassword();

    await usernameField.fill(username);
    await page.locator("#emailaddress").fill(profile.email);
    await page.locator("#password").fill(password);
    await page.locator("#passwordcheck").fill(password);
    await log.info(`Filled username (${username}), email, and a generated password`);

    await dismissConsentBanner(3000);

    // The consent banner has shown up re-triggered by the scroll action a
    // checkbox click performs, at points past both checks above — rather
    // than guess the one right moment to look for it, retry each
    // individual checkbox click once against a fresh dismiss attempt.
    let checkedCount = 0;
    for (const value of TARGET_COUNTY_VALUES) {
      const checkbox = page.locator(`input[name="locations"][value="${value}"]`);
      if ((await checkbox.count()) === 0) {
        await log.warn(`County checkbox value=${value} not found — site may have changed its list`);
        continue;
      }
      try {
        await checkbox.check({ timeout: 8000 });
      } catch {
        await dismissConsentBanner(3000);
        await checkbox.check({ timeout: 8000 });
      }
      checkedCount += 1;
    }
    await log.info(`Selected ${checkedCount}/${TARGET_COUNTY_VALUES.length} target county newsletters`);

    const submit = page.getByRole("button", { name: "Sign Up", exact: true });
    if ((await submit.count()) === 0) {
      await log.warn("Sign Up button not found");
      return { status: "FAILED", message: "Submit button not found" };
    }

    if (dryRun) {
      await log.info("Dry run — form filled but not submitted");
      return { status: "SUCCESS", message: "Dry run: would have submitted" };
    }

    try {
      await submit.waitFor({ state: "attached" });
      await page.waitForFunction(
        () => {
          const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Sign Up");
          return btn && !btn.disabled;
        },
        { timeout: 10000 },
      );
    } catch {
      await log.warn("Sign Up button never became enabled — a required field may not validate as expected");
      return { status: "FAILED", message: "Submit button stayed disabled after filling the form" };
    }

    await submit.click();

    const success = page.getByText(/welcome|account created|thanks for signing up|check your email|woohoo|you now have a muddy account/i);
    const error = page.getByText(/already exists|invalid|error|something went wrong|please enter/i);
    try {
      await Promise.race([
        success.first().waitFor({ state: "visible", timeout: 15000 }),
        error.first().waitFor({ state: "visible", timeout: 15000 }),
        page.waitForURL((url) => !url.pathname.includes("sign-up"), { timeout: 15000 }),
      ]);
    } catch {
      await log.warn("Neither a confirmation message nor an error appeared, and the URL didn't change, within 15s");
      return { status: "FAILED", message: "No confirmation or error appeared after submit — outcome unclear" };
    }

    if (!page.url().includes("sign-up") || (await success.first().isVisible().catch(() => false))) {
      await log.info(`Account created (username: ${username}); landed on ${page.url()}`);
      return {
        status: "SUCCESS",
        message: `Account created, landed on ${page.url()}`,
        credentials: { username, password },
      };
    }

    const errorText = (await error.first().innerText().catch(() => "")).trim();
    await log.warn(`Sign-up error: ${errorText}`);
    return { status: "FAILED", message: `Form rejected submission: ${errorText}` };
  },
};
