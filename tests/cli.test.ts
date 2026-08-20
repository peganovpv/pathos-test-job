import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { renderTerminal, toJson } from "../src/report.js";
import { buildReport } from "../src/score.js";
import { judgment } from "../src/llm/fake.js";
import { loadFixture } from "./fixtures.test.js";

const run = promisify(execFile);

/**
 * The CLI is exercised as a subprocess so the exit codes, the argument parsing
 * and the absence of colour when piped are all covered for real. Every case
 * uses --offline, so nothing here touches the network.
 */
async function prq(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run("npx", ["tsx", "src/cli.ts", ...args], {
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "" },
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

describe("prq check --offline", () => {
  it("scores the strong fixture as ready to send", async () => {
    const { code, stdout } = await prq("check", "tests/fixtures/strong.md", "--offline");
    expect(code).toBe(0);
    expect(stdout).toContain("100/100");
    expect(stdout).toContain("Ready to send");
  });

  it("scores the weak fixture as a rewrite and lists what to fix", async () => {
    const { code, stdout } = await prq("check", "tests/fixtures/weak.md", "--offline");
    expect(code).toBe(0);
    expect(stdout).toContain("Rewrite");
    expect(stdout).toContain("What to fix first");
    expect(stdout).toContain("No direct quotes");
  });

  it("says which categories were not scored", async () => {
    const { stdout } = await prq("check", "tests/fixtures/strong.md", "--offline");
    expect(stdout).toContain("Not scored: newsworthiness and quoteability");
  });

  it("emits no escape codes when the output is piped", async () => {
    const { stdout } = await prq("check", "tests/fixtures/weak.md", "--offline");
    expect(stdout).not.toMatch(/\u001b\[/);
  });
}, 60_000);

describe("prq check --json", () => {
  it("emits parseable JSON carrying the source and offline flag", async () => {
    const { stdout } = await prq("check", "tests/fixtures/strong.md", "--offline", "--json");
    const parsed = JSON.parse(stdout);
    expect(parsed.source).toBe("tests/fixtures/strong.md");
    expect(parsed.offline).toBe(true);
    expect(parsed.model).toBeNull();
    expect(parsed.overall).toBe(100);
    expect(parsed.skipped).toEqual(["newsworthiness", "quoteability"]);
  });

  it("carries every finding, not just the ones printed", async () => {
    const { stdout } = await prq("check", "tests/fixtures/weak.md", "--offline", "--json");
    const parsed = JSON.parse(stdout);
    expect(parsed.topFixes.length).toBeGreaterThan(5);
  });
}, 60_000);

describe("prq exit codes", () => {
  it("exits 1 when the score is below --min-score", async () => {
    const { code, stderr } = await prq(
      "check", "tests/fixtures/weak.md", "--offline", "--min-score", "70",
    );
    expect(code).toBe(1);
    expect(stderr).toContain("below the required 70");
  });

  it("exits 0 when the score clears --min-score", async () => {
    const { code } = await prq("check", "tests/fixtures/strong.md", "--offline", "--min-score", "70");
    expect(code).toBe(0);
  });

  it("exits 2 for a file that is not there", async () => {
    const { code, stderr } = await prq("check", "tests/fixtures/nope.md", "--offline");
    expect(code).toBe(2);
    expect(stderr).toContain("cannot read");
  });

  it("rejects a --min-score outside 0-100", async () => {
    const { code, stderr } = await prq(
      "check", "tests/fixtures/strong.md", "--offline", "--min-score", "500",
    );
    expect(code).not.toBe(0);
    expect(stderr).toContain("whole number between 0 and 100");
  });

  it("exits 2 for an unreadable config file", async () => {
    const { code, stderr } = await prq(
      "check", "tests/fixtures/strong.md", "--offline", "--config", "nope.json",
    );
    expect(code).toBe(2);
    expect(stderr).toContain("cannot read config file");
  });
}, 60_000);

describe("renderTerminal", () => {
  const report = buildReport(loadFixture("weak"), judgment({
    newsworthiness: { score: 1, rationale: "Nothing has happened yet.", fixes: ["Lead with the launch date."] },
    quoteability: { score: 0, rationale: "No quotes at all.", fixes: ["Add one quote from the founder."] },
    headline: { score: 1, rationale: "A label, not news.", fixes: [] },
    suggestedHeadlines: ["Vertexa Launches AI Platform For Mid-Market Firms"],
    verdict: "Rewrite around the launch itself.",
  }));

  it("shows every category with its source and rationale", () => {
    const output = renderTerminal(report);
    expect(output).toContain("Newsworthiness");
    expect(output).toContain("Nothing has happened yet.");
    expect(output).toContain("hybrid");
    expect(output).toContain("llm");
  });

  it("caps the printed fixes and says how many were held back", () => {
    const output = renderTerminal(report, { maxFixes: 3 });
    expect(output).toMatch(/\.\.\.|…/);
    expect(output).toContain("more");
    expect(output.match(/^ {3}\d\. /gm)).toHaveLength(3);
  });

  it("prints suggested headlines and the verdict", () => {
    const output = renderTerminal(report);
    expect(output).toContain("Vertexa Launches AI Platform");
    expect(output).toContain("Rewrite around the launch itself.");
  });

  it("omits the not-scored notice when every category ran", () => {
    expect(renderTerminal(report)).not.toContain("Not scored");
  });

  it("adds escape codes only when asked", () => {
    expect(renderTerminal(report, { colour: false })).not.toMatch(/\u001b\[/);
    expect(renderTerminal(report, { colour: true })).toMatch(/\u001b\[/);
  });

  it("names the source file when given one", () => {
    expect(renderTerminal(report, { source: "draft.md" })).toContain("draft.md");
  });
});

describe("toJson", () => {
  it("merges metadata over the report and ends with a newline", () => {
    const output = toJson(buildReport(loadFixture("strong"), null), { source: "x.md" });
    expect(output.endsWith("\n")).toBe(true);
    expect(JSON.parse(output).source).toBe("x.md");
    expect(JSON.parse(output).band).toBe("ready");
  });
});
