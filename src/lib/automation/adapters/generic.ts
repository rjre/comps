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
    const response = await page.goto(competitionUrl, { waitUntil: "domcontentloaded", timeout: 30000 });

    // A blocked or challenged page reads to the rest of this adapter as
    // just an ordinary page with no form on it, which used to come out as
    // the misleading "No form found on page" — indistinguishable in the
    // logs from this adapter actually failing to recognise a real entry
    // form. Diagnosed live: comps.womansownmagazine.co.uk 403s this
    // browser outright; gleam.io-hosted giveaways sit behind a Cloudflare
    // "Just a moment..." interstitial. Neither is a scraper bug to fix, so
    // name it as what it is instead of guessing at the page content.
    const pageTitle = await page.title().catch(() => "");
    if (/^(just a moment|attention required|checking your browser|verifying you are human|access denied)\b/i.test(pageTitle.trim())) {
      return { status: "SKIPPED_RULES", message: `Blocked by an anti-bot challenge page (title: "${pageTitle}")` };
    }
    if (response && !response.ok()) {
      return { status: "FAILED", message: `Blocked — HTTP ${response.status()} ${response.statusText()}` };
    }

    if (await hasAny(page, 'input[type="password"]')) {
      return { status: "SKIPPED_RULES", message: "Entry requires an account/login" };
    }
    if (
      await hasAny(
        page,
        'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], iframe[src*="challenges.cloudflare.com"]',
      )
    ) {
      return { status: "SKIPPED_RULES", message: "CAPTCHA present" };
    }

    await dismissCookieBanner(page, log, 6000);

    const chosen = await chooseEntryForm(page);
    if (!chosen.form) {
      return { status: "FAILED", message: chosen.reason };
    }
    const form = chosen.form;
    await log.info(`Using form: ${chosen.reason}`);

    // `labelPattern`s are a fallback only, for the plugin-generated forms
    // (WPForms, Gravity Forms) whose fields carry no useful name/id/
    // autocomplete at all — a bare numeric `wpforms[fields][7]` — and are
    // only ever findable by the visible `<label>` text next to them.
    // Confirmed live (vantagepointmag.co.uk, a WPForms competition entry):
    // its Phone and Postcode fields have no textual attribute hint
    // whatsoever, so without this fallback the form's own required-field
    // check declined an otherwise-fillable entry.
    const fieldMap: Array<[string, string | undefined | null, boolean?, RegExp?]> = [
      [combine(FIELD_MATCHERS.email), profile.email, true],
      [combine(FIELD_MATCHERS.firstName), profile.firstName],
      [combine(FIELD_MATCHERS.lastName), profile.lastName],
      [combine(FIELD_MATCHERS.fullName), `${profile.firstName} ${profile.lastName}`],
      [combine(FIELD_MATCHERS.phone), profile.phone, false, /^(phone|telephone|mobile)(\s*number)?\s*\*?$/i],
      [combine(FIELD_MATCHERS.addressLine1), profile.addressLine1],
      [combine(FIELD_MATCHERS.addressLine2), profile.addressLine2],
      [combine(FIELD_MATCHERS.city), profile.city],
      [combine(FIELD_MATCHERS.region), profile.region],
      [combine(FIELD_MATCHERS.postalCode), profile.postalCode, false, /^post\s*code\s*\*?$|^postal\s*code\s*\*?$|^zip(\s*code)?\s*\*?$/i],
      [combine(FIELD_MATCHERS.country), profile.country],
      // Only input[type=date]/autocomplete=bday — both expect an
      // unambiguous YYYY-MM-DD value per the HTML spec. A freeform text
      // "date of birth" field's expected format can't be known reliably
      // (DD/MM/YYYY vs MM/DD/YYYY etc.), so those are left unfilled rather
      // than risking a wrong date going in.
      [combine(FIELD_MATCHERS.dateOfBirth), profile.dateOfBirth?.toISOString().slice(0, 10)],
    ];

    let filledCount = 0;
    let filledEmailOnly = true;
    for (const [selector, value, isEmail, labelPattern] of fieldMap) {
      if (!value) continue;
      let field = form.locator(selector).first();
      if ((await field.count()) === 0 && labelPattern) {
        field = form.getByLabel(labelPattern).first();
      }
      if ((await field.count()) === 0) continue;
      try {
        await field.fill(String(value));
        filledCount++;
        if (!isEmail) filledEmailOnly = false;
      } catch {
        // Not a fillable text input (e.g. a <select>) — skip rather than guess.
      }
    }

    if (profile.country) {
      const selected = await selectMatchingOption(form, FIELD_MATCHERS.countrySelect, profile.country);
      filledCount += selected;
      if (selected > 0) filledEmailOnly = false;
    }

    if (filledCount === 0) {
      return { status: "FAILED", message: "Could not confidently match any form fields" };
    }

    // An email address on its own is what a newsletter signup asks for. A
    // competition entry essentially always wants a name too, so refuse to
    // submit on an email alone rather than opting the user into a mailing
    // list they never asked for (README: "No auto-consent").
    if (filledCount === 1 && filledEmailOnly) {
      return {
        status: "SKIPPED_RULES",
        message: "Only an email field matched — that's a newsletter signup shape, not a competition entry",
      };
    }

    await handleCheckboxes(form);
    const declined = await declineMarketingRadios(form);
    if (declined > 0) await log.info(`Declined ${declined} marketing opt-in radio group(s)`);

    // Anything the form itself marks required and we could not fill means
    // we don't actually understand this form. Submitting anyway is how a
    // WordPress comment box (required, unfillable, and nothing to do with
    // a competition) got name+email posted to it — confirmed live, on
    // stressedmum.co.uk, before this check existed.
    const unfilled = await unfilledRequiredFields(form);
    if (unfilled.length > 0) {
      return {
        status: "SKIPPED_RULES",
        message: `Form has required field(s) this adapter can't fill honestly: ${unfilled.slice(0, 5).join(", ")}`,
      };
    }

    const submit = form.locator('button[type="submit"], input[type="submit"]').first();
    if ((await submit.count()) === 0) {
      return { status: "FAILED", message: "Submit control not found" };
    }

    // A disabled submit means the form's own validation isn't satisfied —
    // it stays disabled until its required inputs are answered. Clicking
    // it does nothing at all, which is exactly how this adapter came to
    // report a successful entry on Secret Escapes' competition form while
    // submitting nothing (confirmed live).
    if (await submit.isDisabled().catch(() => false)) {
      return {
        status: "SKIPPED_RULES",
        message: "The form's submit control is still disabled — it wants answers this adapter can't supply",
      };
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
    const urlBefore = page.url();
    const formsBefore = await page.locator("form").count().catch(() => 0);
    try {
      await submit.click({ timeout: 10000 });
    } catch (clickErr) {
      // A cookie/consent overlay that renders (or re-renders) after the
      // initial dismiss attempt sits on top of the submit control and
      // swallows the click — confirmed live (a Usercentrics-style #uniccmp
      // panel intercepting pointer events on an otherwise-correct submit
      // locator). Same fix this project already uses per-site: remove the
      // known culprits and retry the click once, rather than failing an
      // entry the adapter actually filled out correctly.
      await log.warn(
        `Submit click was blocked (${clickErr instanceof Error ? clickErr.message.split("\n")[0] : String(clickErr)}) — removing known overlay elements and retrying`,
      );
      await page
        .evaluate(() => {
          const selectors = [
            "#onetrust-consent-sdk",
            "#CybotCookiebotDialog",
            "#cookiescript_injected_wrapper",
            "#uniccmp",
            "[id*='sp_message_container']",
            ".cky-consent-container",
          ];
          for (const s of selectors) document.querySelector(s)?.remove();
        })
        .catch(() => {});
      await submit.click({ timeout: 10000 });
    }
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});

    // Don't claim an entry without evidence of one. "Clicked submit" is
    // not evidence: a disabled control, a validation error, or a JS form
    // that silently refuses all look identical from here, and reporting
    // SUCCESS marks the competition ENTERED so it's never retried. Any of
    // a navigation, the form going away, or a confirmation message counts.
    const navigated = page.url() !== urlBefore;
    const formGone = (await page.locator("form").count().catch(() => formsBefore)) < formsBefore;
    const confirmed = await page
      .getByText(/thank you|thanks for entering|you(?:'ve| have) been entered|entry received|good luck|successfully entered/i)
      .first()
      .isVisible()
      .catch(() => false);

    if (!navigated && !formGone && !confirmed) {
      await log.warn("Submitted, but the page showed no sign of having accepted it");
      return {
        status: "FAILED",
        message: `Filled ${filledCount} field(s) and submitted, but saw no confirmation, navigation or form change — entry not confirmed`,
      };
    }

    const evidence = confirmed ? "confirmation message" : navigated ? "navigation" : "form removed";
    return { status: "SUCCESS", message: `Filled ${filledCount} field(s); accepted (${evidence})` };
  },
};

