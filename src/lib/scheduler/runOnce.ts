import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";
import { getAdapter } from "@/lib/automation/registry";
import { createRunLogger } from "@/lib/logger";
import { PageIssueCollector } from "@/lib/automation/pageNoise";
import { decideSchedule } from "@/lib/scheduler/schedule";
import { acquireLock } from "@/lib/scheduler/lock";
import type { EntryStatus } from "@/lib/status";

const SCREENSHOT_DIR = path.join(process.cwd(), "data", "screenshots");

/**
 * Hard ceiling on one competition's adapter. Nothing here is worth more
 * than a few minutes, and without this a single adapter that wedges (a
 * consent iframe that never resolves, a login step that hangs on a click)
 * blocks the whole run forever — and because the systemd unit is a
 * oneshot, the timer won't fire again while that run is still "active",
 * so one hang silently stops the entire service until someone notices.
 */
const PER_COMPETITION_TIMEOUT_MS = Number(process.env.COMP_TIMEOUT_MS ?? 6 * 60_000);

/**
 * Ceiling on the whole pass, so a run always finishes well inside its own
 * (hourly) timer interval rather than overlapping the next one, leaving
 * room for the discovery, newsletter and prune stages of the same cycle.
 *
 * There is normally more due than fits: ~60-90s per DMRI entry against 50+
 * open daily draws is over an hour of work. That's fine — competitions are
 * taken least-recently-attempted first, so a partial pass always makes
 * progress on whatever the last one didn't reach, and every daily draw
 * still comes round well inside its 24h window.
 */
const RUN_BUDGET_MS = Number(process.env.RUN_BUDGET_MS ?? 40 * 60_000);

class AdapterTimeout extends Error {}

