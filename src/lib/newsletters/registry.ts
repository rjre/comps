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
import { jet2holidaysNewsletterAdapter } from "./adapters/jet2holidays";
import { colchesterZooNewsletterAdapter } from "./adapters/colchesterZoo";
import { adventureIslandNewsletterAdapter } from "./adapters/adventureIsland";
import { visitLakeDistrictNewsletterAdapter } from "./adapters/visitLakeDistrict";
import { solmarVillasNewsletterAdapter } from "./adapters/solmarVillas";
import { visitColchesterNewsletterAdapter } from "./adapters/visitColchester";
import { fredOlsenCruisesNewsletterAdapter } from "./adapters/fredOlsenCruises";
import { sagaCruisesNewsletterAdapter } from "./adapters/sagaCruises";
import { toadHallCottagesNewsletterAdapter } from "./adapters/toadHallCottages";
import { classicCottagesNewsletterAdapter } from "./adapters/classicCottages";
import { anchorBayHolidaysNewsletterAdapter } from "./adapters/anchorBayHolidays";
import { cruiseMummyNewsletterAdapter } from "./adapters/cruiseMummy";
import { futurePlcNewsletterAdapter } from "./adapters/futurePlcNewsletter";
import { ambassadorCruiseLineNewsletterAdapter } from "./adapters/ambassadorCruiseLine";

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
  jet2holidaysNewsletterAdapter,
  colchesterZooNewsletterAdapter,
  adventureIslandNewsletterAdapter,
  visitLakeDistrictNewsletterAdapter,
  solmarVillasNewsletterAdapter,
  visitColchesterNewsletterAdapter,
  fredOlsenCruisesNewsletterAdapter,
  sagaCruisesNewsletterAdapter,
  toadHallCottagesNewsletterAdapter,
  classicCottagesNewsletterAdapter,
  anchorBayHolidaysNewsletterAdapter,
  cruiseMummyNewsletterAdapter,
  futurePlcNewsletterAdapter,
  ambassadorCruiseLineNewsletterAdapter,
];

export const newsletterAdapterRegistry = new Map(adapters.map((a) => [a.key, a]));

export function getNewsletterAdapter(key: string): NewsletterAdapter | undefined {
  return newsletterAdapterRegistry.get(key);
}
