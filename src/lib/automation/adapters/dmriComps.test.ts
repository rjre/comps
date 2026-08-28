import { describe, expect, it } from "vitest";
import { appearsInCopy, deriveAnswerFromCopy, rejectedAnswers } from "./dmriComps";

// The copy below is verbatim from a live comps.marieclaire.co.uk
// competition page (122488, the Hyllside Spa Suite draw), so these test
// the real shape of the platform's prose rather than an invented one.
describe("DMRI quiz-answer derivation", () => {
  const COPY = `Discover an exciting new luxury escape in the heart of the Yorkshire Dales National Park with
  Aysgarth Falls Hotel's brand new Hyllside Spa Suites. Launching in September 2026, the collection of
  beautifully designed suites sit between the iconic Aysgarth Falls and the hotel's historic main house,
  offering a peaceful retreat inspired by the surrounding landscape. Each spacious Spa Suite has been
  thoughtfully crafted with indulgence in mind. The collection features three distinctive interior styles:
  Classic, Contemporary and Traditional. Inside, guests can unwind in a luxurious steam room with double
  vanity units, while outside, each spacious private terrace features a striking freestanding copper spa
  bath with jets. This competition ends on 21/09/2026.`;

  const derive = (options: string[], rejected: string[] = []) =>
    deriveAnswerFromCopy(options, COPY, new Set(rejected));

  it("word answer present in copy", () => {
    expect(appearsInCopy("Yorkshire Dales", COPY)).toEqual(true);
  });
  it("word answer absent from copy", () => {
    expect(appearsInCopy("Peak District", COPY)).toEqual(false);
  });
  it("digit option matches the word in the copy", () => {
    expect(appearsInCopy("3", COPY)).toEqual(true);
  });
  it("wrong digit doesn't match", () => {
    expect(appearsInCopy("7", COPY)).toEqual(false);
  });
  it("substring alone is not a match", () => {
    expect(appearsInCopy("Class", COPY)).toEqual(false);
  });
  it("exact word inside a list is a match", () => {
    expect(appearsInCopy("Contemporary", COPY)).toEqual(true);
  });

  // Observed live: the option list writes "A Waffi Space Saver Cot and
  // Mattress" where the copy writes "Waffi Space Saver Cot & Mattress".
  const AMPERSAND_COPY = "Win the award-winning Waffi Space Saver Cot & Mattress, designed for small rooms.";
  it("leading article stripped", () => {
    expect(appearsInCopy("A Waffi Space Saver Cot and Mattress", AMPERSAND_COPY)).toEqual(true);
  });
  it("ampersand in copy matches 'and' in the option", () => {
    expect(appearsInCopy("Cot and Mattress", AMPERSAND_COPY)).toEqual(true);
  });
  it("curly apostrophe in copy matches a straight one", () => {
    expect(appearsInCopy("One4all's birthday", "Celebrate One4all\u2019s birthday")).toEqual(true);
  });
  it("normalising doesn't make an absent option match", () => {
    expect(appearsInCopy("A pushchair and changing bag", AMPERSAND_COPY)).toEqual(false);
  });

  it("single match derives", () => {
    expect(derive(["Peak District", "Yorkshire Dales", "Lake District"])).toEqual({ answer: "Yorkshire Dales" });
  });
  it("numeric question derives via number word", () => {
    expect(derive(["2", "3", "8"])).toEqual({ answer: "3" });
  });
  it("no match declines", () => {
    expect(derive(["Snowdonia", "Exmoor"])).toEqual({ answer: null, reason: "none of the options (Snowdonia / Exmoor) appear in the competition's own copy" });
  });
  it("ambiguous copy declines", () => {
    expect(derive(["Classic", "Traditional"])).toEqual({ answer: null, reason: "the copy is ambiguous — Classic and Traditional all appear in it" });
  });
  it("a previously rejected option is excluded, disambiguating the rest", () => {
    expect(derive(["Classic", "Traditional"], ["classic"])).toEqual({ answer: "Traditional" });
  });
  it("all options exhausted declines", () => {
    expect(derive(["Classic", "Traditional"], ["classic", "traditional"])).toEqual({
      answer: null,
      reason: "every offered option has already been rejected as incorrect by the site",
    });
  });
  it("rejected answers parsed out of prior entry messages", () => {
    expect([
      ...rejectedAnswers([
        { message: 'Answer "Classic" was rejected as incorrect' },
        { message: "Your answer was correct! You have been entered" },
        { message: null },
        { message: 'Answer "93" was rejected as incorrect' },
      ]),
    ]).toEqual(["classic", "93"]);
  });
});