/**
 * Forms that are definitively not a competition entry, matched on the
 * form's own action/id/class/name.
 *
 * This is the guard that was missing: the adapter took `form:first`, and
 * on a blog-hosted competition that is almost always the WordPress comment
 * form — which it then filled with the user's real name and email and
 * submitted to wp-comments-post.php. Confirmed live on stressedmum.co.uk.
 * A comment box is not a form we should ever post to.
 */
const FORM_VETO = [
  { pattern: /wp-comments-post|commentform|comment-form|comment_form|#respond/i, why: "comment form" },
  { pattern: /searchform|search-form|role=["']?search/i, why: "search form" },
  { pattern: /login|signin|sign-in|register|signup|sign-up|account|password|auth/i, why: "login/registration form" },
  { pattern: /newsletter|subscribe|mailchimp|mc4wp|mailerlite|klaviyo|email-signup/i, why: "newsletter signup form" },
  { pattern: /contact-form|contactform|enquiry|feedback|review/i, why: "contact/feedback form" },
];

/** Signals that a form really is a competition entry. */
const FORM_HINT = /competition|giveaway|sweepstake|enter|entry|prize|draw|raffle|contest/i;

/**
 * Why a form should never be posted to, or null if it's a candidate.
 * Split out from the DOM walk so the judgement itself is unit-testable —
 * the surrounding Playwright code isn't.
 */
export function vetoReasonFor(descriptor: string): string | null {
  return FORM_VETO.find((v) => v.pattern.test(descriptor))?.why ?? null;
}

/** Does the form's own markup say it's a competition entry? */
export function formAdvertisesEntry(descriptor: string): boolean {
  return FORM_HINT.test(descriptor);
}

/**
 * Picks the form most likely to be a competition entry, rather than
 * whichever happens to be first in the document.
 *
 * Vetoes are absolute; among what's left, a form advertising itself as an
 * entry wins, then the one with the most fillable identity inputs. A page
 * with nothing but vetoed forms is a clean failure, not a fallback to one
 * of them.
 *
 * Checks every frame on the page, not just the top-level document — a
 * real entry form is often embedded via `<iframe>` rather than linked to
 * (a widget platform not in resolveEntryUrl.ts's known-host list, or a
 * custom in-house widget), and until this the top-level document having
 * no form, or only a vetoed one, was indistinguishable from a genuine
 * "no entry form on this page" — this was a real share of both "No form
 * found on page" and "Only non-entry form(s)" failures. A form's own
 * frame is irrelevant to every later step (fill/evaluate/click all work
 * the same on a Locator scoped to a child frame as to the main one), so
 * nothing past this function needs to change.
 */
async function chooseEntryForm(
  page: import("playwright").Page,
): Promise<{ form: import("playwright").Locator | null; reason: string }> {
  const containers: Array<import("playwright").Page | import("playwright").Frame> = [
    page,
    ...page.frames().filter((f) => f !== page.mainFrame()),
  ];

  const vetoed: string[] = [];
  let best: { locator: import("playwright").Locator; score: number; why: string } | null = null;
  let anyForm = false;

  for (const container of containers) {
    const forms = container.locator("form");
    const count = await forms.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      anyForm = true;
      const form = forms.nth(i);
      const descriptor = (
        await form.evaluate((el) => {
          const f = el as HTMLFormElement;
          return [f.getAttribute("action"), f.id, f.className, f.getAttribute("name"), f.getAttribute("role")]
            .filter(Boolean)
            .join(" ");
        }).catch(() => "")
      ) as string;

      const veto = vetoReasonFor(descriptor);
      if (veto) {
        // "login/registration form" is matched on words like register/signup
        // in the action/id/class alone, and that false-positives on sites
        // that call their entry form a "registration" without it requiring an
        // account: fpd.ie's competition entry POSTs to /register, id
        // "RegisterForm", and asks for name/address/DOB/phone — a normal
        // entry form, no password field anywhere (confirmed live). Only
        // honour this veto when the form actually asks for a password.
        if (veto === "login/registration form") {
          const hasPassword = await form
            .locator('input[type="password"]')
            .count()
            .catch(() => 0);
          if (hasPassword === 0) {
            // Fall through to normal scoring below — not vetoed after all.
          } else {
            vetoed.push(veto);
            continue;
          }
        } else {
          vetoed.push(veto);
          continue;
        }
      }

      // Text-ish inputs, as a proxy for "asks who you are".
      const inputs = await form
        .locator('input[type="text"], input[type="email"], input[type="tel"], input:not([type]), select')
        .count()
        .catch(() => 0);
      const advertisesEntry = formAdvertisesEntry(descriptor) ? 10 : 0;
      const score = advertisesEntry + inputs;
      if (!best || score > best.score) {
        best = {
          locator: form,
          score,
          why: advertisesEntry ? `form ${i} names itself as an entry form (${inputs} field(s))` : `form ${i} (${inputs} field(s))`,
        };
      }
    }
  }

  if (!anyForm) return { form: null, reason: "No form found on page" };
  if (!best) {
    return { form: null, reason: `Only non-entry form(s) on the page (${[...new Set(vetoed)].join(", ")})` };
  }
  return { form: best.locator, reason: best.why };
}

/**
 * Required controls in the form that are still empty. Used as a
 * completeness check before submitting: if the form insists on something
 * this adapter has no honest value for (a comment, an answer to a
 * question, a file), then we don't understand the form well enough to be
 * submitting it.
 */
async function unfilledRequiredFields(form: import("playwright").Locator): Promise<string[]> {
  return (await form
    .evaluate((el) => {
      const scope = el as HTMLFormElement;
      const names: string[] = [];
      // `data-required` / `aria-required` as well as the real attribute:
      // JS-validated forms (Secret Escapes' competition form, confirmed
      // live) mark their fields with a custom attribute and keep the
      // submit button disabled until they're answered, so looking only at
      // [required] sees a form with no requirements at all.
      const controls = scope.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
        "input[required], textarea[required], select[required], " +
          "input[data-required], textarea[data-required], select[data-required], " +
          'input[aria-required="true"], textarea[aria-required="true"], select[aria-required="true"]',
      );
      const radioGroupsSeen = new Set<string>();
      for (const control of Array.from(controls)) {
        // Honeypots: required but deliberately hidden, and meant to stay
        // empty. Filling or refusing on them would both be wrong.
        const style = window.getComputedStyle(control);
        const hidden =
          control.getAttribute("type") === "hidden" ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          control.getAttribute("aria-hidden") === "true";
        if (hidden) continue;
        if (control instanceof HTMLInputElement && control.type === "radio") {
          // A required radio group is unanswered only if nothing in the
          // whole group is checked — checking each radio individually
          // would report every unselected option as missing.
          const group = control.name || control.id;
          if (radioGroupsSeen.has(group)) continue;
          radioGroupsSeen.add(group);
          const anyChecked = Array.from(
            scope.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(control.name)}"]`),
          ).some((r) => r.checked);
          if (!anyChecked) names.push(group);
          continue;
        }
        if (control instanceof HTMLInputElement && control.type === "checkbox") {
          if (!control.checked) names.push(control.getAttribute("name") || control.id || "checkbox");
          continue;
        }
        if (!control.value || control.value.trim() === "") {
          names.push(control.getAttribute("name") || control.id || control.tagName.toLowerCase());
        }
      }
      return names;
    })
    .catch(() => [] as string[])) as string[];
}

