import type { DiscoverySource } from "./types";
import { dmriDiscoverySource } from "./dmri";

/**
 * One entry per platform whose own competition index this project knows
 * how to read. Mirrors the adapter registry deliberately: a discovery
 * source only ever proposes competitions for an adapter that already
 * exists, so nothing here can widen what the runner is willing to enter.
 */
export const discoverySources: DiscoverySource[] = [dmriDiscoverySource];
