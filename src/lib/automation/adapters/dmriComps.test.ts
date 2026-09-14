import { describe, expect, it } from "vitest";
import { answerNote, appearsInCopy, copyOverlap, deriveAnswerFromCopy, questionKey, rejectedAnswers, sharedAnswerFor } from "./dmriComps";

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
    expect(derive(["Peak District", "Yorkshire Dales", "Lake District"]).answer).toEqual("Yorkshire Dales");
  });
  it("numeric question derives via number word", () => {
    expect(derive(["2", "3", "8"]).answer).toEqual("3");
  });
  it("no match declines", () => {
    const declined = derive(["Snowdonia", "Exmoor"]);
    expect(declined.answer).toEqual(null);
    expect("reason" in declined && declined.reason).toContain("none of the options (Snowdonia / Exmoor) appear in the competition's own copy");
  });
  it("ambiguous copy declines", () => {
    expect(derive(["Classic", "Traditional"])).toEqual({ answer: null, reason: "the copy is ambiguous — Classic and Traditional all appear in it" });
  });
  it("a previously rejected option is excluded, disambiguating the rest", () => {
    expect(derive(["Classic", "Traditional"], ["classic"]).answer).toEqual("Traditional");
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

// Both blocks below are verbatim from live pages, reached by picking two
// competitions the adapter had actually declined and fetching what it
// would have read. They're the two distinct cases: an answer the copy
// does contain but doesn't quote, and an answer the copy simply doesn't
// hold. The derivation has to take the first and refuse the second.
describe("DMRI quiz-answer derivation, overlap fallback", () => {
  // comps.lifedeathprizes.com/.../an_apple_watch_se__with_neutradol_network/122787.php
  const NEUTRADOL = `This September, Neutradol is giving you the chance to win an Apple Watch SE 3, plus a
  cosy-season bundle of carpet deodorizer, room spray, gel orb, and bin deodorizer. While many big name air
  fresheners simply mask odours with perfume, Neutradol targets and destroys the molecules that cause them at
  the source. Also available from Neutradol in Original and Pink Fresh fragrances are Air Freshener Gel Orbs
  and Carpet & Upholstery Smart Foams, ideal for freshening up as muddy paws and damp coats become a daily
  reality.`;
  const NEUTRADOL_OPTIONS = [
    "Normal, Petal Pink and Green Grass",
    "Fresh Pink, Original and Super Fresh",
    "Super Green, Bold Blue and Pretty Pink",
  ];

  // competitions.goodto.com/.../a_luxury_one_night_stay_at_holiday_inn_oxford__goodtoknow/122751.php
  const OXFORD = `Holiday Inn Oxford is ideally located for exploring the historic city, with Oxford
  University's iconic colleges, the Ashmolean Museum and Oxford Castle all within easy reach. Guests can also
  visit the magnificent Blenheim Palace, making it the perfect base for a relaxing Oxford getaway. After a day
  of exploring, unwind in the hotel's stylish Open Lobby, with a cafe, lounge and dining space.`;
  const OXFORD_OPTIONS = ["The City of Dreaming Spires", "The City of Seven Hills", "The Emerald City"];

  it("no Neutradol option is quoted word-for-word", () => {
    for (const option of NEUTRADOL_OPTIONS) expect(appearsInCopy(option, NEUTRADOL)).toEqual(false);
  });
  it("but the copy plainly contains one of them, and the overlap says which", () => {
    const [wrongA, right, wrongB] = NEUTRADOL_OPTIONS as [string, string, string];
    expect(copyOverlap(right, NEUTRADOL)).toBeGreaterThan(copyOverlap(wrongA, NEUTRADOL));
    expect(copyOverlap(right, NEUTRADOL)).toBeGreaterThan(copyOverlap(wrongB, NEUTRADOL));
  });
  it("derives the Neutradol answer the exact matcher threw away", () => {
    const derived = deriveAnswerFromCopy(NEUTRADOL_OPTIONS, NEUTRADOL, new Set());
    expect(derived.answer).toEqual("Fresh Pink, Original and Super Fresh");
  });

  // The whole point of the two thresholds: "The Emerald City" scores
  // highest here purely on the shared word "city", and is wrong. A floor
  // alone or a margin alone would submit it.
  it("declines Oxford, whose true answer is general knowledge and absent", () => {
    const derived = deriveAnswerFromCopy(OXFORD_OPTIONS, OXFORD, new Set());
    expect(derived.answer).toEqual(null);
  });
  it("says how close the closest option got, so a decline is researchable", () => {
    const derived = deriveAnswerFromCopy(OXFORD_OPTIONS, OXFORD, new Set());
    expect("reason" in derived && derived.reason).toContain("closest was");
  });

  it("ignores stopwords rather than scoring every option on \"the\" and \"and\"", () => {
    expect(copyOverlap("The Emerald City", "an emerald the and of")).toEqual(0.5);
  });
  it("counts a digit and its number word as the same token", () => {
    expect(copyOverlap("3 suites", "the collection features three suites")).toEqual(1);
  });
  it("an option of nothing but stopwords scores zero rather than dividing by zero", () => {
    expect(copyOverlap("the and of", NEUTRADOL)).toEqual(0);
  });
});

// The DMRI platform runs one competition across up to eleven sibling
// magazine sites at once — the same question and options on each, drawing
// independent winners. What one site establishes, the others can use.
describe("DMRI cross-site answer sharing", () => {
  const OPTIONS = ["Café-quality coffees", "Smoothies", "Cocktails"];
  const peer = (status: any, message: string) => ({ status, message });
  const success = (answer: string, options = OPTIONS) =>
    peer("SUCCESS", `Your answer was correct! You have been entered. ${answerNote(answer, options)}`);
  const rejection = (answer: string, options = OPTIONS) =>
    peer("FAILED", `Answer "${answer}" was rejected as incorrect (options: ${options.join(" / ")})`);

  it("a sibling's confirmed answer is reused", () => {
    expect(sharedAnswerFor(OPTIONS, [success("Smoothies")]).confirmed).toEqual("Smoothies");
  });
  it("option order differing between sites still matches the same question", () => {
    const reordered = ["Cocktails", "Café-quality coffees", "Smoothies"];
    expect(sharedAnswerFor(reordered, [success("Smoothies")]).confirmed).toEqual("Smoothies");
  });
  it("a different question's answer is not borrowed", () => {
    const other = success("Ben Nevis", ["Ben Nevis", "Snowdon", "Scafell Pike"]);
    expect(sharedAnswerFor(OPTIONS, [other]).confirmed).toEqual(null);
  });
  it("an answer merely attempted, not confirmed, is not treated as correct", () => {
    const attempted = peer("SKIPPED_RULES", `No verified answer available; options were: ${OPTIONS.join(" / ")}`);
    expect(sharedAnswerFor(OPTIONS, [attempted]).confirmed).toEqual(null);
  });
  it("a rejection on one site rules the answer out everywhere", () => {
    expect([...sharedAnswerFor(OPTIONS, [rejection("Cocktails")]).rejected]).toEqual(["cocktails"]);
  });
  it("rejections accumulate across several sibling sites", () => {
    const shared = sharedAnswerFor(OPTIONS, [rejection("Cocktails"), rejection("Smoothies")]);
    expect([...shared.rejected].sort()).toEqual(["cocktails", "smoothies"]);
  });
  it("a contradicted answer is trusted from neither side", () => {
    const shared = sharedAnswerFor(OPTIONS, [success("Cocktails"), rejection("Cocktails")]);
    expect(shared.confirmed).toEqual(null);
  });
  it("peer rejections feed the derivation's exclusion list", () => {
    // Two options are quoted in the copy, which alone is ambiguous; a
    // sibling having ruled one out settles it.
    const copy = "Enjoy Smoothies or Cocktails at the bar.";
    expect(deriveAnswerFromCopy(OPTIONS, copy, new Set()).answer).toEqual(null);
    expect(deriveAnswerFromCopy(OPTIONS, copy, new Set(["cocktails"])).answer).toEqual("Smoothies");
  });
  it("questionKey ignores punctuation and case the sites spell differently", () => {
    expect(questionKey(["A & B", "C\u2019s"])).toEqual(questionKey(["c's", "a and b"]));
  });
  it("an unparseable peer message is ignored rather than throwing", () => {
    expect(sharedAnswerFor(OPTIONS, [peer("SUCCESS", "Entered"), peer("FAILED", null as any)]).confirmed).toEqual(null);
  });
});
