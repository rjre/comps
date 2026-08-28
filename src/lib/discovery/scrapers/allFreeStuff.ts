import type { ListingScraper, ListingItem } from "./types";
import { fetchHtml } from "@/lib/net/fetchHtml";

const MAX_PAGES = 3;

function titleFromSlug(slug: string): string {
  // e.g. "competition-free-halloween-hamper" -> "Free halloween hamper"
  return slug
    .replace(/^competition-/, "")
    .split("-")
    .join(" ")
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * allfreestuff.co.uk (a Wix site) has no RSS feed; listing pages use
 * query-string pagination (?page=2, ?page=3, ...).
 */
export const allFreeStuffScraper: ListingScraper = {
  key: "allfreestuff",
  siteName: "AllFreeStuff",

  async fetchItems(listingUrl): Promise<ListingItem[]> {
    const items = new Map<string, ListingItem>();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const pageUrl = page === 1 ? listingUrl : `${listingUrl}${listingUrl.includes("?") ? "&" : "?"}page=${page}`;
      const html = await fetchHtml(pageUrl);
      if (!html) break;

      const linkRegex = /href="(https:\/\/www\.allfreestuff\.co\.uk\/(competition-[a-z0-9-]+))"/gi;
      let match: RegExpExecArray | null;
      let foundOnThisPage = 0;
      while ((match = linkRegex.exec(html))) {
        const link = match[1]!;
        const slug = match[2]!;
        if (slug.endsWith("-terms")) continue; // T&Cs sub-pages, not competitions
        if (items.has(link)) continue;
        items.set(link, { title: titleFromSlug(slug), link });
        foundOnThisPage++;
      }

      if (foundOnThisPage === 0) break;
    }

    return [...items.values()];
  },
};
