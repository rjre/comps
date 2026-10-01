import { afterEach, describe, expect, it, vi } from "vitest";

const original = { warn: console.warn, error: console.error };

afterEach(() => {
  console.warn = original.warn;
  console.error = original.error;
  delete process.env.JOURNAL_STREAM;
  vi.resetModules();
});

describe("journalPriority", () => {
  it("prefixes every line of warn/error with its syslog priority under journald", async () => {
    const written: string[] = [];
    console.warn = (s: string) => void written.push(s);
    console.error = (s: string) => void written.push(s);
    process.env.JOURNAL_STREAM = "8:12345";
    await import("./journalPriority");

    console.warn("[WARN] FAILED: %s", "Colchester Zoo");
    console.error("boom\n    at x (/src/a.ts:1:1)");
    expect(written).toEqual(["<4>[WARN] FAILED: Colchester Zoo", "<3>boom\n<3>    at x (/src/a.ts:1:1)"]);
  });

  it("leaves the console alone outside journald", async () => {
    const warn = console.warn;
    await import("./journalPriority");
    expect(console.warn).toBe(warn);
  });
});
