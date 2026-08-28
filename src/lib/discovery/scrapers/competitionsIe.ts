import type { ListingScraper, ListingItem } from "./types";
import { fetchHtml } from "@/lib/net/fetchHtml";

const MAX_PAGES = 3;

function titleFromSlug(slug: string): string {
  // e.g. "win-a-100-tesco-voucher-1787576282214" -> "Win a 100 Tesco voucher"
  return slug
    .replace(/-\d{6,}$/, "")
    .split("-")
    .join(" ")
    .replace(/^./, (c) => c.toUpperCase());
}

/**
 * competitions.ie has no RSS feed; its listing pages are static HTML with
 * path-based pagination (/new-competitions, /new-competitions/2, ...).
 */
export const competitionsIeScraper: ListingScraper = {
  key: "competitions-ie",
  siteName: "Competitions.ie",

  async fetchItems(listingUrl): Promise<ListingItem[]> {
    const base = listingUrl.replace(/\/$/, "");
    const items = new Map<string, ListingItem>();

    for (let page = 1; page <= MAX_PAGES; page++) {
      const pageUrl = page === 1 ? listingUrl : `${base}/${page}`;
      const html = await fetchHtml(pageUrl);
      if (!html) break;

      const linkRegex = /href="(\/competition\/([a-z0-9-]+))"/gi;
      let match: RegExpExecArray | null;
      let foundOnThisPage = 0;
      while ((match = linkRegex.exec(html))) {
        const path = match[1]!;
        const slug = match[2]!;
        if (items.has(path)) continue;
        items.set(path, { title: titleFromSlug(slug), link: new URL(path, pageUrl).toString() });
        foundOnThisPage++;
      }

      if (foundOnThisPage === 0) break; // no more pages
    }

    return [...items.values()];
  },
};
