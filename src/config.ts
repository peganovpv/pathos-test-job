import { readFileSync } from "node:fs";
import { z } from "zod";

const positiveInt = z.number().int().positive();

export const ThresholdsSchema = z
  .object({
    body: z
      .object({
        idealMin: positiveInt.default(300),
        idealMax: positiveInt.default(500),
        hardMin: positiveInt.default(150),
        hardMax: positiveInt.default(800),
      })
      .prefault({}),
    headline: z
      .object({
        idealMinWords: positiveInt.default(6),
        idealMaxWords: positiveInt.default(12),
        maxWords: positiveInt.default(15),
        maxChars: positiveInt.default(120),
      })
      .prefault({}),
    lead: z
      .object({
        maxWords: positiveInt.default(30),
      })
      .prefault({}),
    sentence: z
      .object({
        maxMeanWords: positiveInt.default(25),
      })
      .prefault({}),
    paragraph: z
      .object({
        maxSentences: positiveInt.default(4),
        maxWords: positiveInt.default(80),
      })
      .prefault({}),
    quotes: z
      .object({
        min: positiveInt.default(1),
        idealMax: positiveInt.default(3),
        maxWords: positiveInt.default(40),
      })
      .prefault({}),
  })
  .prefault({})
  .superRefine((t, ctx) => {
    const ordered: Array<[string, number, string, number]> = [
      ["body.hardMin", t.body.hardMin, "body.idealMin", t.body.idealMin],
      ["body.idealMin", t.body.idealMin, "body.idealMax", t.body.idealMax],
      ["body.idealMax", t.body.idealMax, "body.hardMax", t.body.hardMax],
      [
        "headline.idealMinWords",
        t.headline.idealMinWords,
        "headline.idealMaxWords",
        t.headline.idealMaxWords,
      ],
      [
        "headline.idealMaxWords",
        t.headline.idealMaxWords,
        "headline.maxWords",
        t.headline.maxWords,
      ],
      ["quotes.min", t.quotes.min, "quotes.idealMax", t.quotes.idealMax],
    ];
    for (const [lowName, low, highName, high] of ordered) {
      if (low > high) {
        ctx.addIssue({
          code: "custom",
          message: `${lowName} (${low}) must not exceed ${highName} (${high})`,
        });
      }
    }
  });

export type Thresholds = z.output<typeof ThresholdsSchema>;

export const DEFAULT_THRESHOLDS: Thresholds = ThresholdsSchema.parse(undefined);

export class ConfigError extends Error {}

export function parseThresholds(input: unknown): Thresholds {
  const result = ThresholdsSchema.safeParse(input);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new ConfigError(`invalid threshold config — ${detail}`);
  }
  return result.data;
}

export function loadThresholds(path: string): Thresholds {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (cause) {
    throw new ConfigError(`cannot read config file ${path}`, { cause });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch (cause) {
    throw new ConfigError(`${path} is not valid JSON`, { cause });
  }

  return parseThresholds(parsed);
}
