// Assertions over the DMRI quiz-answer derivation, run with `npm test`.
// The copy below is verbatim from a live comps.marieclaire.co.uk
// competition page (122488, the Hyllside Spa Suite draw), so these test
// the real shape of the platform's prose rather than an invented one.
import { appearsInCopy, deriveAnswerFromCopy, rejectedAnswers } from "./dmriComps";

const COPY = `Discover an exciting new luxury escape in the heart of the Yorkshire Dales National Park with
Aysgarth Falls Hotel's brand new Hyllside Spa Suites. Launching in September 2026, the collection of
beautifully designed suites sit between the iconic Aysgarth Falls and the hotel's historic main house,
offering a peaceful retreat inspired by the surrounding landscape. Each spacious Spa Suite has been
thoughtfully crafted with indulgence in mind. The collection features three distinctive interior styles:
Classic, Contemporary and Traditional. Inside, guests can unwind in a luxurious steam room with double
vanity units, while outside, each spacious private terrace features a striking freestanding copper spa
bath with jets. This competition ends on 21/09/2026.`;

let fails = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
}
const derive = (options: string[], rejected: string[] = []) =>
  deriveAnswerFromCopy(options, COPY, new Set(rejected));

check("word answer present in copy", appearsInCopy("Yorkshire Dales", COPY), true);
check("word answer absent from copy", appearsInCopy("Peak District", COPY), false);
check("digit option matches the word in the copy", appearsInCopy("3", COPY), true);
check("wrong digit doesn't match", appearsInCopy("7", COPY), false);
check("substring alone is not a match", appearsInCopy("Class", COPY), false);
check("exact word inside a list is a match", appearsInCopy("Contemporary", COPY), true);

// Observed live: the option list writes "A Waffi Space Saver Cot and
// Mattress" where the copy writes "Waffi Space Saver Cot & Mattress".
const AMPERSAND_COPY = "Win the award-winning Waffi Space Saver Cot & Mattress, designed for small rooms.";
check("leading article stripped", appearsInCopy("A Waffi Space Saver Cot and Mattress", AMPERSAND_COPY), true);
check("ampersand in copy matches 'and' in the option", appearsInCopy("Cot and Mattress", AMPERSAND_COPY), true);
check("curly apostrophe in copy matches a straight one", appearsInCopy("One4all's birthday", "Celebrate One4all\u2019s birthday"), true);
check("normalising doesn't make an absent option match", appearsInCopy("A pushchair and changing bag", AMPERSAND_COPY), false);

check("single match derives", derive(["Peak District", "Yorkshire Dales", "Lake District"]), { answer: "Yorkshire Dales" });
check("numeric question derives via number word", derive(["2", "3", "8"]), { answer: "3" });
check(
  "no match declines",
  derive(["Snowdonia", "Exmoor"]),
  { answer: null, reason: "none of the options (Snowdonia / Exmoor) appear in the competition's own copy" },
);
check(
  "ambiguous copy declines",
  derive(["Classic", "Traditional"]),
  { answer: null, reason: "the copy is ambiguous — Classic and Traditional all appear in it" },
);
check(
  "a previously rejected option is excluded, disambiguating the rest",
  derive(["Classic", "Traditional"], ["classic"]),
  { answer: "Traditional" },
);
check(
  "all options exhausted declines",
  derive(["Classic", "Traditional"], ["classic", "traditional"]),
  { answer: null, reason: "every offered option has already been rejected as incorrect by the site" },
);

check(
  "rejected answers parsed out of prior entry messages",
  [...rejectedAnswers([
    { message: 'Answer "Classic" was rejected as incorrect' },
    { message: "Your answer was correct! You have been entered" },
    { message: null },
    { message: 'Answer "93" was rejected as incorrect' },
  ])],
  ["classic", "93"],
);

console.log(fails === 0 ? "\nALL PASS" : `\n${fails} FAILED`);
process.exitCode = fails ? 1 : 0;
