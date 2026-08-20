import { describe, expect, it } from "vitest";
import { collectStatements, extractQuotes, parseDraft } from "../src/rubric/text.js";
import { loadFixture } from "./fixtures.test.js";

describe("extractQuotes", () => {
  it("finds a straight-quoted quote and its attribution", () => {
    const quotes = extractQuotes('"We doubled capacity," said Amara Okafor, managing director.');
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.text).toBe("We doubled capacity,");
    expect(quotes[0]!.attribution).toBe("Amara Okafor");
  });

  it("finds quotes delimited by typographic quote marks", () => {
    const quotes = extractQuotes('“We doubled capacity,” said Amara Okafor, managing director.');
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.attribution).toBe("Amara Okafor");
  });

  it("does not treat apostrophes as quote delimiters", () => {
    expect(extractQuotes("Kirkgate's plant won't close; it isn't for sale.")).toEqual([]);
    expect(extractQuotes("Kirkgate’s plant won’t close; it isn’t for sale.")).toEqual([]);
  });

  it("treats a quote continued across a paragraph break as one quote", () => {
    const body = [
      '"We commissioned the second line in October, so the capacity was there.',
      '',
      '"What we had not planned for was hiring 22 people in a fortnight." said Dev Mistry.',
    ].join("\n");
    const quotes = extractQuotes(body);
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.spansParagraphs).toBe(true);
    expect(quotes[0]!.text).toContain("second line in October");
    expect(quotes[0]!.text).toContain("22 people in a fortnight");
  });

  it("finds two separate quotes in one paragraph", () => {
    const quotes = extractQuotes('"First point," said Dev Mistry. "Second point entirely."');
    expect(quotes).toHaveLength(2);
    expect(quotes.every((q) => q.attribution === "Dev Mistry")).toBe(true);
  });

  it("flags an unterminated quote rather than dropping it", () => {
    const quotes = extractQuotes('"We never closed this one.\n\nAnd the release just carries on.');
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.unterminated).toBe(true);
  });

  it("attributes a partial quote introduced by name and title", () => {
    const quotes = extractQuotes(
      'Councillor Ruth Ellery, executive member for environment, said the handover was "as smooth as anyone could expect".',
    );
    expect(quotes[0]!.attribution).toBe("Councillor Ruth Ellery");
  });

  it("returns no attribution when there is none to find", () => {
    expect(extractQuotes('"A floating quote with nobody behind it."')[0]!.attribution).toBeNull();
  });

  it("counts the words inside the quote", () => {
    expect(extractQuotes('"Four words in here."')[0]!.words).toBe(4);
  });
});

describe("extractQuotes on fixtures", () => {
  it("finds three attributed quotes in the typographic fixture", () => {
    const quotes = extractQuotes(parseDraft(loadFixture("smart-quotes")).body);
    expect(quotes).toHaveLength(3);
    expect(quotes.filter((q) => q.spansParagraphs)).toHaveLength(1);
    expect(quotes.map((q) => q.attribution)).toEqual([
      "Dev Mistry",
      "Dev Mistry",
      "Councillor Ruth Ellery",
    ]);
  });

  it("finds four quoted passages from two speakers in the strong fixture", () => {
    const quotes = extractQuotes(parseDraft(loadFixture("strong")).body);
    expect(quotes.map((q) => q.attribution)).toEqual([
      "Amara Okafor",
      "Amara Okafor",
      "Tom Reilly",
      "Tom Reilly",
    ]);
  });

  it("finds no quotes in the weak fixture", () => {
    expect(extractQuotes(parseDraft(loadFixture("weak")).body)).toEqual([]);
  });
});

describe("collectStatements", () => {
  it("merges consecutive passages from the same speaker", () => {
    const statements = collectStatements(
      extractQuotes('"First point," said Dev Mistry. "Second point entirely."'),
    );
    expect(statements).toHaveLength(1);
    expect(statements[0]!.passages).toBe(2);
    expect(statements[0]!.text).toBe("First point, Second point entirely.");
    expect(statements[0]!.words).toBe(5);
  });

  it("keeps different speakers apart", () => {
    const statements = collectStatements(
      extractQuotes('"Mine," said Dev Mistry. "And mine," said Ruth Ellery.'),
    );
    expect(statements.map((s) => s.attribution)).toEqual(["Dev Mistry", "Ruth Ellery"]);
  });

  it("never merges unattributed passages, which could be anyone", () => {
    const statements = collectStatements(extractQuotes('"One." Then prose. "Two."'));
    expect(statements).toHaveLength(2);
    expect(statements.every((s) => s.attribution === null)).toBe(true);
  });

  it("carries spansParagraphs and unterminated through a merge", () => {
    const body = [
      '"Point one," said Dev Mistry. "Point two continues here.',
      "",
      '"Point three finishes it."',
    ].join("\n");
    const statements = collectStatements(extractQuotes(body));
    expect(statements).toHaveLength(1);
    expect(statements[0]!.spansParagraphs).toBe(true);
  });

  it("gives the strong fixture two statements, not four", () => {
    const statements = collectStatements(extractQuotes(parseDraft(loadFixture("strong")).body));
    expect(statements.map((s) => s.attribution)).toEqual(["Amara Okafor", "Tom Reilly"]);
    expect(statements.map((s) => s.passages)).toEqual([2, 2]);
  });

  it("gives the typographic fixture two statements", () => {
    const statements = collectStatements(
      extractQuotes(parseDraft(loadFixture("smart-quotes")).body),
    );
    expect(statements.map((s) => s.attribution)).toEqual(["Dev Mistry", "Councillor Ruth Ellery"]);
  });
});
