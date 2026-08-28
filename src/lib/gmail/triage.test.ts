import { describe, expect, it } from "vitest";
import { categorise, extractCompetitionLinks, looksLikeWin } from "./triage";

const input = (subject: string, body = "", from = "news@example.com") => ({ from, subject, body });

describe("looksLikeWin", () => {
  it("catches a plain win notification", () => {
    expect(looksLikeWin(input("You've won!", "Congratulations, you have won a weekend break."))).toBe(true);
  });

  it("catches a claim-your-prize notification", () => {
    expect(looksLikeWin(input("Action needed", "Please claim your prize within 14 days."))).toBe(true);
  });

  // The failure that matters: comping newsletters are wall-to-wall
  // "you could win", and treating those as wins would bury a real one.
  it("does not treat marketing 'you could win' as a win", () => {
    expect(looksLikeWin(input("This week's competitions", "You could win a holiday! Enter now."))).toBe(false);
  });

  it("does not treat 'chance to win' as a win", () => {
    expect(looksLikeWin(input("Newsletter", "Congratulations, you have a chance to win a car."))).toBe(false);
  });

  it("still catches a win whose footer promotes the next draw", () => {
    expect(
      looksLikeWin(input("You have won our August prize draw", "Details inside. Next month: win a spa break!")),
    ).toBe(true);
  });

  it("ignores an unrelated email", () => {
    expect(looksLikeWin(input("Your order has shipped", "Tracking number 12345."))).toBe(false);
  });
});

describe("extractCompetitionLinks", () => {
  it("finds a competition link in an HTML body", () => {
    const links = extractCompetitionLinks('<a href="https://example.com/competitions/win-a-car">Enter</a>');
    expect(links.map((l) => l.url)).toEqual(["https://example.com/competitions/win-a-car"]);
  });

  it("strips tracking parameters so the same competition isn't registered twice", () => {
    const links = extractCompetitionLinks(
      '<a href="https://example.com/competition/x?utm_source=mail&utm_campaign=aug&id=7">Enter</a>',
    );
    expect(links.map((l) => l.url)).toEqual(["https://example.com/competition/x?id=7"]);
  });

  it("deduplicates the same link appearing as button and text", () => {
    const body = '<a href="https://example.com/giveaway/1">Enter</a> https://example.com/giveaway/1';
    expect(extractCompetitionLinks(body)).toHaveLength(1);
  });

  it("ignores unsubscribe and preference links", () => {
    const body = '<a href="https://example.com/competition/unsubscribe">Unsubscribe</a>';
    expect(extractCompetitionLinks(body)).toEqual([]);
  });

  it("ignores social and shortener links", () => {
    const body =
      '<a href="https://facebook.com/win-a-car">fb</a><a href="https://bit.ly/win-a-car">short</a>';
    expect(extractCompetitionLinks(body)).toEqual([]);
  });

  it("ignores ordinary navigation links with no competition signal", () => {
    expect(extractCompetitionLinks('<a href="https://example.com/about-us">About</a>')).toEqual([]);
  });

  it("ignores image assets even when the filename mentions winning", () => {
    expect(extractCompetitionLinks('<img src="https://example.com/win-a-car.png">')).toEqual([]);
  });
});

describe("categorise", () => {
  it("prefers WIN over LEADS when an email is both", () => {
    const result = categorise(
      input("You have won!", '<a href="https://example.com/competition/next">More competitions</a>'),
    );
    expect(result.category).toBe("WIN");
  });

  it("returns LEADS for a newsletter carrying competition links", () => {
    const result = categorise(input("This week", '<a href="https://example.com/competition/a">Enter</a>'));
    expect(result.category).toBe("LEADS");
    expect(result.links).toHaveLength(1);
  });

  it("returns NOTHING for an email with neither", () => {
    expect(categorise(input("Your receipt", "Thanks for your order.")).category).toBe("NOTHING");
  });
});
