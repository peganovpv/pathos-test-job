import { describe, expect, it } from "vitest";
import { DEFAULT_THRESHOLDS, parseThresholds } from "../src/config.js";
import { FakeJudge, judgment } from "../src/llm/fake.js";
import { bandFor, buildReport, grade, scoreFromFindings } from "../src/score.js";
import type { Finding } from "../src/types.js";
import { loadFixture } from "./fixtures.test.js";

const finding = (severity: Finding["severity"]): Finding => ({ id: "x", severity, message: "m" });

describe("scoreFromFindings", () => {
  it("starts at five with nothing found", () => {
    expect(scoreFromFindings([])).toBe(5);
  });

  it.each([
    [["low"], 4.75],
    [["medium"], 4.5],
    [["high"], 4],
    [["high", "medium", "low"], 3.25],
  ] as const)("deducts %j to %f", (severities, expected) => {
    expect(scoreFromFindings(severities.map(finding))).toBe(expected);
  });

  it("floors at zero rather than going negative", () => {
    expect(scoreFromFindings(Array.from({ length: 20 }, () => finding("high")))).toBe(0);
  });
});

describe("bandFor", () => {
  it.each([
    [100, "ready"],
    [80, "ready"],
    [79, "needs-work"],
    [60, "needs-work"],
    [59, "rewrite"],
    [0, "rewrite"],
  ] as const)("puts %i in %s", (overall, band) => {
    expect(bandFor(overall)).toBe(band);
  });
});

describe("buildReport with a judgment", () => {
  it("scores a clean draft with a good judgment near the top", () => {
    const report = buildReport(loadFixture("strong"), judgment({
      newsworthiness: { score: 5, rationale: "Jobs, money, place.", fixes: [] },
      quoteability: { score: 5, rationale: "Both quotes argue.", fixes: [] },
      headline: { score: 5, rationale: "Clean.", fixes: [] },
    }));
    expect(report.overall).toBe(100);
    expect(report.band).toBe("ready");
    expect(report.skipped).toEqual([]);
    expect(report.topFixes).toEqual([]);
  });

  it("reports all four categories in rubric order", () => {
    const report = buildReport(loadFixture("strong"), judgment());
    expect(report.categories.map((c) => c.key)).toEqual([
      "newsworthiness",
      "structure",
      "quoteability",
      "headline",
    ]);
    expect(report.categories.map((c) => c.source)).toEqual([
      "llm",
      "deterministic",
      "llm",
      "hybrid",
    ]);
  });

  it("deducts deterministic headline faults from the model's headline score", () => {
    // The model likes the weak headline; the label and length checks do not.
    const report = buildReport(loadFixture("weak"), judgment({
      headline: { score: 5, rationale: "Sounds impressive.", fixes: [] },
    }));
    const headline = report.categories.find((c) => c.key === "headline")!;
    expect(headline.score).toBeLessThan(5);
  });

  it("scores the weak draft as a rewrite", () => {
    const report = buildReport(loadFixture("weak"), judgment({
      newsworthiness: { score: 1, rationale: "No event, no numbers.", fixes: ["Lead with the launch date."] },
      quoteability: { score: 0, rationale: "Nothing to lift.", fixes: ["Add a quote."] },
      headline: { score: 1, rationale: "A label.", fixes: [] },
    }));
    expect(report.band).toBe("rewrite");
    expect(report.overall).toBeLessThan(30);
  });

  it("carries the verdict and suggested headlines through", () => {
    const report = buildReport(loadFixture("weak"), judgment({
      suggestedHeadlines: ["Vertexa Launches AI Platform For Mid-Market Firms"],
      verdict: "Rewrite around the launch.",
    }));
    expect(report.suggestedHeadlines).toHaveLength(1);
    expect(report.verdict).toBe("Rewrite around the launch.");
  });

  it("ranks fixes by severity, then by the weight of their category", () => {
    const report = buildReport(loadFixture("weak"), judgment({
      newsworthiness: { score: 1, rationale: "r", fixes: ["Find the actual news."] },
      quoteability: { score: 1, rationale: "r", fixes: ["Add a quote."] },
    }));
    const severities = report.topFixes.map((f) => f.severity);
    expect(severities).toEqual([...severities].sort((a, b) =>
      ({ high: 3, medium: 2, low: 1 })[b] - ({ high: 3, medium: 2, low: 1 })[a],
    ));
    // Newsworthiness carries 30 points against quoteability's 20, so its
    // equally severe fix is listed first.
    const highs = report.topFixes.filter((f) => f.severity === "high").map((f) => f.category);
    expect(highs.indexOf("newsworthiness")).toBeLessThan(highs.indexOf("quoteability"));
  });

  it("attaches a category to every finding", () => {
    const report = buildReport(loadFixture("weak"), judgment());
    expect(report.topFixes.every((f) => f.category !== undefined)).toBe(true);
  });
});

