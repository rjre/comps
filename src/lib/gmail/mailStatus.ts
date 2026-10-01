import fs from "fs";
import path from "path";

/**
 * How the last mail pass went, kept where the dashboard can read it.
 *
 * The mail pass doesn't create Run rows, so without this a dead mailbox is
 * visible only in the journal. That's how an expired Gmail token went
 * unnoticed from 2026-09-29: entries kept running and the health pill
 * stayed green.
 */
const STATUS_FILE = path.join(process.cwd(), "data", "mail-status.json");

export interface MailStatus {
  at: string;
  ok: boolean;
  backend: string;
  error?: string;
  /** When the last successful pass finished, carried across failures. */
  lastOkAt?: string;
}

export function readMailStatus(): MailStatus | null {
  try {
    return JSON.parse(fs.readFileSync(STATUS_FILE, "utf-8")) as MailStatus;
  } catch {
    return null;
  }
}

export function recordMailPass(backend: string, error?: string): void {
  const now = new Date().toISOString();
  const previous = readMailStatus();
  const status: MailStatus = {
    at: now,
    ok: !error,
    backend,
    ...(error ? { error } : {}),
    lastOkAt: error ? previous?.lastOkAt : now,
  };
  try {
    fs.mkdirSync(path.dirname(STATUS_FILE), { recursive: true });
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
  } catch (err) {
    console.error("Could not write mail status:", err instanceof Error ? err.message : err);
  }
}
