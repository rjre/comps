import type { CompetitionAdapter } from "./types";
import { exampleAdapter } from "./adapters/example";
import { genericAdapter } from "./adapters/generic";

const adapters: CompetitionAdapter[] = [exampleAdapter, genericAdapter];

export const adapterRegistry = new Map(adapters.map((a) => [a.key, a]));

export function getAdapter(key: string): CompetitionAdapter | undefined {
  return adapterRegistry.get(key) ?? adapterRegistry.get("generic");
}
