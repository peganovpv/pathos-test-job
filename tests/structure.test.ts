import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS as T, parseThresholds } from "../src/config.js";
import { computeFacts, type Facts } from "../src/rubric/facts.js";
import { parseDraft } from "../src/rubric/text.js";
import {
  boilerplate,
  bodyLength,
  contactDetails,
  dateline,
  jargonDensity,
  leadLength,
  leadSignals,
  paragraphLength,
  passiveVoice,
  quoteAttribution,
  quoteCount,
  quoteLength,
  runStructureChecks,
  sentenceLength,
  terminator,
  unterminatedQuote,
} from "../src/rubric/structure.js";
import { loadFixture } from "./fixtures.test.js";

function factsFor(raw: string): Facts {
  return computeFacts(parseDraft(raw));
}

/** A minimal draft that passes every check, used as a base for overrides. */
const CLEAN = `Acme Opens Second Factory In Hull

HULL, UK — 3 March 2026 — Acme will open a second factory in Hull in June, creating 40 jobs.

The site doubles output. Production starts on 1 June. ${"Filler sentence adds substance here. ".repeat(20)}

"This is the largest investment we have made," said Jane Doe, chief executive of Acme.

About Acme
Acme makes industrial fasteners in Hull and employs 120 people.

Media contact
press@acme.co.uk

###`;

const cleanFacts = factsFor(CLEAN);

function withFacts(overrides: Partial<Facts>): Facts {
  return { ...cleanFacts, ...overrides };
}

describe("bodyLength", () => {
  it.each([
    [1000, "high"],
    [100, "high"],
    [520, "low"],
    [280, "low"],
  ])("flags %i words as %s", (newsWords, severity) => {
    const findings = bodyLength(withFacts({ newsWords }), T);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.severity).toBe(severity);
  });

  it.each([300, 400, 500])("passes %i words", (newsWords) => {
    expect(bodyLength(withFacts({ newsWords }), T)).toEqual([]);
  });

  it("respects a configured band", () => {
    const tight = parseThresholds({ body: { idealMin: 250, idealMax: 300, hardMax: 400 } });
    expect(bodyLength(withFacts({ newsWords: 320 }), tight)[0]!.severity).toBe("low");
    expect(bodyLength(withFacts({ newsWords: 450 }), tight)[0]!.severity).toBe("high");
  });
});

describe("leadLength", () => {
  it("passes a lead inside the limit", () => {
    expect(leadLength(withFacts({ leadWords: 28 }), T)).toEqual([]);
  });

  it("flags a lead over the limit as medium", () => {
    expect(leadLength(withFacts({ leadWords: 38 }), T)[0]!.severity).toBe("medium");
  });

  it("escalates a lead half again over the limit", () => {
    expect(leadLength(withFacts({ leadWords: 67 }), T)[0]!.severity).toBe("high");
  });
});

describe("leadSignals", () => {
  it("passes when who, when and where are all detected", () => {
    expect(leadSignals(cleanFacts, T)).toEqual([]);
  });

  it("names the single missing signal", () => {
    const findings = leadSignals(withFacts({ leadSignals: { who: true, when: true, where: false } }), T);
    expect(findings[0]!.severity).toBe("low");
    expect(findings[0]!.message).toContain("where");
    expect(findings[0]!.message).not.toContain("who");
  });

  it("escalates when more than one is missing", () => {
    const findings = leadSignals(withFacts({ leadSignals: { who: false, when: false, where: true } }), T);
    expect(findings[0]!.severity).toBe("medium");
    expect(findings[0]!.message).toContain("who or when");
  });
});

describe("dateline", () => {
  it("passes a dateline with a place and a date", () => {
    expect(dateline(cleanFacts, T)).toEqual([]);
  });

  it("flags a missing dateline as medium", () => {
    expect(dateline(withFacts({ dateline: null }), T)[0]!.severity).toBe("medium");
  });

  it("flags a dateline with no date as low", () => {
    const findings = dateline(withFacts({ dateline: { text: "HULL, UK -", hasDate: false } }), T);
    expect(findings[0]!.severity).toBe("low");
  });
});

describe("paragraphLength", () => {
  it("passes short paragraphs", () => {
    expect(paragraphLength(withFacts({ paragraphs: ["One sentence here.", "And another."] }), T)).toEqual([]);
  });

  it("flags one long paragraph as low and several as medium", () => {
    const long = `${"A sentence of some length goes here. ".repeat(6)}`;
    expect(paragraphLength(withFacts({ paragraphs: [long] }), T)[0]!.severity).toBe("low");
    expect(paragraphLength(withFacts({ paragraphs: [long, long, long] }), T)[0]!.severity).toBe("medium");
  });

  it("counts words as well as sentences", () => {
    const oneLongSentence = `Acme ${"and a further clause ".repeat(20)} ends.`;
    expect(paragraphLength(withFacts({ paragraphs: [oneLongSentence] }), T)).toHaveLength(1);
  });
});

describe("sentenceLength", () => {
  it("passes a normal mean", () => {
    expect(sentenceLength(withFacts({ meanSentenceWords: 19 }), T)).toEqual([]);
  });

  it("flags a high mean as medium and a very high mean as high", () => {
    expect(sentenceLength(withFacts({ meanSentenceWords: 30 }), T)[0]!.severity).toBe("medium");
    expect(sentenceLength(withFacts({ meanSentenceWords: 75 }), T)[0]!.severity).toBe("high");
  });

  it("says nothing about an empty draft", () => {
    expect(sentenceLength(withFacts({ sentences: [], meanSentenceWords: 0 }), T)).toEqual([]);
  });
});

