import type { NewsletterAdapter } from "./types";
import { nationalLobsterHatcheryNewsletterAdapter } from "./adapters/nationalLobsterHatchery";
import { muddyStilettosEssexAdapter } from "./adapters/muddyStilettosEssex";
import { theSuffolkCoastNewsletterAdapter } from "./adapters/theSuffolkCoast";
import { visitEssexNewsletterAdapter } from "./adapters/visitEssex";
import { officialLondonTheatreNewsletterAdapter } from "./adapters/officialLondonTheatre";

const adapters: NewsletterAdapter[] = [
  nationalLobsterHatcheryNewsletterAdapter,
  muddyStilettosEssexAdapter,
  theSuffolkCoastNewsletterAdapter,
  visitEssexNewsletterAdapter,
  officialLondonTheatreNewsletterAdapter,
];

export const newsletterAdapterRegistry = new Map(adapters.map((a) => [a.key, a]));

export function getNewsletterAdapter(key: string): NewsletterAdapter | undefined {
  return newsletterAdapterRegistry.get(key);
}
