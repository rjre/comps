import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

/**
 * SQLite's default rollback-journal mode takes a database-wide lock for
 * the duration of a write, which serializes badly against this app's
 * several independent concurrent loops (discovery, entries, newsletters,
 * mail scan) all writing to the same file — that's what turned a mail
 * pass's single `processedEmail.create()` into a 5s timeout the moment it
 * landed alongside a busy entries pass. WAL lets readers and writers run
 * without blocking each other; the raised busy_timeout is a backstop for
 * the writer-vs-writer contention WAL doesn't remove. journal_mode is
 * persisted in the database file, so this is a no-op after the first run;
 * busy_timeout is per-connection and has to be set every time.
 */
// $queryRawUnsafe, not $executeRawUnsafe: SQLite's PRAGMA statements
// return the value they set as a result row, and Prisma's SQLite driver
// rejects a row-returning statement run through $executeRawUnsafe.
prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL;").catch((err) => {
  console.error("Could not enable WAL journal mode:", err);
});
prisma.$queryRawUnsafe("PRAGMA busy_timeout=30000;").catch((err) => {
  console.error("Could not set busy_timeout:", err);
});
