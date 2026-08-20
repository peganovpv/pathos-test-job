import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeFacts } from "../src/rubric/facts.js";
import { countWords, parseDraft } from "../src/rubric/text.js";

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
    const facts = computeFacts(parseDraft(loadFixture("strong")));
    expect(facts.headlineWords).toBeGreaterThanOrEqual(6);
    expect(facts.headlineWords).toBeLessThanOrEqual(12);
    expect(facts.newsWords).toBeGreaterThanOrEqual(300);
    expect(facts.newsWords).toBeLessThanOrEqual(500);
    expect(facts.leadWords).toBeLessThanOrEqual(30);
    expect(facts.meanSentenceWords).toBeLessThan(25);
    expect(facts.dateline?.hasDate).toBe(true);
    expect(facts.statements).toHaveLength(2);
  });

  it("weak.md breaks the length, lead and sentence bands", () => {
    const facts = computeFacts(parseDraft(loadFixture("weak")));
    expect(facts.headlineWords).toBeGreaterThan(12);
    expect(facts.newsWords).toBeGreaterThan(800);
    expect(facts.leadWords).toBeGreaterThan(30);
    expect(facts.meanSentenceWords).toBeGreaterThan(25);
    expect(facts.statements).toEqual([]);
    expect(facts.jargonTotal).toBeGreaterThan(10);
  });

  it("smart-quotes.md really does use typographic punctuation", () => {
    const raw = loadFixture("smart-quotes");
    expect(raw).toMatch(/[“”]/);
    expect(raw).toMatch(/’/);
  });
});
