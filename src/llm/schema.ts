import { z } from "zod";
import { JudgeError, type Judgment } from "./port.js";

const CategorySchema = z.object({
  score: z.number().int().min(0).max(5),
  rationale: z.string().trim().min(1),
  fixes: z.array(z.string().trim().min(1)),
});

/**
 * The shape sent to the API. Note that the SDK's zod-to-JSON-Schema conversion
 * renders value constraints (minimum, maximum, maxItems) as prose inside
 * `description` rather than as JSON Schema keywords — so the API guarantees the
 * shape of the response and nothing about the numbers in it. Everything here is
 * therefore re-checked locally by parseJudgment below.
 */
export const JudgmentSchema = z.object({
  newsworthiness: CategorySchema,
  quoteability: CategorySchema,
  headline: CategorySchema,
  suggested_headlines: z.array(z.string().trim().min(1)),
  verdict: z.string().trim().min(1),
});

const MAX_FIXES = 3;
const MAX_HEADLINES = 3;

export function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}

/** Validates and normalises a raw model payload into the domain type. */
export function parseJudgment(payload: unknown): Judgment {
  const result = JudgmentSchema.safeParse(payload);
  if (!result.success) {
    throw new JudgeError(`the model's judgment did not validate — ${describeIssues(result.error)}`);
  }

  const raw = result.data;
  return {
    newsworthiness: { ...raw.newsworthiness, fixes: raw.newsworthiness.fixes.slice(0, MAX_FIXES) },
    quoteability: { ...raw.quoteability, fixes: raw.quoteability.fixes.slice(0, MAX_FIXES) },
    headline: { ...raw.headline, fixes: raw.headline.fixes.slice(0, MAX_FIXES) },
    suggestedHeadlines: raw.suggested_headlines.slice(0, MAX_HEADLINES),
    verdict: raw.verdict,
  };
}
