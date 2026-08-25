import type { CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Best-effort adapter for sites with no hand-written adapter: it looks for
 * common field patterns (name/id/type/label/placeholder/autocomplete) and
 * fills whatever it can confidently match. This is inherently less
 * reliable than a site-specific adapter — that's the accepted tradeoff for
 * covering many unknown sites instead of a hand-maintained list.
 *
 * What it deliberately does NOT do: solve CAPTCHAs, work around login
 * walls, or tick marketing/data-sharing consent boxes on the user's
 * behalf. Any of those => a clean skip, not a workaround.
 */
export const genericAdapter: CompetitionAdapter = {
  key: "generic",
  siteName: "Generic (heuristic form-fill)",
  async enterCompetition(page, competitionUrl, profile): Promise<EntryOutcome> {
    await page.goto(competitionUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    if (await hasAny(page, 'input[type="password"]')) {
      return { status: "SKIPPED_RULES", message: "Entry requires an account/login" };
    }
    if (await hasAny(page, 'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"]')) {
      return { status: "SKIPPED_RULES", message: "CAPTCHA present" };
    }

    const form = page.locator("form").first();
    if ((await form.count()) === 0) {
      return { status: "FAILED", message: "No form found on page" };
    }

    const fieldMap: Array<[string, string | undefined | null]> = [
      [combine(FIELD_MATCHERS.email), profile.email],
      [combine(FIELD_MATCHERS.firstName), profile.firstName],
      [combine(FIELD_MATCHERS.lastName), profile.lastName],
      [combine(FIELD_MATCHERS.fullName), `${profile.firstName} ${profile.lastName}`],
      [combine(FIELD_MATCHERS.phone), profile.phone],
      [combine(FIELD_MATCHERS.addressLine1), profile.addressLine1],
      [combine(FIELD_MATCHERS.city), profile.city],
      [combine(FIELD_MATCHERS.region), profile.region],
      [combine(FIELD_MATCHERS.postalCode), profile.postalCode],
      [combine(FIELD_MATCHERS.country), profile.country],
      // Only input[type=date]/autocomplete=bday — both expect an
      // unambiguous YYYY-MM-DD value per the HTML spec. A freeform text
      // "date of birth" field's expected format can't be known reliably
      // (DD/MM/YYYY vs MM/DD/YYYY etc.), so those are left unfilled rather
      // than risking a wrong date going in.
      [combine(FIELD_MATCHERS.dateOfBirth), profile.dateOfBirth?.toISOString().slice(0, 10)],
    ];

    let filledCount = 0;
    for (const [selector, value] of fieldMap) {
      if (!value) continue;
      const field = form.locator(selector).first();
      if ((await field.count()) === 0) continue;
      try {
        await field.fill(String(value));
        filledCount++;
      } catch {
        // Not a fillable text input (e.g. a <select>) — skip rather than guess.
      }
    }

    if (filledCount === 0) {
      return { status: "FAILED", message: "Could not confidently match any form fields" };
    }

    await declineOptionalConsentCheckboxes(form);

    const submit = form.locator('button[type="submit"], input[type="submit"]').first();
    if ((await submit.count()) === 0) {
      return { status: "FAILED", message: "Submit control not found" };
    }

    await submit.click();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    return { status: "SUCCESS", message: `Filled ${filledCount} field(s)` };
  },
};

async function hasAny(page: import("playwright").Page, selector: string): Promise<boolean> {
  return (await page.locator(selector).count()) > 0;
}

function combine(selectors: readonly string[]): string {
  return selectors.join(", ");
}

// Required consent (e.g. "I agree to the rules") is left to the site's
// default; only checkboxes clearly labelled as optional marketing/sharing
// opt-ins are actively left unchecked when the site defaults them to on.
async function declineOptionalConsentCheckboxes(form: import("playwright").Locator) {
  const checkboxes = form.locator('input[type="checkbox"]');
  const count = await checkboxes.count();
  for (let i = 0; i < count; i++) {
    const box = checkboxes.nth(i);
    const name = ((await box.getAttribute("name")) ?? "").toLowerCase();
    const id = ((await box.getAttribute("id")) ?? "").toLowerCase();
    const isMarketing = MARKETING_HINTS.some((hint) => name.includes(hint) || id.includes(hint));
    if (isMarketing && (await box.isChecked().catch(() => false))) {
      await box.uncheck().catch(() => {});
    }
  }
}

const MARKETING_HINTS = ["marketing", "newsletter", "subscribe", "optin", "opt-in", "thirdparty", "partner"];

const FIELD_MATCHERS = {
  email: ['input[type="email"]', 'input[name*="email" i]', 'input[id*="email" i]'],
  firstName: [
    'input[name*="first" i]',
    'input[id*="first" i]',
    'input[autocomplete="given-name"]',
    'input[placeholder*="first name" i]',
  ],
  lastName: [
    'input[name*="last" i]',
    'input[name*="surname" i]',
    'input[id*="last" i]',
    'input[autocomplete="family-name"]',
    'input[placeholder*="last name" i]',
    'input[placeholder*="surname" i]',
  ],
  fullName: ['input[name="name" i]', 'input[autocomplete="name"]', 'input[placeholder*="full name" i]'],
  phone: ['input[type="tel"]', 'input[name*="phone" i]', 'input[autocomplete="tel"]'],
  addressLine1: [
    'input[name*="address" i]',
    'input[autocomplete="address-line1"]',
    'input[placeholder*="address" i]',
  ],
  city: ['input[name*="city" i]', 'input[name*="town" i]', 'input[autocomplete="address-level2"]'],
  region: ['input[name*="county" i]', 'input[name*="state" i]', 'input[autocomplete="address-level1"]'],
  postalCode: [
    'input[name*="postcode" i]',
    'input[name*="postal" i]',
    'input[name*="zip" i]',
    'input[autocomplete="postal-code"]',
  ],
  country: ['input[name*="country" i]', 'input[autocomplete="country-name"]'],
  dateOfBirth: ['input[type="date"]', 'input[autocomplete="bday"]'],
} as const;
