import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { describe, expect, it, vi } from "vitest";
import {
  AnthropicJudge,
  clientOptions,
  credentialAdvice,
  DEFAULT_MODEL,
  type JudgeClient,
} from "../src/llm/anthropic.js";
import { JudgeError, MissingCredentialError } from "../src/llm/port.js";
import { buildUserMessage, SYSTEM_PROMPT } from "../src/llm/prompt.js";
import { parseJudgment } from "../src/llm/schema.js";
import { computeFacts } from "../src/rubric/facts.js";
import { parseDraft } from "../src/rubric/text.js";
import { loadFixture } from "./fixtures.test.js";

const VALID = {
  newsworthiness: { score: 4, rationale: "Jobs and money in a named place.", fixes: ["Put the 45 jobs in the headline."] },
  quoteability: { score: 4, rationale: "The quote concedes a constraint.", fixes: [] },
  headline: { score: 4, rationale: "Active and specific.", fixes: [] },
  suggested_headlines: ["Pollen & Crumb Opens Three Bakeries, Creating 45 Jobs"],
  verdict: "Send it.",
};

function stub(...results: Array<Record<string, unknown> | Error>): {
  client: JudgeClient;
  calls: Array<Record<string, unknown>>;
} {
  const calls: Array<Record<string, unknown>> = [];
  let index = 0;
  const client: JudgeClient = {
    messages: {
      parse: async (params) => {
        calls.push(params);
        const result = results[Math.min(index++, results.length - 1)]!;
        if (result instanceof Error) throw result;
        return result;
      },
    },
  };
  return { client, calls };
}

function inputFor(name: string) {
  const draft = parseDraft(loadFixture(name));
  return { draft, facts: computeFacts(draft) };
}

describe("parseJudgment", () => {
  it("accepts a well-formed payload", () => {
    const judgment = parseJudgment(VALID);
    expect(judgment.newsworthiness.score).toBe(4);
    expect(judgment.suggestedHeadlines).toHaveLength(1);
    expect(judgment.verdict).toBe("Send it.");
  });

  it.each([
    ["a score above the scale", { ...VALID, headline: { ...VALID.headline, score: 7 } }],
    ["a negative score", { ...VALID, headline: { ...VALID.headline, score: -1 } }],
    ["a fractional score", { ...VALID, headline: { ...VALID.headline, score: 3.5 } }],
    ["a score as a string", { ...VALID, headline: { ...VALID.headline, score: "4" } }],
    ["a missing category", { ...VALID, quoteability: undefined }],
    ["an empty rationale", { ...VALID, headline: { ...VALID.headline, rationale: "  " } }],
    ["a null payload", null],
    ["a string payload", "4/5 overall"],
  ])("rejects %s", (_label, payload) => {
    expect(() => parseJudgment(payload)).toThrow(JudgeError);
  });

  it("names the offending field in the error", () => {
    expect(() => parseJudgment({ ...VALID, headline: { ...VALID.headline, score: 9 } })).toThrow(
      /headline\.score/,
    );
  });

  it("caps fixes and suggested headlines at three", () => {
    const judgment = parseJudgment({
      ...VALID,
      newsworthiness: { score: 2, rationale: "r", fixes: ["a", "b", "c", "d", "e"] },
      suggested_headlines: ["one", "two", "three", "four"],
    });
    expect(judgment.newsworthiness.fixes).toHaveLength(3);
    expect(judgment.suggestedHeadlines).toHaveLength(3);
  });

  it("trims whitespace off the text it keeps", () => {
    const judgment = parseJudgment({ ...VALID, verdict: "  Send it.  " });
    expect(judgment.verdict).toBe("Send it.");
  });
});

