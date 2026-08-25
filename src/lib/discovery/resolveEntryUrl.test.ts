import { describe, it, expect, vi, beforeEach } from "vitest";

// Bypass rate-limiting/robots for tests — those are exercised by the real
// network calls this app makes in normal operation, not by this suite.
vi.mock("@/lib/net/politeness", () => ({
  isAllowedByRobots: vi.fn(async () => true),
  politeDelay: vi.fn(async () => {}),
}));

const { resolveEntryUrl } = await import("./resolveEntryUrl");

/**
 * Every case here is a real bug found and fixed while building discovery
 * against live sites (Aug 2026) — see the git history for
 * src/lib/discovery/resolveEntryUrl.ts. Each one broke resolution for a
 * real, currently-seeded feed source; codified here so none of them can
 * silently regress.
 */

type FetchResponse = { ok: boolean; url: string; text: () => Promise<string> };

function htmlResponse(url: string, html: string, finalUrl = url): FetchResponse {
  return { ok: true, url: finalUrl, text: async () => html };
}

function mockFetchRouter(routes: Record<string, FetchResponse>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = input.toString();
    const route = routes[url];
    if (!route) throw new Error(`Unmocked fetch: ${url}`);
    return route as unknown as Response;
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("resolveEntryUrl", () => {
  it("follows a same-host tracking redirector found by hint text (ThePrizeFinder pattern)", async () => {
    const listingUrl = "https://www.theprizefinder.com/competitions/example";
    const trackingUrl = "https://www.theprizefinder.com/link-track?id=1";
    const sponsorUrl = "https://sponsor.example.com/win";

    global.fetch = mockFetchRouter({
      [listingUrl]: htmlResponse(
        listingUrl,
        `<a class="btn" href="${trackingUrl}" rel="nofollow" target="_blank">View Competition</a>`,
      ),
      [trackingUrl]: htmlResponse(trackingUrl, "", sponsorUrl),
    });

    await expect(resolveEntryUrl(listingUrl)).resolves.toBe(sponsorUrl);
  });

  it("picks the single plain off-site link when no hint text/path matches (AllFreeStuff pattern)", async () => {
    const listingUrl = "https://www.allfreestuff.co.uk/competition-example";
    const sponsorUrl = "https://www.heavenlyboxes.co.uk/products/example";

    global.fetch = mockFetchRouter({
      [listingUrl]: htmlResponse(
        listingUrl,
        `<a href="${sponsorUrl}" target="_blank" rel="noreferrer noopener">Example Hamper</a>`,
      ),
      [sponsorUrl]: htmlResponse(sponsorUrl, ""),
    });

    await expect(resolveEntryUrl(listingUrl)).resolves.toBe(sponsorUrl);
  });

  it("follows a same-host /go-<slug>/ redirector with unhinted anchor text (freesamples.co.uk pattern)", async () => {
    const listingUrl = "https://www.freesamples.co.uk/free-example-giveaway/";
    const trackingUrl = "https://www.freesamples.co.uk/go-example-giveaway/";
    const sponsorUrl = "https://sponsor.example.com/";

    global.fetch = mockFetchRouter({
      [listingUrl]: htmlResponse(
        listingUrl,
        `<a href="${trackingUrl}" target="_blank" class="get singlebtn">Get Freebie</a>`,
      ),
      [trackingUrl]: htmlResponse(trackingUrl, "", sponsorUrl),
    });

    await expect(resolveEntryUrl(listingUrl)).resolves.toBe(sponsorUrl);
  });

  it("extracts a URL embedded in JS-framework hydration props (competitions.ie/Astro pattern)", async () => {
    const listingUrl = "https://competitions.ie/competition/example";
    const sponsorUrl = "https://sponsor.example.ie/win";

    global.fetch = mockFetchRouter({
      [listingUrl]: htmlResponse(
        listingUrl,
        `<astro-island props="{&quot;competitionUrl&quot;:[0,&quot;${sponsorUrl}&quot;]}"></astro-island>`,
      ),
      [sponsorUrl]: htmlResponse(sponsorUrl, ""),
    });

    await expect(resolveEntryUrl(listingUrl)).resolves.toBe(sponsorUrl);
  });

  it("treats www and apex domain as the same site (Contest Canada regression)", async () => {
    const listingUrl = "https://www.contestcanada.net/2026/example/";
    const sponsorUrl = "https://nbacontest.com/jerseys";

    global.fetch = mockFetchRouter({
      [listingUrl]: htmlResponse(
        listingUrl,
        `
        <a href="https://contestcanada.net/">logo</a>
        <a href="${sponsorUrl}" target="_blank" rel="nofollow">https://nbacontest.com/jerseys</a>
        `,
      ),
      [sponsorUrl]: htmlResponse(sponsorUrl, ""),
    });

    await expect(resolveEntryUrl(listingUrl)).resolves.toBe(sponsorUrl);
  });

  it("does not treat a mailto: link as a second off-site candidate", async () => {
    const listingUrl = "https://example.com/comp";
    const sponsorUrl = "https://sponsor.example.org/enter";

    global.fetch = mockFetchRouter({
      [listingUrl]: htmlResponse(
        listingUrl,
        `
        <a href="mailto:hello@example.com">Contact us</a>
        <a href="${sponsorUrl}">Example Prize</a>
        `,
      ),
      [sponsorUrl]: htmlResponse(sponsorUrl, ""),
    });

    await expect(resolveEntryUrl(listingUrl)).resolves.toBe(sponsorUrl);
  });

  it("returns null when multiple distinct off-site links are equally plausible", async () => {
    const listingUrl = "https://example.com/comp";

    global.fetch = mockFetchRouter({
      [listingUrl]: htmlResponse(
        listingUrl,
        `
        <a href="https://sponsor-a.example.com/enter">Sponsor A</a>
        <a href="https://sponsor-b.example.com/enter">Sponsor B</a>
        `,
      ),
    });

    await expect(resolveEntryUrl(listingUrl)).resolves.toBeNull();
  });

  it("excludes social/infrastructure domains from the single-candidate fallback", async () => {
    const listingUrl = "https://example.com/comp";

    global.fetch = mockFetchRouter({
      [listingUrl]: htmlResponse(
        listingUrl,
        `
        <a href="https://www.facebook.com/example">Follow us</a>
        <a href="https://landingmail.com/subscribe/abc">Email Updates</a>
        <a href="https://play.google.com/store/apps/details?id=com.example">Get the app</a>
        `,
      ),
    });

    await expect(resolveEntryUrl(listingUrl)).resolves.toBeNull();
  });
});
