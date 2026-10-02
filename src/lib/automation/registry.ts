import type { CompetitionAdapter } from "./types";
import { exampleAdapter } from "./adapters/example";
import { genericAdapter } from "./adapters/generic";
import { nationalLobsterHatcheryAdapter } from "./adapters/nationalLobsterHatchery";
import { suffolkCoastAdapter } from "./adapters/suffolkCoast";
import { visitEssexGardenersWorldAdapter } from "./adapters/visitEssexGardenersWorld";
import { northNorfolkAttractionsAdapter } from "./adapters/northNorfolkAttractions";
import { villagePeopleBanhamZooAdapter } from "./adapters/villagePeopleBanhamZoo";
import { villagePeopleUltimateEarsAdapter } from "./adapters/villagePeopleUltimateEars";
import { villagePeopleElemisPamperAdapter } from "./adapters/villagePeopleElemisPamper";
import { diggerlandPrizeDrawAdapter } from "./adapters/diggerlandPrizeDraw";
import { coastMagazineSuffolkCoastAdapter } from "./adapters/coastMagazineSuffolkCoast";
import { coastMagazineCarbisBayAdapter } from "./adapters/coastMagazineCarbisBay";
import { devonsTopAttractionsAdapter } from "./adapters/devonsTopAttractions";
import { c2cBlowoutCompanyAdapter } from "./adapters/c2cBlowoutCompany";
import { c2cWilkoLoveAndDeathAndRockNRollAdapter } from "./adapters/c2cWilkoLoveAndDeathAndRockNRoll";
import { tuiMonthlyGiveawayAdapter } from "./adapters/tuiMonthlyGiveaway";
import { solmarVillasBritishTravelAwardsAdapter } from "./adapters/solmarVillasBritishTravelAwards";
import { visitLakeDistrictAdapter } from "./adapters/visitLakeDistrict";
import { muddyStilettosReaderTreatsAdapter } from "./adapters/muddyStilettosReaderTreats";
import { officialLondonTheatreHeathersAdapter } from "./adapters/officialLondonTheatreHeathers";
import { officialLondonTheatreIntoTheWoodsAdapter } from "./adapters/officialLondonTheatreIntoTheWoods";
import { parkHolidaysWinAHolidayHomeAdapter } from "./adapters/parkHolidaysWinAHolidayHome";
import { ambassadorCruiseLineEnglandGolfAdapter } from "./adapters/ambassadorCruiseLineEnglandGolf";
import { advantageTravelAmbassadorCaribbeanAdapter } from "./adapters/advantageTravelAmbassadorCaribbean";
import { dmriCompsAdapter, looksLikeDmriUrl } from "./adapters/dmriComps";
import { gleamAdapter } from "./adapters/gleam";
import { kingSumoAdapter } from "./adapters/kingSumo";
import { visitNorthumberlandAdapter } from "./adapters/visitNorthumberland";
import { visitEastOfEnglandAdapter } from "./adapters/visitEastOfEngland";
import { bauerCompetitionFormAdapter } from "./adapters/bauerCompetitionForm";
import { wightlinkParkdeanResortsAdapter } from "./adapters/wightlinkParkdeanResorts";
import { wightlinkParkdeanCompetitionAdapter } from "./adapters/wightlinkParkdeanCompetition";
import { bestDaysOutCornwallGoldenTicketAdapter } from "./adapters/bestDaysOutCornwallGoldenTicket";
import { kentAttractionsAdapter } from "./adapters/kentAttractions";
import { visitNorthDevonAdapter } from "./adapters/visitNorthDevon";
import { reachPlcCompetitionAdapter } from "./adapters/reachPlcCompetition";
import { kynrenAdapter } from "./adapters/kynren";

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
  villagePeopleUltimateEarsAdapter,
  villagePeopleElemisPamperAdapter,
  diggerlandPrizeDrawAdapter,
  coastMagazineSuffolkCoastAdapter,
  coastMagazineCarbisBayAdapter,
  devonsTopAttractionsAdapter,
  c2cBlowoutCompanyAdapter,
  c2cWilkoLoveAndDeathAndRockNRollAdapter,
  tuiMonthlyGiveawayAdapter,
  solmarVillasBritishTravelAwardsAdapter,
  visitLakeDistrictAdapter,
  muddyStilettosReaderTreatsAdapter,
  officialLondonTheatreHeathersAdapter,
  officialLondonTheatreIntoTheWoodsAdapter,
  parkHolidaysWinAHolidayHomeAdapter,
  ambassadorCruiseLineEnglandGolfAdapter,
  advantageTravelAmbassadorCaribbeanAdapter,
  dmriCompsAdapter,
  gleamAdapter,
  kingSumoAdapter,
  visitNorthumberlandAdapter,
  visitEastOfEnglandAdapter,
  bauerCompetitionFormAdapter,
  wightlinkParkdeanResortsAdapter,
  wightlinkParkdeanCompetitionAdapter,
  bestDaysOutCornwallGoldenTicketAdapter,
  kentAttractionsAdapter,
  visitNorthDevonAdapter,
  reachPlcCompetitionAdapter,
  kynrenAdapter,
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

/**
 * Which adapter a bare entry URL belongs to, for the shared giveaway
 * platforms this project has a dedicated adapter for — DMRI (by URL
 * shape, since it's many magazine-branded siblings rather than one
 * domain — see dmriComps.ts's looksLikeDmriUrl), Gleam.io and KingSumo
 * (by host, since each is a single domain).
 *
 * Previously duplicated three ways (runDiscovery.ts, the one-off
 * backfillAdapterKeys.ts script, and processMailbox.ts not doing this
 * check at all) — every one of those getting out of sync is exactly how
 * an email-discovered DMRI/Gleam/KingSumo lead kept being born as
 * "generic", which cannot get past DMRI's login wall or Gleam's
 * headless-UA block, and wrongly declines a real KingSumo entry that only
 * asks for an email. One function, so a fourth platform only needs
 * adding here.
 */
export function detectAdapterKey(url: string): string {
  if (looksLikeDmriUrl(url)) return "dmri-comps";
  try {
    const host = new URL(url).hostname;
    if (host === "gleam.io") return "gleam";
    if (host === "kingsumo.com") return "kingsumo";
  } catch {}
  return "generic";
}
