import type { AdapterContext, CompetitionAdapter, EntryOutcome } from "../types";

/**
 * Best-effort adapter for sites with no hand-written adapter: it looks for
 * common field patterns (name/id/type/label/placeholder/autocomplete) and
 * fills whatever it can confidently match. This is inherently less
 * reliable than a site-specific adapter — that's the accepted tradeoff for
 * covering many unknown sites instead of a hand-maintained list.
 *
 * What it deliberately does NOT do: solve CAPTCHAs, work around login
 * walls, or tick *optional* marketing/data-sharing consent boxes on the
 * user's behalf. Any of those => a clean skip, not a workaround. It does
 * check a checkbox the form marks `required` (age verification, "I
 * accept the rules") — entering at all already implies accepting that
 * competition's own rules, so leaving those unchecked would just block
 * submission rather than protect the user from anything.
 */
export const genericAdapter: CompetitionAdapter = {
  key: "generic",
  siteName: "Generic (heuristic form-fill)",
  async enterCompetition({ page, competitionUrl, profile, log, dryRun }: AdapterContext): Promise<EntryOutcome> {
    await log.info(`Navigating to ${competitionUrl}`);
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
      [combine(FIELD_MATCHERS.addressLine2), profile.addressLine2],
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

    if (profile.country) {
      filledCount += await selectMatchingOption(form, FIELD_MATCHERS.countrySelect, profile.country);
    }

    if (filledCount === 0) {
      return { status: "FAILED", message: "Could not confidently match any form fields" };
    }

    await handleCheckboxes(form);

    const submit = form.locator('button[type="submit"], input[type="submit"]').first();
    if ((await submit.count()) === 0) {
      return { status: "FAILED", message: "Submit control not found" };
    }

    // Honour the shared dry-run contract. This adapter predates it (it was
    // written against an earlier three-argument adapter signature that had
    // no dryRun at all), so without this a dry run would submit real
    // entries on every generic-adapter site — the exact thing dry runs
    // exist to avoid.
    if (dryRun) {
      await log.info(`Dry run — filled ${filledCount} field(s), not submitting`);
      return { status: "SUCCESS", message: `Dry run: would have submitted ${filledCount} filled field(s)` };
    }

    await log.info(`Filled ${filledCount} field(s), submitting`);
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

// selectOption matches by exact value or exact visible label — no fuzzy
// guessing ("United Kingdom" vs "UK" vs "GB" won't cross-match), so this
// only succeeds when the option text is an exact match. Returns 1 if it
// filled something, 0 otherwise — folds into the same filledCount total
// as the text-field loop.
async function selectMatchingOption(
  form: import("playwright").Locator,
  selectors: readonly string[],
  value: string,
): Promise<number> {
  const select = form.locator(selectors.join(", ")).first();
  if ((await select.count()) === 0) return 0;
  try {
    await select.selectOption({ label: value });
    return 1;
  } catch {
    return 0;
  }
}

// Two passes, both conservative:
// - Marketing/data-sharing opt-ins the site defaulted to checked get
//   unchecked, regardless of `required` — auto-entering a competition
//   never implies auto-consenting to marketing.
// - A checkbox the site's own markup marks `required` (age verification,
//   "I accept the rules") gets checked if it isn't marketing — entering
//   at all already implies accepting that competition's rules, and
//   leaving a required box unchecked would just block submission.
// Anything not `required` and not marketing-hinted is left as-is.
async function handleCheckboxes(form: import("playwright").Locator) {
  const checkboxes = form.locator('input[type="checkbox"]');
  const count = await checkboxes.count();
  for (let i = 0; i < count; i++) {
    const box = checkboxes.nth(i);
    const name = ((await box.getAttribute("name")) ?? "").toLowerCase();
    const id = ((await box.getAttribute("id")) ?? "").toLowerCase();
    const isMarketing = MARKETING_HINTS.some((hint) => name.includes(hint) || id.includes(hint));
    const isRequired = (await box.getAttribute("required")) !== null;
    const checked = await box.isChecked().catch(() => false);

    if (isMarketing && checked) {
      await box.uncheck().catch(() => {});
    } else if (isRequired && !isMarketing && !checked) {
      await box.check().catch(() => {});
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
  // Specific "line 2" patterns only — must not overlap addressLine1's
  // broad "address" match, or both would target the same first field.
  addressLine2: [
    'input[name*="address2" i]',
    'input[name*="address_2" i]',
    'input[name*="addressline2" i]',
    'input[autocomplete="address-line2"]',
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
  countrySelect: ['select[name*="country" i]', 'select[autocomplete="country-name"]'],
  dateOfBirth: ['input[type="date"]', 'input[autocomplete="bday"]'],
} as const;
