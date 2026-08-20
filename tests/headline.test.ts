import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS as T, parseThresholds } from "../src/config.js";
import { computeFacts } from "../src/rubric/facts.js";
import {
  headlineCharCount,
  headlineIsLabel,
  headlinePresent,
  headlinePunctuation,
  headlineVerb,
  headlineWordCount,
  runHeadlineChecks,
} from "../src/rubric/headline.js";
import { parseDraft } from "../src/rubric/text.js";
import { loadFixture } from "./fixtures.test.js";

function factsForHeadline(headline: string) {
  return computeFacts(parseDraft(`${headline}\n\nSome body copy sits here.`));
}

function ids(headline: string): string[] {
  return runHeadlineChecks(factsForHeadline(headline), T).map((f) => f.id);
}

describe("headlinePresent", () => {
  it("flags an empty headline as high", () => {
    expect(headlinePresent(computeFacts(parseDraft("")), T)[0]!.severity).toBe("high");
  });

  it("suppresses the other headline checks when there is no headline", () => {
    const facts = computeFacts(parseDraft(""));
    expect(headlineWordCount(facts, T)).toEqual([]);
    expect(headlineVerb(facts, T)).toEqual([]);
  });
});

describe("headlineWordCount", () => {
  it.each([
    ["Manchester Bakery Opens Three Sites, Creating 45 Jobs", []],
    ["Acme Opens Hull Factory", ["headline-length"]],
    ["Manchester Bakery Opens Three New Sites Across The City Region, Creating 45 Jobs", ["headline-length"]],
  ])("checks %j", (headline, expected) => {
    expect(headlineWordCount(factsForHeadline(headline), T).map((f) => f.id)).toEqual(expected);
  });

  it("escalates past the hard maximum", () => {
    const long = "Acme Opens A Very Large New Factory In Hull Creating Forty Five Permanent Jobs This June";
    expect(headlineWordCount(factsForHeadline(long), T)[0]!.severity).toBe("medium");
  });

  it("respects a configured range", () => {
    const tight = parseThresholds({ headline: { idealMinWords: 4, idealMaxWords: 6, maxWords: 8 } });
    const findings = headlineWordCount(factsForHeadline("Manchester Bakery Opens Three Sites, Creating 45 Jobs"), tight);
    expect(findings[0]!.severity).toBe("low");
  });
});

describe("headlineCharCount", () => {
  it("passes a short headline", () => {
    expect(headlineCharCount(factsForHeadline("Acme Opens Hull Factory"), T)).toEqual([]);
  });

  it("flags one that will be truncated", () => {
    const wide = `Acme Opens ${"A".repeat(120)} Factory`;
    expect(headlineCharCount(factsForHeadline(wide), T)[0]!.id).toBe("headline-width");
  });
});

describe("headlineVerb", () => {
  it.each([
    "Manchester Bakery Opens Three Sites",
    "Leeds Recycling Firm Wins £3m Council Contract",
    "Acme Raises £4m To Expand Into Scotland",
    "Hull Factory Creating Forty Jobs",
  ])("accepts %j", (headline) => {
    expect(headlineVerb(factsForHeadline(headline), T)).toEqual([]);
  });

  it.each([
    "A New Era For Industrial Fasteners",
    "Vertexa Nexus: The Platform For Modern Enterprise",
  ])("flags %j as having no news verb", (headline) => {
    expect(headlineVerb(factsForHeadline(headline), T)[0]!.severity).toBe("medium");
  });
});

describe("headlineIsLabel", () => {
  it.each(["Introducing", "Announcing", "Presenting", "Unveiling"])(
    "flags a headline opening with %j",
    (opener) => {
      const findings = headlineIsLabel(factsForHeadline(`${opener} The Next Generation Platform`), T);
      expect(findings[0]!.id).toBe("headline-label");
      expect(findings[0]!.message).toContain(opener.toLowerCase());
    },
  );

  it("does not flag a headline that reports news", () => {
    expect(headlineIsLabel(factsForHeadline("Acme Opens Hull Factory"), T)).toEqual([]);
  });
});

describe("headlinePunctuation", () => {
  it("flags a closing full stop", () => {
    expect(headlinePunctuation(factsForHeadline("Acme Opens Hull Factory."), T).map((f) => f.id)).toEqual([
      "headline-punctuation",
    ]);
  });

  it("leaves an ellipsis alone", () => {
    expect(headlinePunctuation(factsForHeadline("Acme Opens Hull Factory..."), T)).toEqual([]);
  });

  it("flags all-capitals", () => {
    expect(headlinePunctuation(factsForHeadline("ACME OPENS HULL FACTORY"), T).map((f) => f.id)).toEqual([
      "headline-case",
    ]);
  });

  it("leaves an acronym-heavy but mixed-case headline alone", () => {
    expect(headlinePunctuation(factsForHeadline("BBC And ITV Back Acme"), T)).toEqual([]);
  });
});

describe("runHeadlineChecks on fixtures", () => {
  it("passes both well-formed headlines", () => {
    expect(runHeadlineChecks(computeFacts(parseDraft(loadFixture("strong"))), T)).toEqual([]);
    expect(runHeadlineChecks(computeFacts(parseDraft(loadFixture("smart-quotes"))), T)).toEqual([]);
  });

  it("catches the label, the length and the width of the weak headline", () => {
    const found = runHeadlineChecks(computeFacts(parseDraft(loadFixture("weak"))), T).map((f) => f.id);
    expect(found).toContain("headline-length");
    expect(found).toContain("headline-label");
  });

  it("reports several faults at once", () => {
    expect(ids("INTRODUCING OUR REVOLUTIONARY NEW PLATFORM SOLUTION FOR THE MODERN ENTERPRISE TODAY.")).toEqual(
      expect.arrayContaining(["headline-label", "headline-punctuation", "headline-case"]),
    );
  });
});