async function hasAny(page: import("playwright").Page, selector: string): Promise<boolean> {
  return (await page.locator(selector).count()) > 0;
}

/**
 * Best-effort dismissal of whichever cookie/consent CMP a page happens to
 * use. Every site-specific adapter in this project hand-codes its own
 * version of this (OneTrust, Cookiebot, CookieScript, CookieYes,
 * Usercentrics/uniccmp, Sourcepoint...) because there's no single selector
 * that works everywhere — this is the same idea generalised for sites with
 * no dedicated adapter. Declines non-essential cookies where a one-click
 * reject option exists; falls back to accepting only when it doesn't,
 * consistent with this project's "prefer reject, but don't get stuck"
 * pattern (see e.g. ambassadorCruiseLineEnglandGolf.ts, cruiseMummy.ts).
 * Silent no-op if nothing matches — most sites have no banner at all.
 */
async function dismissCookieBanner(
  page: import("playwright").Page,
  log: AdapterContext["log"],
  timeout: number,
): Promise<void> {
  const declineSelectors = [
    "#onetrust-reject-all-handler",
    "#CybotCookiebotDialogBodyButtonDecline",
    "#cookiescript_reject",
    ".cky-btn-reject",
  ];
  for (const selector of declineSelectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout }).catch(() => false)) {
      await el.click().catch(() => {});
      await log.info(`Dismissed cookie banner (${selector})`);
      return;
    }
  }

  const declineByText = page
    .getByRole("button", { name: /^(reject all|decline all|decline|i do not accept|do not accept|necessary only|only necessary)$/i })
    .first();
  if (await declineByText.isVisible({ timeout: Math.min(timeout, 3000) }).catch(() => false)) {
    await declineByText.click().catch(() => {});
    await log.info("Dismissed cookie banner (declined, matched by button text)");
    return;
  }

  const acceptSelectors = ["#onetrust-accept-btn-handler"];
  for (const selector of acceptSelectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      await el.click().catch(() => {});
      await log.info(`Dismissed cookie banner (accepted, no reject option offered at ${selector})`);
      return;
    }
  }

  const acceptByText = page
    .getByRole("button", { name: /^(accept all|accept all cookies|allow all|i accept|agree)$/i })
    .first();
  if (await acceptByText.isVisible({ timeout: 1500 }).catch(() => false)) {
    await acceptByText.click().catch(() => {});
    await log.info("Dismissed cookie banner (accepted, matched by button text — no reject option offered)");
  }
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
/**
 * Marketing consent offered as a radio pair (yes/no) rather than a
 * checkbox — Secret Escapes' `fi-text-optIn` is one, confirmed live.
 * These are answered "no", the same as an unticked marketing checkbox and
 * the same as the DMRI adapter does: declining marketing is this
 * project's standing policy, so it's an answer we can give on the user's
 * behalf without guessing.
 *
 * Note what this deliberately does NOT do: answer required radios that
 * assert a *fact* about the user (age, residency, eligibility). Those get
 * left alone, so the form fails the completeness check and the entry is
 * declined rather than a false declaration being made.
 */
