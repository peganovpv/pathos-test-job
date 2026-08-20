import type { Facts } from "../rubric/facts.js";
import type { Draft } from "../types.js";

export interface CategoryJudgment {
  score: number;
  rationale: string;
  fixes: string[];
}

export interface Judgment {
  newsworthiness: CategoryJudgment;
  quoteability: CategoryJudgment;
  headline: CategoryJudgment;
  suggestedHeadlines: string[];
  verdict: string;
}

export interface JudgeInput {
  draft: Draft;
  facts: Facts;
}

export interface Judge {
  readonly name: string;
  judge(input: JudgeInput): Promise<Judgment>;
}

export class JudgeError extends Error {}

/** No credential is configured at all — a setup problem, not a failed call. */
export class MissingCredentialError extends JudgeError {}
