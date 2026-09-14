// Shared "don't hammer other people's servers" helpers. Best-effort by
// design: a robots.txt fetch/parse failure fails OPEN (treated as allowed)
// rather than blocking discovery on a transient network hiccup — this is a
// courtesy check, not a security boundary.

const lastHitByHost = new Map<string, number>();
const robotsCache = new Map<string, { disallow: string[]; fetchedAt: number }>();

const MIN_DELAY_MS = Number(process.env.MIN_DELAY_PER_HOST_MS ?? 4000);
const ROBOTS_CACHE_TTL_MS = 60 * 60 * 1000;

export async function politeDelay(url: string): Promise<void> {
  const host = new URL(url).host;
  const last = lastHitByHost.get(host) ?? 0;
  const wait = last + MIN_DELAY_MS - Date.now();
  if (wait > 0) {
    await new Promise((r) => setTimeout(r, wait));
  }
  lastHitByHost.set(host, Date.now());
}

const hostQueues = new Map<string, Promise<unknown>>();

/**
 * Like politeDelay, but for a genuinely concurrent caller: politeDelay's
 * read-then-sleep-then-set isn't atomic, so two concurrent calls for the
 * same host could both read the same "last hit" and slip through
 * together. This instead chains every call for a host onto the same
 * promise, so they run one at a time with MIN_DELAY_MS between the end of
 * one and the start of the next — not just spaced out, but never
 * overlapping, which matters beyond politeness for something like the
 * DMRI reader-comps sites: many competitions, one shared login, on one
 * host, where two sessions in flight at once risks the site invalidating
 * one out from under the other.
 *
 * A different host queues and runs independently, so this is where real
 * concurrency (ENTRY_CONCURRENCY > 1) actually comes from.
 */
export function withHostThrottle<T>(url: string, fn: () => Promise<T>): Promise<T> {
  const host = new URL(url).host;
  const previous = hostQueues.get(host) ?? Promise.resolve();
  const settled = previous.then(
    () => {},
    () => {},
  );
  const result = settled.then(async () => {
    try {
      return await fn();
    } finally {
      await new Promise((resolve) => setTimeout(resolve, MIN_DELAY_MS));
    }
  });
  hostQueues.set(
    host,
    result.then(
      () => {},
      () => {},
    ),
  );
  return result;
}

async function getRobotsDisallow(origin: string, userAgent?: string): Promise<string[]> {
  // Keyed by UA as well as origin: a site that serves different robots.txt
  // (or refuses it) per user agent must not have one agent's answer cached
  // and reused for another.
  const key = `${origin}\u0000${userAgent ?? ""}`;
  const cached = robotsCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_TTL_MS) {
    return cached.disallow;
  }
  try {
    // Send the same UA the caller will use for the real request. Without
    // this, a site that gates on user agent (the DMRI comps sites return
    // 403 to anything that doesn't look like a browser, robots.txt
    // included) answers 403 here, we fail open, and the robots check is
    // silently a no-op for exactly the sites strict enough to have one.
    const res = await fetch(new URL("/robots.txt", origin).toString(), {
      headers: userAgent ? { "User-Agent": userAgent } : {},
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      robotsCache.set(key, { disallow: [], fetchedAt: Date.now() });
      return [];
    }
    const text = await res.text();
    const disallow = parseRobotsDisallowForAllAgents(text);
    robotsCache.set(key, { disallow, fetchedAt: Date.now() });
    return disallow;
  } catch {
    // Unreachable/invalid robots.txt: fail open.
    robotsCache.set(key, { disallow: [], fetchedAt: Date.now() });
    return [];
  }
}

function parseRobotsDisallowForAllAgents(text: string): string[] {
  const lines = text.split("\n").map((l) => l.trim());
  const disallow: string[] = [];
  let inWildcardGroup = false;
  for (const line of lines) {
    if (/^user-agent:/i.test(line)) {
      inWildcardGroup = line.toLowerCase().includes("*");
      continue;
    }
    if (inWildcardGroup && /^disallow:/i.test(line)) {
      const path = line.split(":").slice(1).join(":").trim();
      if (path) disallow.push(path);
    }
  }
  return disallow;
}

// robots.txt Disallow rules support `*` (any sequence of characters) and a
// trailing `$` (end of path) per the de facto extension most sites/crawlers
// follow (e.g. Google's) — treating a rule as a plain string prefix, as an
// earlier version of this function did, misses any rule using either,
// silently ignoring real site policy (found via forums.moneysavingexpert.com,
// whose robots.txt disallows `/*.rss$` for generic crawlers).
function disallowRuleToRegExp(rule: string): RegExp {
  const escaped = rule.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}`);
}

export async function isAllowedByRobots(url: string, userAgent?: string): Promise<boolean> {
  const parsed = new URL(url);
  const disallow = await getRobotsDisallow(parsed.origin, userAgent);
  return !disallow.some((rule) => disallowRuleToRegExp(rule).test(parsed.pathname));
}