async function declineMarketingRadios(form: import("playwright").Locator): Promise<number> {
  return (await form
    .evaluate((el, hints: string[]) => {
      const scope = el as HTMLFormElement;
      const radios = Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
      const groups = new Map<string, HTMLInputElement[]>();
      for (const radio of radios) {
        const key = radio.name || radio.id;
        groups.set(key, [...(groups.get(key) ?? []), radio]);
      }
      let answered = 0;
      for (const [name, group] of groups) {
        const identity = `${name} ${group.map((r) => r.id).join(" ")}`.toLowerCase();
        if (!hints.some((hint) => identity.includes(hint))) continue;
        if (group.some((r) => r.checked)) continue;
        const no = group.find((r) => {
          const label = scope.querySelector(`label[for="${r.id}"]`)?.textContent?.trim().toLowerCase() ?? "";
          return r.value.toLowerCase() === "no" || r.value === "0" || r.value.toLowerCase() === "false" || /^no\b/.test(label);
        });
        if (no) {
          no.checked = true;
          no.dispatchEvent(new Event("change", { bubbles: true }));
          answered++;
        }
      }
      return answered;
    }, MARKETING_HINTS as unknown as string[])
    .catch(() => 0)) as number;
}

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
    // Gravity Forms' standard "Name" field renders its First/Last
    // sub-inputs with bare placeholders — "First", not "First Name" — and
    // a numeric name/id (input_X.3) that gives no textual hint at all.
    // Confirmed live (tranquilparks.co.uk): without this, only the
    // form's email field matched, so a genuine competition entry read as
    // a bare newsletter signup and was wrongly declined. Exact-match only
    // so this can't shadow an unrelated field like "First line of address".
    'input[placeholder="First" i]',
  ],
  lastName: [
    'input[name*="last" i]',
    'input[name*="surname" i]',
    'input[id*="last" i]',
    'input[autocomplete="family-name"]',
    'input[placeholder*="last name" i]',
    'input[placeholder*="surname" i]',
    // See firstName above — Gravity Forms' bare "Last" placeholder.
    'input[placeholder="Last" i]',
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
