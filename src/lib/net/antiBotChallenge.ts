/**
 * Recognises the interstitial challenge page an anti-bot service (Cloudflare
 * chief among them) serves in place of real page content — by its `<title>`,
 * the one thing consistent across sites and reachable without knowing that
 * service's specific markup. Distinct from a CAPTCHA embedded *within* a
 * real page (see the `KNOWN_WIDGET_HOSTS`/iframe checks elsewhere): this is
 * the whole page being replaced, before the site's own content ever loads.
 *
 * Was duplicated inline, with two different (one narrower) copies of this
 * same regex, across four adapters (generic.ts, gleam.ts,
 * coastMagazineSuffolkCoast.ts, officialLondonTheatreHeathers.ts) before
 * being pulled out here — this is the fuller, five-pattern version all four
 * now share.
 */
export function isAntiBotChallengeTitle(title: string): boolean {
  return /^(just a moment|attention required|checking your browser|verifying you are human|access denied)\b/i.test(
    title.trim(),
  );
}
