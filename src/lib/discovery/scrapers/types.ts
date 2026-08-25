export interface ListingItem {
  title: string;
  link: string;
}

/**
 * One scraper per aggregator site that has no RSS feed. Each returns
 * listing-page items in the same shape an RSS item would be — downstream
 * resolution (src/lib/discovery/resolveEntryUrl.ts) and Competition
 * creation are identical regardless of source kind.
 */
export interface ListingScraper {
  key: string;
  siteName: string;
  fetchItems(listingUrl: string): Promise<ListingItem[]>;
}
