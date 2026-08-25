import { prisma } from "@/lib/db";
import type { LogLevel } from "@/lib/status";

/**
 * A logger scoped to one Run. Every call both prints to the console (so a
 * cron/systemd-timer invocation still shows up in normal process logs) and
 * persists a LogLine row, so past runs can be reviewed in the dashboard
 * without re-running anything.
 */
export interface RunLogger {
  info(message: string, competitionId?: string): Promise<void>;
  warn(message: string, competitionId?: string): Promise<void>;
  error(message: string, competitionId?: string): Promise<void>;
}

const consoleFns: Record<LogLevel, (...args: unknown[]) => void> = {
  INFO: console.log,
  WARN: console.warn,
  ERROR: console.error,
};

export function createRunLogger(runId: string): RunLogger {
  async function write(level: LogLevel, message: string, competitionId?: string) {
    consoleFns[level](`[${level}] ${message}`);
    // Logging must never take down the run it's describing — a DB hiccup
    // here shouldn't turn a successful entry attempt into a failed run.
    try {
      await prisma.logLine.create({
        data: { runId, level, message, competitionId },
      });
    } catch (err) {
      console.error("Failed to persist log line", err);
    }
  }

  return {
    info: (message, competitionId) => write("INFO", message, competitionId),
    warn: (message, competitionId) => write("WARN", message, competitionId),
    error: (message, competitionId) => write("ERROR", message, competitionId),
  };
}
