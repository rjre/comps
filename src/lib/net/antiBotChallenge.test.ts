import { describe, expect, it } from "vitest";
import { isAntiBotChallengeTitle } from "./antiBotChallenge";

describe("isAntiBotChallengeTitle", () => {
  it("recognises Cloudflare's 'Just a moment...' interstitial", () => {
    expect(isAntiBotChallengeTitle("Just a moment...")).toBe(true);
  });

  it("recognises 'Attention Required!'", () => {
    expect(isAntiBotChallengeTitle("Attention Required! | Cloudflare")).toBe(true);
  });

  it("recognises 'Checking your browser'", () => {
    expect(isAntiBotChallengeTitle("Checking your browser before accessing example.com")).toBe(true);
  });

  it("recognises 'Verifying you are human'", () => {
    expect(isAntiBotChallengeTitle("Verifying you are human. This may take a few seconds.")).toBe(true);
  });

  it("recognises 'Access denied'", () => {
    expect(isAntiBotChallengeTitle("Access Denied")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isAntiBotChallengeTitle("JUST A MOMENT...")).toBe(true);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isAntiBotChallengeTitle("  Just a moment...  ")).toBe(true);
  });

  it("does not flag an ordinary competition page title", () => {
    expect(isAntiBotChallengeTitle("Win a Luxury Weekend Break | Example Magazine")).toBe(false);
  });

  it("does not flag a title that merely mentions a browser check partway through", () => {
    expect(isAntiBotChallengeTitle("Help Centre — Checking your browser settings")).toBe(false);
  });

  it("does not match an empty title", () => {
    expect(isAntiBotChallengeTitle("")).toBe(false);
  });
});
