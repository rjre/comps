import type { NewsletterAdapter } from "./types";
import { nationalLobsterHatcheryNewsletterAdapter } from "./adapters/nationalLobsterHatchery";
import { muddyStilettosEssexAdapter } from "./adapters/muddyStilettosEssex";

const adapters: NewsletterAdapter[] = [nationalLobsterHatcheryNewsletterAdapter, muddyStilettosEssexAdapter];

export const newsletterAdapterRegistry = new Map(adapters.map((a) => [a.key, a]));

export function getNewsletterAdapter(key: string): NewsletterAdapter | undefined {
  return newsletterAdapterRegistry.get(key);
}
