import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { countWords, parseDraft, splitSentences } from "../src/rubric/text.js";

export function loadFixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}.md`, import.meta.url), "utf8");
}

/**
 * The fixtures are inputs to most other tests, so their properties are asserted
 * here. If someone edits a fixture, this fails before the downstream assertions
 * start failing for reasons that look unrelated.
 */
describe("fixture properties", () => {
  it("strong.md sits inside every ideal band", () => {
    const draft = parseDraft(loadFixture("strong"));
    const sentences = splitSentences(draft.body);
    expect(countWords(draft.headline)).toBeGreaterThanOrEqual(6);
    expect(countWords(draft.headline)).toBeLessThanOrEqual(12);
    expect(countWords(draft.body)).toBeGreaterThanOrEqual(300);
    expect(countWords(draft.body)).toBeLessThanOrEqual(500);
    expect(countWords(draft.paragraphs[0]!)).toBeLessThanOrEqual(30);
    expect(countWords(draft.body) / sentences.length).toBeLessThan(25);
  });

  it("weak.md breaks the length, lead and sentence bands", () => {
    const draft = parseDraft(loadFixture("weak"));
    const sentences = splitSentences(draft.body);
    expect(countWords(draft.headline)).toBeGreaterThan(12);
    expect(countWords(draft.body)).toBeGreaterThan(800);
    expect(countWords(draft.paragraphs[0]!)).toBeGreaterThan(30);
    expect(countWords(draft.body) / sentences.length).toBeGreaterThan(25);
  });

  it("smart-quotes.md really does use typographic punctuation", () => {
    const raw = loadFixture("smart-quotes");
    expect(raw).toMatch(/[“”]/);
    expect(raw).toMatch(/’/);
  });
});
