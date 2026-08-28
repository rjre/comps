import { prisma } from "@/lib/db";

/** Marks PENDING competitions whose closesAt has passed as CLOSED, so the dashboard and entry pass both reflect reality. */
export async function closeExpiredCompetitions(): Promise<{ closed: number }> {
  const result = await prisma.competition.updateMany({
    where: { status: "PENDING", closesAt: { lt: new Date() } },
    data: { status: "CLOSED" },
  });
  return { closed: result.count };
}
