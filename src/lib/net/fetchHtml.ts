import { politeDelay, isAllowedByRobots } from "./politeness";

export const DISCOVERY_USER_AGENT =
  "Mozilla/5.0 (compatible; comps-entry-assistant/0.1; personal use, single identity, respects robots.txt)";

/** robots.txt + rate-limit checked GET, shared by scrapers and the RSS-item resolver. */
export async function fetchHtml(url: string): Promise<string | null> {
  if (!(await isAllowedByRobots(url, DISCOVERY_USER_AGENT))) return null;
  await politeDelay(url);

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": DISCOVERY_USER_AGENT },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
