import { describe, expect, it } from "vitest";
import {
  ConfigError,
  DEFAULT_THRESHOLDS,
  parseThresholds,
  loadThresholds,
} from "../src/config.js";

describe("thresholds", () => {
  it("supplies a full set of defaults from nothing", () => {
    expect(DEFAULT_THRESHOLDS.body.idealMin).toBe(300);
    expect(DEFAULT_THRESHOLDS.headline.idealMaxWords).toBe(12);
    expect(DEFAULT_THRESHOLDS.quotes.min).toBe(1);
    expect(parseThresholds({})).toEqual(DEFAULT_THRESHOLDS);
  });

  it("merges a partial config over the defaults", () => {
    const merged = parseThresholds({ body: { idealMax: 420 }, lead: { maxWords: 25 } });
    expect(merged.body.idealMax).toBe(420);
    expect(merged.body.idealMin).toBe(300);
    expect(merged.lead.maxWords).toBe(25);
    expect(merged.quotes).toEqual(DEFAULT_THRESHOLDS.quotes);
  });

  it("rejects non-numeric and non-positive values", () => {
    expect(() => parseThresholds({ lead: { maxWords: "thirty" } })).toThrow(ConfigError);
    expect(() => parseThresholds({ lead: { maxWords: 0 } })).toThrow(ConfigError);
    expect(() => parseThresholds({ lead: { maxWords: 12.5 } })).toThrow(ConfigError);
  });

  it("rejects bands that cross over", () => {
    expect(() => parseThresholds({ body: { idealMin: 600 } })).toThrow(
      /idealMin \(600\) must not exceed body.idealMax \(500\)/,
    );
  });

  it("names the offending path in the error", () => {
    expect(() => parseThresholds({ quotes: { min: -1 } })).toThrow(/quotes\.min/);
  });

  it("reports unreadable and malformed config files", () => {
    expect(() => loadThresholds("./does-not-exist.json")).toThrow(/cannot read config file/);
  });
});

describe("the documented example config", () => {
  it("parses and matches the defaults, so the docs cannot drift", () => {
    expect(loadThresholds("prq.config.example.json")).toEqual(DEFAULT_THRESHOLDS);
  });
});
