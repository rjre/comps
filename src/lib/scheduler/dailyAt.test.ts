import { describe, expect, it } from "vitest";
import { msUntilNextHour } from "./dailyAt";

describe("msUntilNextHour", () => {
  it("counts forward to later today when the hour hasn't happened yet", () => {
    const now = new Date(2026, 0, 1, 1, 0, 0); // 01:00
    expect(msUntilNextHour(2, now)).toBe(60 * 60_000); // 1h to 02:00
  });

  it("rolls over to tomorrow when the hour has already passed today", () => {
    const now = new Date(2026, 0, 1, 3, 0, 0); // 03:00
    expect(msUntilNextHour(2, now)).toBe(23 * 60 * 60_000); // 23h to tomorrow 02:00
  });

  it("rolls over to tomorrow when it's exactly that hour right now", () => {
    const now = new Date(2026, 0, 1, 2, 0, 0, 0); // exactly 02:00:00.000
    expect(msUntilNextHour(2, now)).toBe(24 * 60 * 60_000);
  });
});
