import { describe, expect, it } from "vitest";
import { decideSchedule } from "./schedule";

// The scheduler is pure over a competition's entry history, which is what
// makes it worth testing directly: every one of these cases is a real
// situation the live service hit before the pacing rules existed.
describe("decideSchedule", () => {
  const now = new Date("2026-08-28T12:00:00Z");
  const ago = (h: number) => new Date(now.getTime() - h * 3600_000);
  const E = (status: any, h: number, dryRun = false) => ({ status, attemptedAt: ago(h), dryRun });
  const daily = { maxEntries: 30, entryIntervalHours: null, closesAt: new Date("2026-09-20T00:00:00Z") };
  const once = { maxEntries: 1, entryIntervalHours: null, closesAt: null };

  it("daily, entered 2h ago", () => {
    expect(decideSchedule(daily, [E("SUCCESS", 2)], now).action).toBe("WAIT");
  });
  it("daily, entered 25h ago", () => {
    expect(decideSchedule(daily, [E("SUCCESS", 25)], now).action).toBe("ENTER");
  });
  it("daily, site said already-entered 3h ago", () => {
    expect(decideSchedule(daily, [E("SKIPPED_ALREADY_ENTERED", 3)], now).action).toBe("WAIT");
  });
  it("daily, never entered", () => {
    expect(decideSchedule(daily, [], now).action).toBe("ENTER");
  });
  it("daily, dry run only", () => {
    expect(decideSchedule(daily, [E("SUCCESS", 1, true)], now).action).toBe("ENTER");
  });
  it("daily, failure 30m ago", () => {
    expect(decideSchedule(daily, [E("FAILED", 0.5), E("SUCCESS", 30)], now).action).toBe("WAIT");
  });
  it("daily, failure 2h ago (1h backoff spent)", () => {
    expect(decideSchedule(daily, [E("FAILED", 2), E("SUCCESS", 30)], now).action).toBe("ENTER");
  });
  it("daily, 3 failures 3h ago (4h backoff)", () => {
    expect(decideSchedule(daily, [E("FAILED", 3), E("FAILED", 9), E("FAILED", 15)], now).action).toBe("WAIT");
  });
  it("daily, failure after recent success -> interval still holds", () => {
    expect(decideSchedule(daily, [E("FAILED", 3), E("SUCCESS", 5)], now).action).toBe("WAIT");
  });
  it("daily, 12 consecutive failures", () => {
    expect(decideSchedule(daily, Array.from({length:12},(_,i)=>E("FAILED", 30+i*24)), now).action).toBe("GIVE_UP");
  });
  it("daily, 12 failures but a success in between", () => {
    expect(decideSchedule(daily, [...Array.from({length:6},(_,i)=>E("FAILED", 30+i*24)), E("SUCCESS", 200), ...Array.from({length:6},(_,i)=>E("FAILED", 300+i*24))], now).action).toBe("ENTER");
  });
  it("closed", () => {
    expect(decideSchedule({ ...daily, closesAt: ago(1) }, [], now).action).toBe("CLOSE");
  });
  it("one-shot cap reached", () => {
    expect(decideSchedule(once, [E("SUCCESS", 100)], now).action).toBe("CAP_REACHED");
  });
  it("one-shot never entered", () => {
    expect(decideSchedule(once, [], now).action).toBe("ENTER");
  });
  it("one-shot after a failure 10m ago", () => {
    expect(decideSchedule(once, [E("FAILED", 0.16)], now).action).toBe("WAIT");
  });
  it("SKIPPED_RULES rechecks daily, not every pass", () => {
    expect(decideSchedule(once, [E("SKIPPED_RULES", 2)], now).action).toBe("WAIT");
  });
  it("SKIPPED_RULES recheck due after 25h", () => {
    expect(decideSchedule(once, [E("SKIPPED_RULES", 25)], now).action).toBe("ENTER");
  });
  it("SKIPPED_RULES doesn't trigger failure backoff", () => {
    expect(decideSchedule(once, [E("SKIPPED_RULES", 25), ...Array.from({length:12},(_,i)=>E("FAILED", 30+i*24))], now).action).toBe("ENTER");
  });
  it("explicit 6h interval, entered 7h ago", () => {
    expect(decideSchedule({ ...daily, entryIntervalHours: 6 }, [E("SUCCESS", 7)], now).action).toBe("ENTER");
  });
});
