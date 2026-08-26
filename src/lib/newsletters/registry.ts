import type { NewsletterAdapter } from "./types";
import { nationalLobsterHatcheryNewsletterAdapter } from "./adapters/nationalLobsterHatchery";
import { muddyStilettosEssexAdapter } from "./adapters/muddyStilettosEssex";
import { theSuffolkCoastNewsletterAdapter } from "./adapters/theSuffolkCoast";
import { visitEssexNewsletterAdapter } from "./adapters/visitEssex";
import { visitNorthNorfolkNewsletterAdapter } from "./adapters/visitNorthNorfolk";
import { coastMagazineNewsletterAdapter } from "./adapters/coastMagazine";
import { officialLondonTheatreNewsletterAdapter } from "./adapters/officialLondonTheatre";
import { devonsTopAttractionsNewsletterAdapter } from "./adapters/devonsTopAttractions";
import { virginAtlanticHolidaysNewsletterAdapter } from "./adapters/virginAtlanticHolidays";
import { emiratesNewsletterAdapter } from "./adapters/emirates";

const adapters: NewsletterAdapter[] = [
  nationalLobsterHatcheryNewsletterAdapter,
  muddyStilettosEssexAdapter,
  theSuffolkCoastNewsletterAdapter,
  visitEssexNewsletterAdapter,
  visitNorthNorfolkNewsletterAdapter,
  coastMagazineNewsletterAdapter,
  officialLondonTheatreNewsletterAdapter,
  devonsTopAttractionsNewsletterAdapter,
  virginAtlanticHolidaysNewsletterAdapter,
  emiratesNewsletterAdapter,
];

export const newsletterAdapterRegistry = new Map(adapters.map((a) => [a.key, a]));

export function getNewsletterAdapter(key: string): NewsletterAdapter | undefined {
  return newsletterAdapterRegistry.get(key);
}
