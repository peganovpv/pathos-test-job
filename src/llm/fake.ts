import type { Judge, JudgeInput, Judgment } from "./port.js";

export function judgment(overrides: Partial<Judgment> = {}): Judgment {
  return {
    newsworthiness: { score: 4, rationale: "A concrete, local, job-creating story.", fixes: [] },
    quoteability: { score: 4, rationale: "The quote makes an argument.", fixes: [] },
    headline: { score: 4, rationale: "Subject, verb and number.", fixes: [] },
    suggestedHeadlines: [],
    verdict: "Send it.",
    ...overrides,
  };
}

/** Returns a fixed judgment and records what it was asked about. */
export class FakeJudge implements Judge {
  readonly name = "fake";
  readonly calls: JudgeInput[] = [];

  constructor(private readonly result: Judgment | Error = judgment()) {}

  async judge(input: JudgeInput): Promise<Judgment> {
    this.calls.push(input);
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}
