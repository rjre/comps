// SQLite has no native enum support in Prisma, so Competition.status and
// Entry.status are plain strings in the schema — these unions are the
// source of truth for the allowed values instead.

export type CompetitionStatus = "PENDING" | "ENTERED" | "SKIPPED" | "FAILED" | "CLOSED";

export type EntryStatus = "SUCCESS" | "FAILED" | "SKIPPED_ALREADY_ENTERED" | "SKIPPED_RULES";
