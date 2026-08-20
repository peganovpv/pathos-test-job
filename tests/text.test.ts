import { describe, expect, it } from "vitest";
import {
  countWords,
  normalizePunctuation,
  parseDraft,
  splitParagraphs,
  splitSentences,
} from "../src/rubric/text.js";

describe("countWords", () => {
  it.each([
    ["", 0],
    ["Acme launches Widget", 3],
    ["state-of-the-art tooling", 2],
    ["It's Acme's third release", 4],
    ["Revenue grew 15.4% to $2.3m", 5],
    ["   spaced   out   ", 2],
  ])("counts %j as %i words", (input, expected) => {
    expect(countWords(input)).toBe(expected);
  });
});

describe("splitParagraphs", () => {
  it("splits on blank lines and collapses internal whitespace", () => {
    const text = "First para\nstill first.\n\n\nSecond para.\n\n   \n\nThird.";
    expect(splitParagraphs(text)).toEqual([
      "First para still first.",
      "Second para.",
      "Third.",
    ]);
  });

  it("returns nothing for whitespace-only input", () => {
    expect(splitParagraphs("\n  \n\t\n")).toEqual([]);
  });
});

describe("splitSentences", () => {
  it("splits on terminal punctuation", () => {
    expect(splitSentences("Acme launched today. Revenue doubled! Did it? Yes.")).toEqual([
      "Acme launched today.",
      "Revenue doubled!",
      "Did it?",
      "Yes.",
    ]);
  });

  it.each([
    ["Acme Inc. announced a raise today.", 1],
    ["Dr. Patel joined the board.", 1],
    ["The U.S. market grew fast.", 1],
    ["Costs fell 12.5% this year.", 1],
    ["Filed at 9 a.m. in London.", 1],
    ["Tools, e.g. spreadsheets, are slow.", 1],
    ["J. R. Hartley wrote the foreword.", 1],
  ])("does not split %j", (input, expected) => {
    expect(splitSentences(input)).toHaveLength(expected);
  });

  it("keeps closing quotes with the sentence they end", () => {
    const sentences = splitSentences('"We are thrilled." Said the founder.');
    expect(sentences[0]).toBe('"We are thrilled."');
  });

  it("is empty for input with no words", () => {
    expect(splitSentences("   ...   ")).toEqual([]);
  });
});

describe("normalizePunctuation", () => {
  it("folds typographic quotes, dashes and ellipses to ASCII", () => {
    expect(normalizePunctuation("“It’s here,” — she said…")).toBe(
      '"It\'s here," - she said...',
    );
  });
});

describe("parseDraft", () => {
  it("takes the first non-empty line as the headline", () => {
    const draft = parseDraft("\n\nAcme Launches Widget\n\nLONDON - Acme did a thing.\n\nMore body.");
    expect(draft.headline).toBe("Acme Launches Widget");
    expect(draft.paragraphs).toEqual(["LONDON - Acme did a thing.", "More body."]);
  });

  it("strips markdown heading and bold markers from the headline", () => {
    expect(parseDraft("# Acme Launches Widget\n\nBody.").headline).toBe("Acme Launches Widget");
    expect(parseDraft("**Acme Launches Widget**\n\nBody.").headline).toBe("Acme Launches Widget");
  });

  it("handles an empty draft", () => {
    expect(parseDraft("   \n  ")).toEqual({
      raw: "   \n  ",
      headline: "",
      body: "",
      paragraphs: [],
    });
  });
});
