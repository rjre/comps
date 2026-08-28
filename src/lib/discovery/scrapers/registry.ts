import type { ListingScraper } from "./types";
import { competitionsIeScraper } from "./competitionsIe";
import { allFreeStuffScraper } from "./allFreeStuff";

const scrapers: ListingScraper[] = [competitionsIeScraper, allFreeStuffScraper];

export const scraperRegistry = new Map(scrapers.map((s) => [s.key, s]));

export function getScraper(key: string): ListingScraper | undefined {
  return scraperRegistry.get(key);
}
