import { chromium } from "playwright";
import { mkdir } from "fs/promises";
import path from "path";
import { prisma } from "@/lib/db";
import { getNewsletterAdapter } from "@/lib/newsletters/registry";
import { createRunLogger } from "@/lib/logger";

const SCREENSHOT_DIR = path.join(process.cwd(), "data", "screenshots");

/**
 * Runs one pass over pending newsletter sources — mirrors runOnce.ts for
 * competitions. Explicitly opt-in only: every NewsletterSource here was
 * added because the user directly asked to be signed up for that
 * organisation's own newsletter, not because an adapter decided to on
 * their behalf.
 *
 * Set DRY_RUN=1 to have adapters fill the form without submitting.
 */
async function subscribeNewsletters() {
  const dryRun = process.env.DRY_RUN === "1";
  const run = await prisma.run.create({ data: { dryRun } });
  const log = createRunLogger(run.id);

  try {
    await log.info(`Newsletter subscription run started${dryRun ? " (dry run)" : ""}`);

    const profile = await prisma.profile.findFirst();
    if (!profile) {
      await log.error("No profile configured yet — set one up at /profile first.");
      await prisma.run.update({
        where: { id: run.id },
        data: { status: "FAILED", finishedAt: new Date(), errorMessage: "No profile configured" },
      });
      return;
    }

    const candidates = await prisma.newsletterSource.findMany({ where: { status: "PENDING" } });
    await prisma.run.update({ where: { id: run.id }, data: { candidateCount: candidates.length } });

    if (candidates.length === 0) {
      await log.info("No pending newsletter sources to subscribe to.");
      await prisma.run.update({ where: { id: run.id }, data: { status: "COMPLETED", finishedAt: new Date() } });
      return;
    }

    await log.info(`${candidates.length} pending newsletter source(s) found.`);
    await mkdir(SCREENSHOT_DIR, { recursive: true });

    const browser = await chromium.launch();
    try {
      for (const source of candidates) {
        const adapter = getNewsletterAdapter(source.adapterKey);
        if (!adapter) {
          await log.warn(`No newsletter adapter registered for "${source.adapterKey}", skipping ${source.name}`);
          continue;
        }

        await log.info(`Subscribing to "${source.name}" via adapter "${adapter.key}" (${source.url})`);
        const page = await browser.newPage();
        try {
          const outcome = await adapter.subscribe({ page, sourceUrl: source.url, profile, log, dryRun });
          await prisma.subscriptionAttempt.create({
            data: {
              newsletterSourceId: source.id,
              runId: run.id,
              status: outcome.status,
              message: "message" in outcome ? outcome.message : undefined,
            },
          });
          if (outcome.status === "SUCCESS" && !dryRun) {
            await prisma.newsletterSource.update({ where: { id: source.id }, data: { status: "SUBSCRIBED" } });
            await log.info(`Subscribed: ${source.name}`);
          } else if (outcome.status === "SUCCESS") {
            await log.info(`Entered (dry run): ${source.name}`);
          } else {
            await log.warn(`${outcome.status}: ${source.name} — ${outcome.message ?? ""}`);
            const file = path.join(SCREENSHOT_DIR, `${run.id}_${source.id}_failed.png`);
            await page.screenshot({ path: file, fullPage: true }).catch(() => {});
            await log.info(`Saved screenshot: ${file}`);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          await prisma.subscriptionAttempt.create({
            data: { newsletterSourceId: source.id, runId: run.id, status: "FAILED", message },
          });
          await log.error(`Failed: ${source.name} — ${message}`);
          const file = path.join(SCREENSHOT_DIR, `${run.id}_${source.id}_exception.png`);
          await page.screenshot({ path: file, fullPage: true }).catch(() => {});
        } finally {
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }

    await log.info("Newsletter subscription run finished.");
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

subscribeNewsletters()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
