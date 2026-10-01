import { describe, expect, it } from "vitest";
import { decideNewsletterAttempt, GIVE_UP_AFTER_CONSECUTIVE_FAILURES } from "./retry";

const now = new Date("2026-10-01T12:00:00Z");
const ago = (h: number) => new Date(now.getTime() - h * 3_600_000);
const F = (h: number) => ({ status: "FAILED", attemptedAt: ago(h) });

describe("decideNewsletterAttempt", () => {
  it("attempts a source with no history", () => {
    expect(decideNewsletterAttempt([], now).action).toBe("ATTEMPT");
  });
  it("retries straight away after one failure", () => {
    expect(decideNewsletterAttempt([F(0.1)], now).action).toBe("ATTEMPT");
  });
  it("waits an hour after two failures", () => {
    expect(decideNewsletterAttempt([F(0.5), F(2)], now).action).toBe("WAIT");
    expect(decideNewsletterAttempt([F(1.5), F(2)], now).action).toBe("ATTEMPT");
  });
  it("waits a day once failures pile up", () => {
    const five = [F(20), F(40), F(50), F(60), F(70)];
    expect(decideNewsletterAttempt(five, now).action).toBe("WAIT");
    expect(decideNewsletterAttempt(five.map((a) => ({ ...a, attemptedAt: ago(25) })), now).action).toBe("ATTEMPT");
  });
  it("gives up after enough consecutive failures", () => {
    const many = Array.from({ length: GIVE_UP_AFTER_CONSECUTIVE_FAILURES }, (_, i) => F(i * 30));
    expect(decideNewsletterAttempt(many, now).action).toBe("GIVE_UP");
  });
  it("only counts failures since the last success", () => {
    const history = [F(0.5), F(1), { status: "SUCCESS", attemptedAt: ago(2) }, ...Array.from({ length: 20 }, (_, i) => F(3 + i))];
    expect(decideNewsletterAttempt(history, now).action).toBe("WAIT");
  });
});
