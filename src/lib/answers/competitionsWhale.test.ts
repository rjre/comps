import { describe, expect, it } from "vitest";
import { listingPagesFor, parseAnswers, recentDayPaths } from "./competitionsWhale";

// Markup below keeps the real page's shape: cards delimited by their own
// id, one outbound competition link each, the answer in a labelled span,
// and the site's own chrome links mixed in — which is what the parser has
// to not mistake for the competition.
const CARD = (id: string, url: string, answer: string | null, extra = "") => `
  <div class="card my-5" id="comp-card-${id}">
    <a href="https://www.competitions-whale.co.uk/tag/tech">Tech</a>
    <a href="https://res.cloudinary.com/lesedu/image/upload/preview/${id}.jpg">image</a>
    <div class="card-body">
      <p><span class="fw-bold">Question:</span> How many devices does it support? </p>
      ${answer === null ? "" : `<p> <span class="fw-bold">Suggested Answer:</span> ${answer} </p>`}
      ${extra}
    </div>
    <a class="btn" href="${url}">Enter</a>
  </div>`;

describe("competitions-whale answer parsing", () => {
  it("pairs each card's competition URL with its own answer", () => {
    const html =
      CARD("1", "https://comps.marieclaire.co.uk/competition/a_thing_marieclaire/122613.php", "93") +
      CARD("2", "https://competitions.stuff.tv/competition/a_thermometer_stuff/122764.php", "Sub 1G");
    expect([...parseAnswers(html)]).toEqual([
      ["https://comps.marieclaire.co.uk/competition/a_thing_marieclaire/122613.php", "93"],
      ["https://competitions.stuff.tv/competition/a_thermometer_stuff/122764.php", "Sub 1G"],
    ]);
  });

  // The failure that would matter most: an answer silently attached to the
  // neighbouring competition would submit a confidently wrong answer.
  it("a card with no answer takes no answer from its neighbour", () => {
    const html =
      CARD("1", "https://comps.marieclaire.co.uk/competition/no_answer_here/1.php", null) +
      CARD("2", "https://comps.marieclaire.co.uk/competition/has_one/2.php", "Cornwall");
    const parsed = parseAnswers(html);
    expect(parsed.get("https://comps.marieclaire.co.uk/competition/no_answer_here/1.php")).toBeUndefined();
    expect(parsed.get("https://comps.marieclaire.co.uk/competition/has_one/2.php")).toEqual("Cornwall");
  });

  it("ignores the site's own links, images and ad hosts when picking the competition", () => {
    const html = CARD("1", "https://comps.womanmagazine.co.uk/competition/x/3.php", "The Festival of Britain");
    expect([...parseAnswers(html).keys()]).toEqual(["https://comps.womanmagazine.co.uk/competition/x/3.php"]);
  });

  // The answer is matched against the option label rendered on the entry
  // page, so an undecoded entity means the option is reported missing —
  // and "Café-quality coffees" is a real answer on a real draw.
  it("decodes the entities the site's answers really contain", () => {
    const html = CARD("1", "https://comps.marieclaire.co.uk/competition/x/4.php", "Caf&eacute;-quality coffees");
    expect([...parseAnswers(html).values()]).toEqual(["Café-quality coffees"]);
  });
  it("decodes numeric and hex entities too", () => {
    const html = CARD("1", "https://comps.marieclaire.co.uk/competition/x/6.php", "&#163;50 &#x2013; Caf&eacute;");
    expect([...parseAnswers(html).values()]).toEqual(["£50 – Café"]);
  });
  it("still unescapes a plain ampersand", () => {
    const html = CARD("1", "https://comps.marieclaire.co.uk/competition/x/7.php", "Cot &amp; Mattress");
    expect([...parseAnswers(html).values()]).toEqual(["Cot & Mattress"]);
  });

  it("an empty answer is not recorded as an answer", () => {
    const html = CARD("1", "https://comps.marieclaire.co.uk/competition/x/5.php", "   ");
    expect(parseAnswers(html).size).toEqual(0);
  });

  it("markup with no cards at all yields nothing rather than throwing", () => {
    expect(parseAnswers("<html><body>nothing here</body></html>").size).toEqual(0);
  });

  it("day paths use the site's own month spelling", () => {
    expect(recentDayPaths(3, new Date("2026-09-14T12:00:00Z"))).toEqual(["13-Sept-26", "12-Sept-26", "11-Sept-26"]);
  });

  it("one listing page per tracked site, plus the fixed ones", () => {
    const pages = listingPagesFor(["comps.marieclaire.co.uk", "competitions.stuff.tv"], ["13-Sept-26"]);
    expect(pages).toContain("https://www.competitions-whale.co.uk/website/comps.marieclaire.co.uk");
    expect(pages).toContain("https://www.competitions-whale.co.uk/new/13-Sept-26");
    expect(pages.length).toEqual(7);
  });
});
