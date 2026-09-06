import { prisma } from "../src/lib/db";
import { looksLikeDmriUrl } from "../src/lib/automation/adapters/dmriComps";

/**
 * One-off (but safe to re-run) fix for Competition rows that were
 * discovered before runDiscovery.ts learned to recognise three shared
 * giveaway platforms it has dedicated adapters for: DMRI (by URL shape —
 * see dmriComps.ts's looksLikeDmriUrl), Gleam.io and KingSumo (by host).
 * All of these got created as adapterKey "generic", which cannot get past
 * DMRI's login wall or Gleam's headless-UA block, and wrongly declines a
 * real KingSumo entry that only asks for an email — so every one of them
 * was failing 100% of the time.
 *
 * Re-pointing DMRI rows at "dmri-comps" also seeds dmri.ts's own discovery
 * source with these origins on the next discovery pass (see
 * discoverOnce.ts's extraOrigins), so it starts crawling each sibling
 * site's full competition index too, not just the one link feed-discovery
 * happened to find.
 */
function correctAdapterFor(url: string): string | null {
  if (looksLikeDmriUrl(url)) return "dmri-comps";
  try {
    const host = new URL(url).hostname;
    if (host === "gleam.io") return "gleam";
    if (host === "kingsumo.com") return "kingsumo";
  } catch {}
  return null;
}

async function main() {
  const candidates = await prisma.competition.findMany({
    where: { adapterKey: "generic" },
    select: { id: true, url: true, name: true, status: true },
  });
  const toFix = candidates
    .map((c) => ({ ...c, correctKey: correctAdapterFor(c.url) }))
    .filter((c): c is typeof c & { correctKey: string } => c.correctKey !== null);
  console.log(`${toFix.length} of ${candidates.length} generic-adapter row(s) belong to a platform with its own adapter.`);

  for (const c of toFix) {
    const data: { adapterKey: string; status?: string } = { adapterKey: c.correctKey };
    // A row the runner already gave up on (12 consecutive failures) deserves
    // a fresh chance under the adapter that can actually enter it.
    if (c.status === "FAILED") data.status = "PENDING";
    await prisma.competition.update({ where: { id: c.id }, data });
    console.log(`  fixed (${c.correctKey}): ${c.name} (${c.url})${data.status ? " [reset FAILED -> PENDING]" : ""}`);
  }

  const byHostAndKey: Record<string, number> = {};
  for (const c of toFix) {
    try {
      const key = `${new URL(c.url).hostname} -> ${c.correctKey}`;
      byHostAndKey[key] = (byHostAndKey[key] ?? 0) + 1;
    } catch {}
  }
  console.log("By host:", JSON.stringify(byHostAndKey, null, 2));
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
