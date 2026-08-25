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

async function getRobotsDisallow(origin: string): Promise<string[]> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.fetchedAt < ROBOTS_CACHE_TTL_MS) {
    return cached.disallow;
  }
  try {
    const res = await fetch(new URL("/robots.txt", origin).toString(), {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      robotsCache.set(origin, { disallow: [], fetchedAt: Date.now() });
      return [];
    }
    const text = await res.text();
    const disallow = parseRobotsDisallowForAllAgents(text);
    robotsCache.set(origin, { disallow, fetchedAt: Date.now() });
    return disallow;
  } catch {
    // Unreachable/invalid robots.txt: fail open.
    robotsCache.set(origin, { disallow: [], fetchedAt: Date.now() });
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

export async function isAllowedByRobots(url: string): Promise<boolean> {
  const parsed = new URL(url);
  const disallow = await getRobotsDisallow(parsed.origin);
  return !disallow.some((rule) => disallowRuleToRegExp(rule).test(parsed.pathname));
}
