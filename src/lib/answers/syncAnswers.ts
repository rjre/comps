import "@/lib/loadEnv";
import { prisma } from "@/lib/db";
import { createRunLogger } from "@/lib/logger";
import { acquireLock } from "@/lib/scheduler/lock";
import { harvestAnswers, listingPagesFor, recentDayPaths } from "@/lib/answers/competitionsWhale";

/** How many days of the aggregator's own "added on" listings to read. */
const DAYS_OF_LISTINGS = 8;

/**
 * Adapters whose competitions pose a question this source can answer.
 *
 * Scoped deliberately: only the DMRI platform asks a trivia question at
 * all, and it's the only platform this aggregator indexes. Without the
 * restriction the sync builds one `/website/<host>` request per distinct
 * host across every open competition — 189 of them on the first live run,
 * against the 24 that are actually DMRI — so nearly every request was a
 * pointless 404 aimed at someone else's server.
 */
const QUIZ_ADAPTERS = ["dmri-comps"];

/**
 * Fills in Competition.quizAnswer for open competitions whose quiz answer
 * an aggregator publishes.
 *
 * This exists because the answer, not the entry mechanics, is what stops
 * these draws being entered: 162 of the open DMRI draws were declining
 * every day for want of one, and this covers 84 of them. Every answer is
 * attributed, and none is trusted over the site's own verdict — see
 * competitionsWhale.ts.
 *
 * Only open competitions are looked up, and only their own host's listing
 * pages are read, so the number of pages fetched tracks how many sites we
 * actually track rather than how large the aggregator is.
 */
export async function syncQuizAnswers() {
  const lock = await acquireLock("answers");
  if (!lock) {
    console.log("Another answer sync is already running — leaving it to finish.");
    return;
  }

  const run = await prisma.run.create({ data: {} });
  const log = createRunLogger(run.id);
  let filled = 0;
  let changed = 0;

  try {
    const open = await prisma.competition.findMany({
      where: { status: "PENDING", adapterKey: { in: QUIZ_ADAPTERS } },
      select: { id: true, name: true, url: true, quizAnswer: true },
    });
    if (open.length === 0) {
      await log.info("No open quiz-based competitions to look answers up for.");
      await prisma.run.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date() } });
      return;
    }

    const hosts = [
      ...new Set(
        open
          .map((c) => {
            try {
              return new URL(c.url).host;
            } catch {
              return "";
            }
          })
          .filter(Boolean),
      ),
    ];
    await log.info(`Looking up answers for ${open.length} open competition(s) across ${hosts.length} site(s).`);

    const answers = await harvestAnswers(listingPagesFor(hosts, recentDayPaths(DAYS_OF_LISTINGS)), (m) => log.info(m));

    for (const competition of open) {
      const answer = answers.get(competition.url);
      if (!answer) continue;
      filled += 1;
      // Rewrite only on a real change: the aggregator can correct itself,
      // and an unchanged answer shouldn't churn the row every day.
      if (competition.quizAnswer === answer) continue;
      changed += 1;
      await prisma.competition.update({
        where: { id: competition.id },
        data: { quizAnswer: answer, quizAnswerSource: "competitions-whale.co.uk" },
      });
      await log.info(`Answer for "${competition.name}": ${answer}`, competition.id);
    }

    await log.info(`Answer sync finished — ${filled} competition(s) covered, ${changed} newly set or updated.`);
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "COMPLETED", finishedAt: new Date(), candidateCount: changed },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.error(`Answer sync failed: ${message}`);
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage: message },
    });
    throw err;
  } finally {
    await lock.release();
  }
}

if (require.main === module) {
  syncQuizAnswers()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