/** Most recent attempt on a competition, or 0 for one never attempted (so those sort first). */
function lastAttemptTime(entries: { attemptedAt: Date }[]): number {
  return entries.reduce((latest, e) => Math.max(latest, e.attemptedAt.getTime()), 0);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  // The abandoned adapter promise keeps running until the page is closed
  // out from under it; swallow its eventual rejection so it can't surface
  // as an unhandled rejection and take the process down.
  work.catch(() => {});
  let timer: NodeJS.Timeout;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AdapterTimeout(`adapter exceeded ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, guard]).finally(() => clearTimeout(timer)) as Promise<T>;
}

/**
 * Runs one pass over eligible competitions. Which competitions are
 * eligible, and when, is decided by src/lib/scheduler/schedule.ts from
 * each competition's own entry history — repeatable daily draws are only
 * re-attempted once their interval is up, and consistently failing ones
 * back off instead of consuming every pass. That's what lets this be
 * scheduled aggressively (hourly) without hammering anyone's form.
 *
 * Set DRY_RUN=1 to have adapters fill forms without submitting — useful
 * when checking a new/changed adapter against the real page.
 */
async function runOnce() {
  const dryRun = process.env.DRY_RUN === "1";
  const startedAt = Date.now();

  // Nothing below is safe to run twice at once — see lock.ts. Taken before
  // the Run row is created so a blocked pass leaves no trace at all.
  const lock = await acquireLock("entries");
  if (!lock) {
    console.log("Another entry pass is already running — leaving it to finish.");
    return;
  }

  const run = await prisma.run.create({ data: { dryRun } });
  const log = createRunLogger(run.id);

  const tally: Record<string, number> = {};
  const count = (key: string) => {
    tally[key] = (tally[key] ?? 0) + 1;
  };

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
    const tracked = await prisma.competition.findMany({
      where: { status: "PENDING" },
      include: { entries: { include: { run: true } } },
    });

    // Work out what's actually due before opening a browser at all, and
    // settle the terminal states (closed / cap met / given up) as we go so
    // they stop being re-queried on every future pass.
    const due: typeof tracked = [];
    for (const competition of tracked) {
      const history = competition.entries.map((e) => ({
        status: e.status as EntryStatus,
        attemptedAt: e.attemptedAt,
        dryRun: e.run?.dryRun ?? false,
      }));
      const decision = decideSchedule(competition, history, now);

      switch (decision.action) {
        case "ENTER":
          due.push(competition);
          break;
        case "WAIT":
          count("waiting");
          await log.info(`Not due: ${competition.name} — ${decision.reason}`, competition.id);
          break;
        case "CLOSE":
          count("closed");
          await prisma.competition.update({ where: { id: competition.id }, data: { status: "CLOSED" } });
          await log.info(`Marking CLOSED: ${competition.name} — ${decision.reason}`, competition.id);
          break;
        case "CAP_REACHED":
          count("capped");
          await prisma.competition.update({ where: { id: competition.id }, data: { status: "ENTERED" } });
          await log.info(`Marking ENTERED: ${competition.name} — ${decision.reason}`, competition.id);
          break;
        case "GIVE_UP":
          count("gaveUp");
          await prisma.competition.update({
            where: { id: competition.id },
            data: {
              status: "FAILED",
              notes: [competition.notes, `Auto-marked FAILED by the runner: ${decision.reason}. Re-set to PENDING once the adapter is fixed.`]
                .filter(Boolean)
                .join("\n\n"),
            },
          });
          await log.warn(`Giving up on ${competition.name} — ${decision.reason}`, competition.id);
          break;
      }
    }

    // Least-recently-attempted first. Once discovery started finding
    // competitions in bulk (57 on its first pass), a pass can no longer
    // get through everything that's due inside its budget — and in DB
    // insertion order that would mean the same head of the list is
    // entered every time while the tail is never reached at all.
    due.sort((a, b) => lastAttemptTime(a.entries) - lastAttemptTime(b.entries));

    await prisma.run.update({ where: { id: run.id }, data: { candidateCount: due.length } });

    if (due.length === 0) {
      await log.info(`No competitions due this pass (${tracked.length} tracked).`);
      await prisma.run.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date() } });
      return;
    }

    await log.info(`${due.length} competition(s) due out of ${tracked.length} tracked.`);
    await mkdir(SCREENSHOT_DIR, { recursive: true });

    let attempted = 0;
    const browser = await chromium.launch();
    try {
      for (const competition of due) {
        if (Date.now() - startedAt > RUN_BUDGET_MS) {
          await log.warn(
            `Run budget of ${Math.round(RUN_BUDGET_MS / 60_000)} minutes reached — ` +
              `${due.length - attempted} competition(s) left for the next pass, which will take them first.`,
          );
          break;
        }
        attempted += 1;

        const adapter = getAdapter(competition.adapterKey);
        if (!adapter) {
          count("noAdapter");
          await log.warn(`No adapter registered for "${competition.adapterKey}", skipping ${competition.name}`, competition.id);
          continue;
        }

        await log.info(`Entering "${competition.name}" via adapter "${adapter.key}" (${competition.url})`, competition.id);
        const page = await browser.newPage();

        // Buffered rather than logged line-by-line — see pageNoise.ts.
        const issues = new PageIssueCollector();
        page.on("console", (msg) => {
          if (msg.type() === "error") issues.record("console", msg.text());
        });
        page.on("pageerror", (err) => issues.record("pageerror", err.message));

        const reportPageIssues = async () => {
          const summary = issues.summary();
          if (summary.length === 0) {
            if (issues.noiseCount > 0) {
              await log.info(`No page errors from the site itself (${issues.noiseCount} third-party ad/tracker errors ignored)`, competition.id);
            }
            return;
          }
          await log.warn(`Page errors during this attempt (${issues.noiseCount} third-party ones ignored):`, competition.id);
          for (const line of summary) await log.warn(`  ${line}`, competition.id);
        };

        // JPEG, not PNG: a full-page shot of an ad-heavy competition page
        // ran 1-4MB as PNG, and 281MB had accumulated on a Raspberry Pi's
        // SD card. Quality 70 keeps form fields and error text perfectly
        // legible at roughly a tenth of the size.
        const captureScreenshot = async (reason: string) => {
          const file = path.join(SCREENSHOT_DIR, `${run.id}_${competition.id}_${reason}.jpg`);
          try {
            await page.screenshot({ path: file, fullPage: true, type: "jpeg", quality: 70 });
            await log.info(`Saved screenshot: ${file}`, competition.id);
          } catch (shotErr) {
            await log.warn(
              `Could not capture screenshot: ${shotErr instanceof Error ? shotErr.message : String(shotErr)}`,
              competition.id,
            );
          }
        };

        // Counted, real (non-dry) successes so far — the cap check itself
        // lives in decideSchedule; this is only needed to know whether
        // *this* success is the one that reaches it.
        const alreadyEntered = competition.entries.filter((e) => e.status === "SUCCESS" && !e.run?.dryRun).length;

        try {
          const outcome = await withTimeout(
            adapter.enterCompetition({
              page,
              competitionUrl: competition.url,
              profile,
              log,
              dryRun,
              previousOutcomes: competition.entries
                .filter((e) => !e.run?.dryRun)
                .sort((a, b) => b.attemptedAt.getTime() - a.attemptedAt.getTime())
                .slice(0, 20)
                .map((e) => ({ status: e.status as EntryStatus, message: e.message, attemptedAt: e.attemptedAt })),
            }),
            PER_COMPETITION_TIMEOUT_MS,
          );
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
            count("entered");
            await log.info(`Entered: ${competition.name}`, competition.id);
            if (!dryRun) {
              const credentialsUpdate =
                "credentials" in outcome && outcome.credentials
                  ? { credentials: JSON.stringify(outcome.credentials) }
                  : {};
              if ("credentials" in outcome && outcome.credentials) {
                await log.info("Account credentials stored on the record, not logged", competition.id);
              }
              // A real success reaching the cap is the competition's final
              // state — mark it ENTERED so it stops being re-queried.
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
            count(outcome.status === "SKIPPED_ALREADY_ENTERED" ? "alreadyEntered" : "skipped");
            await log.warn(`${outcome.status}: ${competition.name} — ${outcome.message ?? ""}`, competition.id);
            await reportPageIssues();
            // Screenshots are for states we can't otherwise explain. Both
            // SKIPPED_* outcomes are ones the adapter understood and
            // described in its own message ("already entered today's
            // draw", "options were: X / Y / Z"), and both recur daily for
            // the same competitions — so they'd generate a steady stream
            // of near-identical images that add nothing to the log.
            if (!outcome.status.startsWith("SKIPPED_")) await captureScreenshot(outcome.status.toLowerCase());
            // A one-shot competition (maxEntries 1) whose adapter reports
            // SKIPPED_ALREADY_ENTERED on a real run means the site itself
            // is confirming its single entry cap was already reached by an
            // earlier run — even if that earlier run's own Entry record
            // never got marked SUCCESS (a confirmation-detection miss).
            // Daily-draw adapters (maxEntries > 1) are unaffected: "already
            // entered" there means "already entered today", and the entry
            // interval handles the wait.
            if (outcome.status === "SKIPPED_ALREADY_ENTERED" && !dryRun && competition.maxEntries === 1) {
              await prisma.competition.update({ where: { id: competition.id }, data: { status: "ENTERED" } });
              await log.info("Marking ENTERED — site confirms this one-shot competition's entry cap was already reached", competition.id);
            }
          }
        } catch (err) {
          count("failed");
          const message =
            err instanceof AdapterTimeout
              ? `Timed out — ${err.message}`
              : err instanceof Error
                ? err.message
                : String(err);
          await prisma.entry.create({
            data: { competitionId: competition.id, runId: run.id, status: "FAILED", message },
          });
          await log.error(`Failed: ${competition.name} — ${message}`, competition.id);
          await reportPageIssues();
          await captureScreenshot(err instanceof AdapterTimeout ? "timeout" : "exception");
        } finally {
          await page.close().catch(() => {});
        }
      }
    } finally {
      await browser.close();
    }

    const summary = Object.entries(tally)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ");
    await log.info(`Run finished in ${Math.round((Date.now() - startedAt) / 1000)}s — ${summary || "nothing to do"}`);
    await prisma.run.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date() } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log.error(`Run failed: ${message}`);
    await prisma.run.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), errorMessage: message },
    });
    throw err;
  } finally {
    await lock.release();
  }
}

runOnce()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
