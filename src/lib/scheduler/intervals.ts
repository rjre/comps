/**
 * Loop intervals, read once from .env and shared between the worker
 * (which schedules the loops) and the dashboard's health check (which
 * needs to know how long a gap between runs is actually expected). Kept
 * side-effect-free so it's safe to import from the Next.js app — unlike
 * src/worker/index.ts itself, which starts the worker as an import
 * side effect.
 */
const minutes = (name: string, fallback: number) => Number(process.env[name] ?? fallback) * 60_000;

export const FEED_DISCOVERY_INTERVAL_MS = minutes("DISCOVERY_INTERVAL_MINUTES", 30);
export const PLATFORM_DISCOVERY_INTERVAL_MS = minutes("PLATFORM_DISCOVERY_INTERVAL_MINUTES", 60);
export const NEWSLETTER_INTERVAL_MS = minutes("NEWSLETTER_INTERVAL_MINUTES", 180);
export const MAIL_SCAN_INTERVAL_MS = minutes("MAIL_SCAN_INTERVAL_MINUTES", 60);
export const PRUNE_INTERVAL_MS = minutes("PRUNE_INTERVAL_MINUTES", 360);

export const ENTRY_RUN_HOUR = process.env.ENTRY_RUN_HOUR !== undefined ? Number(process.env.ENTRY_RUN_HOUR) : undefined;

/** The entries loop's actual cadence — once a day when pinned to a clock hour, otherwise ENTRY_INTERVAL_MINUTES. */
export const ENTRY_INTERVAL_MS = ENTRY_RUN_HOUR !== undefined ? 24 * 60 * 60_000 : minutes("ENTRY_INTERVAL_MINUTES", 10);
