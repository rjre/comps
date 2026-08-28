import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";

/**
 * A single-holder lock so two entry passes can never run at once.
 *
 * systemd won't start a second instance of a oneshot service, which made
 * this look unnecessary — but it only covers runs it started itself.
 * Observed directly: restarting the timer (with Persistent=true, so it
 * immediately fired a catch-up run) while a hand-started `npm run
 * run:entries` was still going left two passes entering the same
 * competitions simultaneously. On a daily prize draw that means two
 * entries in one day from one person, which is exactly what this project
 * is careful not to do.
 *
 * Deliberately a plain file rather than a dependency: the lock holder
 * writes its pid, and a lock whose pid is no longer alive is treated as
 * stale and taken over — so a run killed with SIGKILL (or the machine
 * losing power mid-pass) doesn't wedge the service until someone notices.
 */

const LOCK_DIR = path.join(process.cwd(), "data", "locks");

/** Belt and braces for the case where the pid was recycled by an unrelated process. */
const MAX_LOCK_AGE_MS = 2 * 60 * 60_000;

interface LockFile {
  pid: number;
  startedAt: string;
}

function isAlive(pid: number): boolean {
  try {
    // Signal 0 performs the permission/existence check without signalling.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLock(file: string): Promise<LockFile | null> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as LockFile;
  } catch {
    return null;
  }
}

export interface HeldLock {
  release(): Promise<void>;
}

/**
 * Returns null when another live process already holds `name` — callers
 * should exit quietly in that case, not fail: the other pass is doing the
 * work, and the next scheduled cycle will pick up whatever it didn't reach.
 */
export async function acquireLock(name: string): Promise<HeldLock | null> {
  await mkdir(LOCK_DIR, { recursive: true });
  const file = path.join(LOCK_DIR, `${name}.lock`);
  const mine: LockFile = { pid: process.pid, startedAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(file, JSON.stringify(mine), { flag: "wx" });
      return {
        release: async () => {
          // Only ever remove our own lock — if it's been taken over as
          // stale in the meantime, the new holder's lock must survive.
          const current = await readLock(file);
          if (current?.pid === process.pid) await unlink(file).catch(() => {});
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const held = await readLock(file);
      const stale =
        held === null ||
        !isAlive(held.pid) ||
        Date.now() - new Date(held.startedAt).getTime() > MAX_LOCK_AGE_MS;
      if (!stale) return null;
      console.warn(`Taking over a stale ${name} lock (pid ${held?.pid ?? "unknown"} is gone or too old)`);
      await unlink(file).catch(() => {});
    }
  }
  return null;
}
