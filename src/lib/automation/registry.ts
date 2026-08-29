import type { CompetitionAdapter } from "./types";
import { exampleAdapter } from "./adapters/example";
import { genericAdapter } from "./adapters/generic";
import { nationalLobsterHatcheryAdapter } from "./adapters/nationalLobsterHatchery";
import { suffolkCoastAdapter } from "./adapters/suffolkCoast";
import { visitEssexGardenersWorldAdapter } from "./adapters/visitEssexGardenersWorld";
import { northNorfolkAttractionsAdapter } from "./adapters/northNorfolkAttractions";
import { villagePeopleBanhamZooAdapter } from "./adapters/villagePeopleBanhamZoo";
import { coastMagazineSuffolkCoastAdapter } from "./adapters/coastMagazineSuffolkCoast";
import { coastMagazineCarbisBayAdapter } from "./adapters/coastMagazineCarbisBay";
import { devonsTopAttractionsAdapter } from "./adapters/devonsTopAttractions";
import { c2cBlowoutCompanyAdapter } from "./adapters/c2cBlowoutCompany";
import { tuiMonthlyGiveawayAdapter } from "./adapters/tuiMonthlyGiveaway";
import { solmarVillasBritishTravelAwardsAdapter } from "./adapters/solmarVillasBritishTravelAwards";
import { visitLakeDistrictAdapter } from "./adapters/visitLakeDistrict";
import { muddyStilettosReaderTreatsAdapter } from "./adapters/muddyStilettosReaderTreats";
import { officialLondonTheatreHeathersAdapter } from "./adapters/officialLondonTheatreHeathers";
import { parkHolidaysWinAHolidayHomeAdapter } from "./adapters/parkHolidaysWinAHolidayHome";
import { ambassadorCruiseLineEnglandGolfAdapter } from "./adapters/ambassadorCruiseLineEnglandGolf";
import { advantageTravelAmbassadorCaribbeanAdapter } from "./adapters/advantageTravelAmbassadorCaribbean";
import { dmriCompsAdapter } from "./adapters/dmriComps";

const adapters: CompetitionAdapter[] = [
  exampleAdapter,
  // Heuristic form-fill, used by the feed-discovery pipeline for sites
  // that have no adapter of their own yet.
  genericAdapter,
  nationalLobsterHatcheryAdapter,
  suffolkCoastAdapter,
  visitEssexGardenersWorldAdapter,
  northNorfolkAttractionsAdapter,
  villagePeopleBanhamZooAdapter,
  coastMagazineSuffolkCoastAdapter,
  coastMagazineCarbisBayAdapter,
  devonsTopAttractionsAdapter,
  c2cBlowoutCompanyAdapter,
  tuiMonthlyGiveawayAdapter,
  solmarVillasBritishTravelAwardsAdapter,
  visitLakeDistrictAdapter,
  muddyStilettosReaderTreatsAdapter,
  officialLondonTheatreHeathersAdapter,
  parkHolidaysWinAHolidayHomeAdapter,
  ambassadorCruiseLineEnglandGolfAdapter,
  advantageTravelAmbassadorCaribbeanAdapter,
  dmriCompsAdapter,
];

export const adapterRegistry = new Map(adapters.map((a) => [a.key, a]));

/**
 * Exactly what's registered under `key`, with no fallback.
 *
 * This deliberately does NOT fall back to the generic form-filler for an
 * unrecognised key. Silently running a heuristic form-fill against a site
 * nobody has written an adapter for is the opposite of this project's
 * per-site rule, and it would also defeat the runner's "no adapter
 * registered, skipping" branch and the discovery pass's guard against
 * registering un-enterable rows. Callers that genuinely want the generic
 * adapter ask for it by name — the feed-discovery pipeline sets
 * adapterKey: "generic" explicitly when it creates a row.
 */
export function getAdapter(key: string): CompetitionAdapter | undefined {
  return adapterRegistry.get(key);
}
