import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";
import { getAdapter } from "@/lib/automation/registry";
import { createRunLogger } from "@/lib/logger";

const SCREENSHOT_DIR = path.join(process.cwd(), "data", "screenshots");

/**
 * Runs one pass over eligible competitions: open, not already at their own
 * entry cap, and have a registered adapter. Intended to be invoked on a
 * schedule (cron/task scheduler) for "low touch" operation — see README.
 *
 * Set DRY_RUN=1 to have adapters fill forms without submitting — useful
 * when checking a new/changed adapter against the real page.
 */
async function runOnce() {
  const dryRun = process.env.DRY_RUN === "1";
  const run = await prisma.run.create({ data: { dryRun } });
  const log = createRunLogger(run.id);

  try {
    await log.info(`Run started${dryRun ? " (dry run — no entries will be submitted)" : ""}`);

    const profile = await prisma.profile.findFirst();
    if (!profile) {
      await log.error("No profile configured yet — set one up at /profile first.");
      await prisma.run.update({
        where: { id: run.id },
        data: { status: "FAILED", finishedAt: new Date(), errorMessage: "No profile configured" },
      });
      return;
    }

    const now = new Date();
    const candidates = await prisma.competition.findMany({
      where: {
        status: "PENDING",
        OR: [{ closesAt: null }, { closesAt: { gt: now } }],
      },
      include: { entries: { include: { run: true } } },
    });

    await prisma.run.update({ where: { id: run.id }, data: { candidateCount: candidates.length } });

    if (candidates.length === 0) {
      await log.info("No eligible competitions to enter.");
      await prisma.run.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date() } });
      return;
    }

    await log.info(`${candidates.length} eligible competition(s) found.`);
    await mkdir(SCREENSHOT_DIR, { recursive: true });

    const browser = await chromium.launch();
    try {
      for (const competition of candidates) {
        // Dry-run entries are logged for review but never count against the
        // competition's real (limited) entry cap.
        const alreadyEntered = competition.entries.filter((e) => e.status === "SUCCESS" && !e.run?.dryRun).length;
        if (alreadyEntered >= competition.maxEntries) {
          await log.info(`Already at entry cap (${alreadyEntered}/${competition.maxEntries}), skipping`, competition.id);
          await prisma.entry.create({
            data: { competitionId: competition.id, runId: run.id, status: "SKIPPED_ALREADY_ENTERED" },
          });
          continue;
        }

        const adapter = getAdapter(competition.adapterKey);
        if (!adapter) {
          await log.warn(`No adapter registered for "${competition.adapterKey}", skipping ${competition.name}`, competition.id);
          continue;
        }

        await log.info(`Entering "${competition.name}" via adapter "${adapter.key}" (${competition.url})`, competition.id);
        const page = await browser.newPage();
        page.on("console", (msg) => {
          if (msg.type() === "error") {
            log.warn(`Page console error: ${msg.text()}`, competition.id).catch(() => {});
          }
        });
        page.on("pageerror", (err) => {
          log.warn(`Page error: ${err.message}`, competition.id).catch(() => {});
        });

        const captureScreenshot = async (reason: string) => {
          const file = path.join(SCREENSHOT_DIR, `${run.id}_${competition.id}_${reason}.png`);
          try {
            await page.screenshot({ path: file, fullPage: true });
            await log.info(`Saved screenshot: ${file}`, competition.id);
          } catch (shotErr) {
            await log.warn(
              `Could not capture screenshot: ${shotErr instanceof Error ? shotErr.message : String(shotErr)}`,
              competition.id,
            );
          }
        };

        try {
          const outcome = await adapter.enterCompetition({
            page,
            competitionUrl: competition.url,
            profile,
            log,
            dryRun,
          });
          await log.info(`Landed on ${page.url()} ("${await page.title().catch(() => "")}") after adapter ran`, competition.id);
          await prisma.entry.create({
            data: {
              competitionId: competition.id,
              runId: run.id,
              status: outcome.status,
              message: "message" in outcome ? outcome.message : undefined,
            },
          });
          if (outcome.status === "SUCCESS") {
            await log.info(`Entered: ${competition.name}`, competition.id);
            if (!dryRun) {
              const credentialsUpdate =
                "credentials" in outcome && outcome.credentials
                  ? { credentials: JSON.stringify(outcome.credentials) }
                  : {};
              if ("credentials" in outcome && outcome.credentials) {
                await log.info("Account credentials stored on the record, not logged", competition.id);
              }
              // A real (non-dry-run) success reaching the cap is the
              // competition's final state — mark it ENTERED so future runs
              // stop re-querying it as a PENDING candidate every cycle.
              if (alreadyEntered + 1 >= competition.maxEntries) {
                await prisma.competition.update({
                  where: { id: competition.id },
                  data: { status: "ENTERED", ...credentialsUpdate },
                });
              } else if (Object.keys(credentialsUpdate).length > 0) {
                await prisma.competition.update({ where: { id: competition.id }, data: credentialsUpdate });
              }
            }
          } else {
            await log.warn(`${outcome.status}: ${competition.name} — ${outcome.message ?? ""}`, competition.id);
            await captureScreenshot(outcome.status.toLowerCase());
            // A one-shot competition (maxEntries 1) whose adapter reports
            // SKIPPED_ALREADY_ENTERED on a real (non-dry) run means the
            // site itself is confirming its single entry cap was already
            // reached by an earlier run — even if that earlier run's own
            // Entry record never got marked SUCCESS (a confirmation-
            // detection miss). Without this, the competition stays PENDING
            // forever and the runner keeps resubmitting the same real form
            // on every future run. Daily-draw adapters (maxEntries > 1,
            // e.g. dmri-comps) are unaffected — "already entered" there
            // means "already entered today", not "cap reached".
            if (outcome.status === "SKIPPED_ALREADY_ENTERED" && !dryRun && competition.maxEntries === 1) {
              await prisma.competition.update({ where: { id: competition.id }, data: { status: "ENTERED" } });
              await log.info("Marking ENTERED — site confirms this one-shot competition's entry cap was already reached", competition.id);
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await prisma.entry.create({
            data: { competitionId: competition.id, runId: run.id, status: "FAILED", message },
          });
          await log.error(`Failed: ${competition.name} — ${message}`, competition.id);
          await captureScreenshot("exception");
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }

    await log.info("Run finished.");
    await prisma.run.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date() } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.error(`Run failed: ${message}`);
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage: message },
    });
    throw err;
  }
}

runOnce()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