describe("quote checks", () => {
  const statement = (words: number, attribution: string | null = "Jane Doe") => ({
    text: "word ".repeat(words).trim(),
    words,
    attribution,
    passages: 1,
    spansParagraphs: false,
    unterminated: false,
  });

  it("flags an absence of quotes as high", () => {
    const findings = quoteCount(withFacts({ statements: [] }), T);
    expect(findings[0]!.severity).toBe("high");
    expect(findings[0]!.message).toMatch(/No direct quotes/);
  });

  it("passes one to three quotes", () => {
    for (const count of [1, 2, 3]) {
      expect(quoteCount(withFacts({ statements: Array.from({ length: count }, () => statement(20)) }), T)).toEqual([]);
    }
  });

  it("flags more quotes than the release can carry as low", () => {
    const statements = Array.from({ length: 5 }, () => statement(20));
    expect(quoteCount(withFacts({ statements }), T)[0]!.severity).toBe("low");
  });

  it("flags unattributed quotes", () => {
    const findings = quoteAttribution(withFacts({ statements: [statement(20), statement(20, null)] }), T);
    expect(findings[0]!.severity).toBe("medium");
    expect(findings[0]!.message).toMatch(/^1 quote/);
  });

  it("says nothing when every quote is attributed", () => {
    expect(quoteAttribution(withFacts({ statements: [statement(20)] }), T)).toEqual([]);
  });

  it("flags an over-long quote and names the longest", () => {
    const findings = quoteLength(withFacts({ statements: [statement(30), statement(62)] }), T);
    expect(findings[0]!.severity).toBe("low");
    expect(findings[0]!.message).toContain("62");
    expect(findings[0]!.message).toContain("1 quote runs past");
  });

  it("flags an unterminated quote mark", () => {
    const quotes = [{ text: "x", words: 1, attribution: null, spansParagraphs: false, unterminated: true }];
    expect(unterminatedQuote(withFacts({ quotes }), T)[0]!.severity).toBe("medium");
  });
});

describe("boilerplate, contact and terminator", () => {
  it("pass on a complete release", () => {
    expect(boilerplate(cleanFacts, T)).toEqual([]);
    expect(contactDetails(cleanFacts, T)).toEqual([]);
    expect(terminator(cleanFacts, T)).toEqual([]);
  });

  it("flag their absence", () => {
    const bare = withFacts({
      segments: { news: [], boilerplate: [], contact: [], hasTerminator: false },
      hasEmail: false,
      hasPhone: false,
    });
    expect(boilerplate(bare, T)[0]!.severity).toBe("low");
    expect(contactDetails(bare, T)[0]!.severity).toBe("medium");
    expect(terminator(bare, T)[0]!.severity).toBe("low");
  });

  it("accepts a phone number with no email", () => {
    expect(contactDetails(withFacts({ hasEmail: false, hasPhone: true }), T)).toEqual([]);
  });
});

describe("jargonDensity", () => {
  it("says nothing about clean copy", () => {
    expect(jargonDensity(withFacts({ jargon: [], jargonTotal: 0 }), T)).toEqual([]);
  });

  it.each([
    [2, "low"],
    [4, "medium"],
    [27, "high"],
  ])("scales %i hits to %s", (jargonTotal, severity) => {
    const facts = withFacts({ jargonTotal, jargon: [{ phrase: "world-class", count: jargonTotal }] });
    expect(jargonDensity(facts, T)[0]!.severity).toBe(severity);
  });

  it("lists the offending phrases as evidence", () => {
    const facts = withFacts({
      jargonTotal: 3,
      jargon: [{ phrase: "synergy", count: 2 }, { phrase: "holistic", count: 1 }],
    });
    expect(jargonDensity(facts, T)[0]!.evidence).toBe("synergy (×2), holistic");
  });
});

describe("passiveVoice", () => {
  it("ignores a low ratio", () => {
    expect(passiveVoice(withFacts({ passiveCount: 2, sentences: ["a", "b", "c", "d", "e"] }), T)).toEqual([]);
  });

  it("flags more than one construction every two sentences", () => {
    expect(passiveVoice(withFacts({ passiveCount: 4, sentences: ["a", "b", "c", "d"] }), T)[0]!.severity).toBe("low");
    expect(passiveVoice(withFacts({ passiveCount: 17, sentences: Array(11).fill("a") }), T)[0]!.severity).toBe("medium");
  });
});

describe("runStructureChecks on fixtures", () => {
  it("finds nothing wrong with the strong fixture", () => {
    expect(runStructureChecks(factsFor(loadFixture("strong")), T)).toEqual([]);
  });

  it("finds the specific faults in the weak fixture", () => {
    const ids = runStructureChecks(factsFor(loadFixture("weak")), T).map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "body-length",
        "lead-length",
        "dateline",
        "sentence-length",
        "quote-count",
        "contact",
        "jargon",
      ]),
    );
  });

  it("finds only length niggles in the typographic fixture", () => {
    const ids = runStructureChecks(factsFor(loadFixture("smart-quotes")), T).map((f) => f.id);
    expect(ids).toEqual(["body-length", "quote-length"]);
  });
});