describe("AnthropicJudge request", () => {
  it("sends the rubric as the system prompt and the draft as the message", async () => {
    const { client, calls } = stub({ parsed_output: VALID, stop_reason: "end_turn" });
    const input = inputFor("strong");
    await new AnthropicJudge({ client }).judge(input);

    expect(calls).toHaveLength(1);
    expect(calls[0]!["system"]).toBe(SYSTEM_PROMPT);
    expect(calls[0]!["model"]).toBe(DEFAULT_MODEL);
    expect(calls[0]!["thinking"]).toEqual({ type: "adaptive" });
    expect(calls[0]!["messages"]).toEqual([
      { role: "user", content: buildUserMessage(input.draft, input.facts) },
    ]);
  });

  it("takes the model from the option, then the environment, then the default", async () => {
    const { client, calls } = stub({ parsed_output: VALID });
    await new AnthropicJudge({ client, model: "claude-opus-5" }).judge(inputFor("strong"));
    expect(calls[0]!["model"]).toBe("claude-opus-5");

    vi.stubEnv("PRQ_MODEL", "claude-haiku-4-5");
    const second = stub({ parsed_output: VALID });
    await new AnthropicJudge({ client: second.client }).judge(inputFor("strong"));
    expect(second.calls[0]!["model"]).toBe("claude-haiku-4-5");
    vi.unstubAllEnvs();
  });
});

describe("AnthropicJudge failure handling", () => {
  it("retries once with a corrective message when validation fails", async () => {
    const bad = { ...VALID, headline: { ...VALID.headline, score: 9 } };
    const { client, calls } = stub({ parsed_output: bad }, { parsed_output: VALID });
    const judgment = await new AnthropicJudge({ client }).judge(inputFor("strong"));

    expect(judgment.headline.score).toBe(4);
    expect(calls).toHaveLength(2);
    const messages = calls[1]!["messages"] as Array<{ role: string; content: string }>;
    expect(messages).toHaveLength(3);
    expect(messages[2]!.content).toContain("headline.score");
    expect(messages[2]!.content).toContain("integer from 0 to 5");
  });

  it("gives up after the second failure rather than looping", async () => {
    const bad = { parsed_output: { ...VALID, headline: { ...VALID.headline, score: 9 } } };
    const { client, calls } = stub(bad, bad, bad);
    await expect(new AnthropicJudge({ client }).judge(inputFor("strong"))).rejects.toThrow(JudgeError);
    expect(calls).toHaveLength(2);
  });

  it("reports a refusal as a refusal", async () => {
    const { client } = stub({
      stop_reason: "refusal",
      stop_details: { type: "refusal", category: "cyber" },
      parsed_output: null,
    });
    await expect(new AnthropicJudge({ client }).judge(inputFor("strong"))).rejects.toThrow(
      /declined to score this draft \(cyber\)/,
    );
  });

  it("reports a missing parsed_output rather than dereferencing it", async () => {
    const { client } = stub({ stop_reason: "end_turn", parsed_output: null });
    await expect(new AnthropicJudge({ client }).judge(inputFor("strong"))).rejects.toThrow(
      /no structured output/,
    );
  });

  it.each([
    [new Anthropic.AuthenticationError(401, {}, "bad key", new Headers()), /credentials/],
    [new Anthropic.NotFoundError(404, {}, "no model", new Headers()), /model was not found/],
    [new Anthropic.RateLimitError(429, {}, "slow down", new Headers()), /rate limited/i],
    [new Anthropic.InternalServerError(500, {}, "boom", new Headers()), /server error/],
    [new Anthropic.APIConnectionError({ message: "offline" }), /could not reach the API/],
  ])("turns an SDK error into readable advice", async (thrown, expected) => {
    const { client } = stub(thrown);
    const judge = new AnthropicJudge({ client });
    await expect(judge.judge(inputFor("strong"))).rejects.toThrow(expected);
    await expect(judge.judge(inputFor("strong"))).rejects.toThrow(JudgeError);
  });

  it("keeps the original error as the cause", async () => {
    const original = new Anthropic.RateLimitError(429, {}, "slow down", new Headers());
    const { client } = stub(original);
    await new AnthropicJudge({ client }).judge(inputFor("strong")).catch((error: unknown) => {
      expect((error as Error).cause).toBe(original);
    });
  });
});

