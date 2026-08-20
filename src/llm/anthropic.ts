import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { JudgeError, type Judge, type JudgeInput, type Judgment } from "./port.js";
import { buildUserMessage, SYSTEM_PROMPT } from "./prompt.js";
import { JudgmentSchema, parseJudgment } from "./schema.js";

export const DEFAULT_MODEL = "claude-sonnet-5";
const MAX_TOKENS = 16000;

interface ParseResult {
  stop_reason?: string | null;
  stop_details?: { type?: string; category?: string | null; explanation?: string | null } | null;
  parsed_output?: unknown;
}

/**
 * Only the surface this judge uses, so tests can supply a stub without a
 * network client and without casting a whole SDK instance into existence.
 */
export interface JudgeClient {
  messages: {
    parse(params: Record<string, unknown>): Promise<ParseResult>;
  };
}

export interface AnthropicJudgeOptions {
  client?: JudgeClient;
  model?: string;
}

/**
 * The chain is most-specific-first and ends at APIError, which is this SDK's
 * base class. There is no APIStatusError export, despite it appearing in some
 * examples — `instanceof undefined` throws, so the handler would fail on the
 * one path it exists to handle.
 */
function describeFailure(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "the API rejected the credentials. Check ANTHROPIC_API_KEY, or run with --offline.";
  }
  if (error instanceof Anthropic.NotFoundError) {
    return "the model was not found. Check the id passed to --model.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "rate limited. Wait and retry, or run with --offline.";
  }
  if (error instanceof Anthropic.InternalServerError) {
    return "the API returned a server error. Retry, or run with --offline.";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `the API rejected the request: ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return "the request to the API timed out.";
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "could not reach the API. Check the network, or run with --offline.";
  }
  if (error instanceof Anthropic.APIError) {
    return `the API call failed: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export class AnthropicJudge implements Judge {
  readonly name: string;
  private readonly client: JudgeClient;
  private readonly model: string;

  constructor(options: AnthropicJudgeOptions = {}) {
    this.model = options.model ?? process.env["PRQ_MODEL"] ?? DEFAULT_MODEL;
    this.name = this.model;
    // One cast, at the boundary: the SDK client is structurally a JudgeClient
    // but its parse() signature is far wider than what is used here.
    this.client = options.client ?? (new Anthropic() as unknown as JudgeClient);
  }

  async judge(input: JudgeInput): Promise<Judgment> {
    const prompt = buildUserMessage(input.draft, input.facts);
    const messages: Array<{ role: "user" | "assistant"; content: string }> = [
      { role: "user", content: prompt },
    ];

    // The API guarantees the response's shape but not the values in it, so a
    // payload can validate as JSON and still be out of range. One corrective
    // round trip is cheaper than failing the run.
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await this.request(messages);

      if (response.stop_reason === "refusal") {
        const category = response.stop_details?.category ?? "unspecified";
        throw new JudgeError(`the model declined to score this draft (${category}).`);
      }
      if (response.parsed_output === undefined || response.parsed_output === null) {
        throw new JudgeError("the model returned no structured output.");
      }

      try {
        return parseJudgment(response.parsed_output);
      } catch (error) {
        if (attempt === 2) throw error;
        messages.push(
          { role: "assistant", content: JSON.stringify(response.parsed_output) },
          {
            role: "user",
            content: `That did not validate: ${
              error instanceof Error ? error.message : String(error)
            }. Return the same judgment with every score an integer from 0 to 5 and no empty strings.`,
          },
        );
      }
    }

    throw new JudgeError("the model's judgment did not validate.");
  }

  private async request(
    messages: Array<{ role: "user" | "assistant"; content: string }>,
  ): Promise<ParseResult> {
    try {
      return await this.client.messages.parse({
        model: this.model,
        max_tokens: MAX_TOKENS,
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        messages,
        output_config: { format: zodOutputFormat(JudgmentSchema) },
      });
    } catch (error) {
      throw new JudgeError(describeFailure(error), { cause: error });
    }
  }
}
