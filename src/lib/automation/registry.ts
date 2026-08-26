import type { CompetitionAdapter } from "./types";
import { exampleAdapter } from "./adapters/example";
import { nationalLobsterHatcheryAdapter } from "./adapters/nationalLobsterHatchery";
import { suffolkCoastAdapter } from "./adapters/suffolkCoast";

const adapters: CompetitionAdapter[] = [exampleAdapter, nationalLobsterHatcheryAdapter, suffolkCoastAdapter];

export const adapterRegistry = new Map(adapters.map((a) => [a.key, a]));

export function getAdapter(key: string): CompetitionAdapter | undefined {
  return adapterRegistry.get(key);
}
