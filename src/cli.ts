#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import "dotenv/config";
import { ConfigError, DEFAULT_THRESHOLDS, loadThresholds, type Thresholds } from "./config.js";
import { AnthropicJudge } from "./llm/anthropic.js";
import { JudgeError, type Judge } from "./llm/port.js";
import { renderTerminal, toJson } from "./report.js";
import { grade } from "./score.js";

const DEFAULT_CONFIG_FILE = "prq.config.json";

export const EXIT = {
  ok: 0,
  belowThreshold: 1,
  usage: 2,
  judge: 3,
} as const;

interface CheckOptions {
  json?: boolean;
  offline?: boolean;
  model?: string;
  config?: string;
  minScore?: number;
  colour?: boolean;
}

function integerOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new InvalidArgumentError("expected a whole number between 0 and 100");
  }
  return parsed;
}

function resolveThresholds(explicitPath: string | undefined): Thresholds {
  if (explicitPath) return loadThresholds(resolve(explicitPath));
  const discovered = resolve(process.cwd(), DEFAULT_CONFIG_FILE);
  return existsSync(discovered) ? loadThresholds(discovered) : DEFAULT_THRESHOLDS;
}

/**
 * Commander gives `--no-colour` a default of true, so the flag being absent is
 * indistinguishable from it being passed as true. Only an explicit false is
 * treated as a choice; otherwise colour follows the terminal.
 */
function useColour(flag: boolean | undefined): boolean {
  if (flag === false) return false;
  if (process.env["FORCE_COLOR"]) return true;
  if (process.env["NO_COLOR"]) return false;
  return process.stdout.isTTY === true;
}

function readDraft(path: string): string {
  try {
    return readFileSync(path === "-" ? 0 : path, "utf8");
  } catch {
    throw new ConfigError(`cannot read ${path === "-" ? "standard input" : path}`);
  }
}

export async function runCheck(file: string, options: CheckOptions): Promise<number> {
  const thresholds = resolveThresholds(options.config);
  const raw = readDraft(file);

  if (raw.trim().length === 0) {
    process.stderr.write(`prq: ${file} is empty\n`);
    return EXIT.usage;
  }

  const judge: Judge | null = options.offline
    ? null
    : new AnthropicJudge(options.model ? { model: options.model } : {});

  const report = await grade(raw, { judge, thresholds });

  if (options.json) {
    process.stdout.write(
      toJson(report, {
        source: file === "-" ? "(stdin)" : file,
        model: judge?.name ?? null,
        offline: judge === null,
      }),
    );
  } else {
    process.stdout.write(
      renderTerminal(report, {
        colour: useColour(options.colour),
        source: file === "-" ? "(stdin)" : file,
      }),
    );
  }

  if (options.minScore !== undefined && report.overall < options.minScore) {
    process.stderr.write(
      `prq: scored ${report.overall}, below the required ${options.minScore}\n`,
    );
    return EXIT.belowThreshold;
  }
  return EXIT.ok;
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("prq")
    .description("Score a draft press release against a PR rubric.")
    .showHelpAfterError();

  program
    .command("check", { isDefault: true })
    .argument("<file>", "path to the draft, or - for standard input")
    .description("score a draft and print what to fix first")
    .option("--json", "emit the report as JSON")
    .option("--offline", "skip the model call and run the deterministic checks only")
    .option("--model <id>", "model id to judge with")
    .option("--config <path>", `threshold config (default: ./${DEFAULT_CONFIG_FILE} if present)`)
    .option("--min-score <n>", "exit 1 if the overall score falls below this", integerOption)
    .option("--no-colour", "never colourise output")
    .action(async (file: string, options: CheckOptions) => {
      process.exitCode = await runCheck(file, options);
    });

  return program;
}

async function main(argv: string[]): Promise<void> {
  try {
    await buildProgram().parseAsync(argv);
  } catch (error) {
    if (error instanceof JudgeError) {
      process.stderr.write(`prq: ${error.message}\n`);
      process.exitCode = EXIT.judge;
      return;
    }
    if (error instanceof ConfigError) {
      process.stderr.write(`prq: ${error.message}\n`);
      process.exitCode = EXIT.usage;
      return;
    }
    throw error;
  }
}

// Only run when invoked as a program, so the exported helpers stay testable.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  await main(process.argv);
}
