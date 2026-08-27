import type { CompetitionAdapter } from "./types";
import { exampleAdapter } from "./adapters/example";
import { nationalLobsterHatcheryAdapter } from "./adapters/nationalLobsterHatchery";
import { suffolkCoastAdapter } from "./adapters/suffolkCoast";
import { visitEssexGardenersWorldAdapter } from "./adapters/visitEssexGardenersWorld";
import { northNorfolkAttractionsAdapter } from "./adapters/northNorfolkAttractions";
import { villagePeopleBanhamZooAdapter } from "./adapters/villagePeopleBanhamZoo";
import { coastMagazineSuffolkCoastAdapter } from "./adapters/coastMagazineSuffolkCoast";
import { devonsTopAttractionsAdapter } from "./adapters/devonsTopAttractions";
import { c2cBlowoutCompanyAdapter } from "./adapters/c2cBlowoutCompany";
import { tuiMonthlyGiveawayAdapter } from "./adapters/tuiMonthlyGiveaway";
import { solmarVillasBritishTravelAwardsAdapter } from "./adapters/solmarVillasBritishTravelAwards";
import { visitLakeDistrictAdapter } from "./adapters/visitLakeDistrict";
import { muddyStilettosReaderTreatsAdapter } from "./adapters/muddyStilettosReaderTreats";
import { officialLondonTheatreHeathersAdapter } from "./adapters/officialLondonTheatreHeathers";
import { parkHolidaysWinAHolidayHomeAdapter } from "./adapters/parkHolidaysWinAHolidayHome";

const adapters: CompetitionAdapter[] = [
  exampleAdapter,
  nationalLobsterHatcheryAdapter,
  suffolkCoastAdapter,
  visitEssexGardenersWorldAdapter,
  northNorfolkAttractionsAdapter,
  villagePeopleBanhamZooAdapter,
  coastMagazineSuffolkCoastAdapter,
  devonsTopAttractionsAdapter,
  c2cBlowoutCompanyAdapter,
  tuiMonthlyGiveawayAdapter,
  solmarVillasBritishTravelAwardsAdapter,
  visitLakeDistrictAdapter,
  muddyStilettosReaderTreatsAdapter,
  officialLondonTheatreHeathersAdapter,
  parkHolidaysWinAHolidayHomeAdapter,
];

export const adapterRegistry = new Map(adapters.map((a) => [a.key, a]));

export function getAdapter(key: string): CompetitionAdapter | undefined {
  return adapterRegistry.get(key);
}