describe("buildUserMessage", () => {
  it("hands the model the counts so it does not have to count", () => {
    const { draft, facts } = inputFor("strong");
    const message = buildUserMessage(draft, facts);
    expect(message).toContain(`news copy: ${facts.newsWords} words`);
    expect(message).toContain("direct quotes: 2");
    expect(message).toContain("Amara Okafor (");
    expect(message).toContain("Tom Reilly (");
  });

  it("reports an absence of quotes plainly", () => {
    const { draft, facts } = inputFor("weak");
    const message = buildUserMessage(draft, facts);
    expect(message).toContain("direct quotes: 0");
    expect(message).toMatch(/direct quotes: 0\n {2}none/);
    expect(message).toContain("dateline: none");
  });

  it("includes the headline and the body", () => {
    const { draft, facts } = inputFor("smart-quotes");
    const message = buildUserMessage(draft, facts);
    expect(message).toContain("Leeds Recycling Firm Wins");
    expect(message).toContain("Kirkgate Recovery has won");
  });
});

describe("clientOptions", () => {
  it("adds no default headers when an API key is in play", () => {
    expect(clientOptions({ ANTHROPIC_API_KEY: "sk-ant-x" })).toEqual({});
  });

  it("adds the OAuth beta header when only a bearer token is set", () => {
    expect(clientOptions({ ANTHROPIC_AUTH_TOKEN: "oat-x" })).toEqual({
      defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" },
    });
  });

  it("lets an API key win over a bearer token, matching the SDK's own order", () => {
    expect(clientOptions({ ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_AUTH_TOKEN: "oat-x" })).toEqual({});
  });

  it("adds nothing when neither is set", () => {
    expect(clientOptions({})).toEqual({});
  });
});

describe("credentialAdvice", () => {
  const noProfileDir = { HOME: "/nonexistent-home-for-tests" };

  it("advises when nothing at all is configured", () => {
    expect(credentialAdvice(noProfileDir)).toMatch(/no API credentials found/);
    expect(credentialAdvice(noProfileDir)).toMatch(/--offline/);
  });

  it.each([
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_PROFILE",
    "ANTHROPIC_FEDERATION_RULE_ID",
  ])("stays quiet when %s is set", (name) => {
    expect(credentialAdvice({ ...noProfileDir, [name]: "x" })).toBeNull();
  });

  it("does not fire for an empty string, which the SDK also ignores", () => {
    expect(credentialAdvice({ ...noProfileDir, ANTHROPIC_API_KEY: "" })).not.toBeNull();
  });
});

describe("AnthropicJudge construction", () => {
  it("refuses to build a real client with no credential, before any request", () => {
    const home = process.env["HOME"];
    process.env["HOME"] = "/nonexistent-home-for-tests";
    try {
      expect(() => new AnthropicJudge()).toThrow(MissingCredentialError);
      expect(() => new AnthropicJudge()).toThrow(/no API credentials found/);
    } finally {
      if (home === undefined) delete process.env["HOME"];
      else process.env["HOME"] = home;
    }
  });

  it("never checks credentials when a client is injected", () => {
    const { client } = stub({ parsed_output: VALID });
    expect(() => new AnthropicJudge({ client })).not.toThrow();
  });
});

describe("what the API schema actually constrains", () => {
  /**
   * This asserts a property of the SDK, not of our code, and it is the reason
   * parseJudgment re-validates everything the model returns. The zod-to-JSON-
   * Schema conversion renders value constraints as prose inside `description`
   * rather than as schema keywords, so the API guarantees the response's shape
   * and nothing about the numbers in it. If this test ever fails because the
   * bounds became real keywords, the local re-validation can be relaxed.
   */
  it("renders numeric bounds as prose, not as schema keywords", () => {
    const format = zodOutputFormat(z.object({ score: z.number().int().min(0).max(5) })) as {
      schema: { properties: { score: Record<string, unknown> } };
    };
    const score = format.schema.properties.score;

    expect(score["type"]).toBe("integer");
    expect(score["minimum"]).toBeUndefined();
    expect(score["maximum"]).toBeUndefined();
    expect(score["description"]).toBe("{minimum: 0, maximum: 5}");
  });

  it("does the same to array length limits", () => {
    const format = zodOutputFormat(z.object({ fixes: z.array(z.string()).max(3) })) as {
      schema: { properties: { fixes: Record<string, unknown> } };
    };
    expect(format.schema.properties.fixes["maxItems"]).toBeUndefined();
    expect(format.schema.properties.fixes["description"]).toBe("{maxItems: 3}");
  });
});