describe("buildReport without a judgment", () => {
  it("skips the model categories and says which", () => {
    const report = buildReport(loadFixture("strong"), null);
    expect(report.skipped).toEqual(["newsworthiness", "quoteability"]);
    expect(report.categories.map((c) => c.key)).toEqual(["structure", "headline"]);
  });

  it("renormalises the remaining weights to 100", () => {
    // strong.md has no deterministic faults, so both surviving categories are
    // at 5 out of 5 and the overall has to be 100 despite two being absent.
    expect(buildReport(loadFixture("strong"), null).overall).toBe(100);
  });

  it("still discriminates between drafts", () => {
    const strong = buildReport(loadFixture("strong"), null).overall;
    const typographic = buildReport(loadFixture("smart-quotes"), null).overall;
    const weak = buildReport(loadFixture("weak"), null).overall;
    expect(strong).toBeGreaterThan(typographic);
    expect(typographic).toBeGreaterThan(weak);
    expect(weak).toBeLessThan(40);
  });

  it("cannot see that a structurally sound headline is meaningless", () => {
    // "Introducing The Next Generation Of Our Revolutionary Cloud-Native
    // Platform Solution For Modern Enterprises" is 13 words, has no stray full
    // stop and is not in capitals, so it keeps most of its deterministic marks
    // while saying nothing. Recognising that is the model's job, and this test
    // pins where the boundary between the two layers actually falls.
    const headline = buildReport(loadFixture("weak"), null).categories.find(
      (c) => c.key === "headline",
    )!;
    expect(headline.score).toBeGreaterThan(3);
    expect(buildReport(loadFixture("weak"), null).overall).toBeGreaterThan(
      buildReport(loadFixture("weak"), judgment({
        newsworthiness: { score: 0, rationale: "No event.", fixes: [] },
        quoteability: { score: 0, rationale: "No quotes.", fixes: [] },
        headline: { score: 0, rationale: "A label.", fixes: [] },
      })).overall,
    );
  });

  it("scores the headline deterministically", () => {
    const report = buildReport(loadFixture("weak"), null);
    const headline = report.categories.find((c) => c.key === "headline")!;
    expect(headline.source).toBe("deterministic");
    expect(headline.rationale).toBeNull();
    expect(headline.score).toBeLessThan(5);
  });
});

describe("configured weights", () => {
  it("shifts the overall score", () => {
    const raw = loadFixture("smart-quotes");
    const structureHeavy = parseThresholds({
      weights: { structure: 90, headline: 10, newsworthiness: 1, quoteability: 1 },
    });
    const base = buildReport(raw, null, DEFAULT_THRESHOLDS).overall;
    const shifted = buildReport(raw, null, structureHeavy).overall;
    expect(shifted).not.toBe(base);
  });
});

describe("grade", () => {
  it("passes the draft and its facts to the judge", async () => {
    const judge = new FakeJudge();
    await grade(loadFixture("strong"), { judge });
    expect(judge.calls).toHaveLength(1);
    expect(judge.calls[0]!.draft.headline).toContain("Manchester Bakery");
    expect(judge.calls[0]!.facts.newsWords).toBeGreaterThan(300);
  });

  it("returns a report with no judge at all", async () => {
    const report = await grade(loadFixture("strong"));
    expect(report.skipped).toEqual(["newsworthiness", "quoteability"]);
  });

  it("lets a judge failure propagate rather than silently degrading", async () => {
    const judge = new FakeJudge(new Error("rate limited"));
    await expect(grade(loadFixture("strong"), { judge })).rejects.toThrow("rate limited");
  });
});
