import type { Report } from "./score.js";
import type { Band, Finding, Severity } from "./types.js";

const BAND_LABEL: Record<Band, string> = {
  ready: "Ready to send",
  "needs-work": "Needs work",
  rewrite: "Rewrite",
};

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  yellow: "\u001b[33m",
  green: "\u001b[32m",
  cyan: "\u001b[36m",
} as const;

const SEVERITY_COLOUR: Record<Severity, keyof typeof ANSI> = {
  high: "red",
  medium: "yellow",
  low: "dim",
};

const BAND_COLOUR: Record<Band, keyof typeof ANSI> = {
  ready: "green",
  "needs-work": "yellow",
  rewrite: "red",
};

const BAR_WIDTH = 20;

export interface RenderOptions {
  colour?: boolean;
  source?: string;
  maxFixes?: number;
}

function bar(score: number): string {
  const filled = Math.round((score / 5) * BAR_WIDTH);
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function formatScore(score: number): string {
  return Number.isInteger(score) ? `${score}` : score.toFixed(1);
}

export function renderTerminal(report: Report, options: RenderOptions = {}): string {
  const colour = options.colour ?? false;
  const maxFixes = options.maxFixes ?? 5;
  const paint = (text: string, key: keyof typeof ANSI): string =>
    colour ? `${ANSI[key]}${text}${ANSI.reset}` : text;

  const lines: string[] = [];
  const heading = options.source
    ? `Press release quality check — ${options.source}`
    : "Press release quality check";

  lines.push("", paint(heading, "bold"), "");
  lines.push(
    `  ${paint("OVERALL", "bold")}  ${paint(`${report.overall}/100`, "bold")}   ${paint(
      BAND_LABEL[report.band],
      BAND_COLOUR[report.band],
    )}`,
    "",
  );

  const labelWidth = Math.max(...report.categories.map((category) => category.label.length));
  for (const category of report.categories) {
    lines.push(
      `  ${category.label.padEnd(labelWidth)}  ${bar(category.score)}  ${formatScore(
        category.score,
      ).padStart(3)}/5  ${paint(category.source, "dim")}`,
    );
    if (category.rationale) {
      lines.push(`  ${" ".repeat(labelWidth)}  ${paint(category.rationale, "dim")}`);
    }
  }

  if (report.skipped.length > 0) {
    lines.push(
      "",
      paint(
        `  Not scored: ${report.skipped.join(" and ")} — no model call was made, so the overall is out of the remaining categories.`,
        "dim",
      ),
    );
  }

  const fixes = report.topFixes.slice(0, maxFixes);
  if (fixes.length > 0) {
    lines.push("", paint("  What to fix first", "bold"));
    fixes.forEach((finding: Finding, index) => {
      const marker = paint(`[${finding.severity}]`, SEVERITY_COLOUR[finding.severity]);
      lines.push(`   ${index + 1}. ${marker} ${finding.message}`);
      if (finding.evidence) lines.push(`      ${paint(`“${finding.evidence}”`, "dim")}`);
      if (finding.suggestion) lines.push(`      ${paint(`→ ${finding.suggestion}`, "cyan")}`);
    });
    if (report.topFixes.length > fixes.length) {
      lines.push(paint(`   … and ${report.topFixes.length - fixes.length} more`, "dim"));
    }
  }

  if (report.suggestedHeadlines.length > 0) {
    lines.push("", paint("  Suggested headlines", "bold"));
    for (const headline of report.suggestedHeadlines) lines.push(`   · ${headline}`);
  }

  const f = report.facts;
  lines.push(
    "",
    paint("  Measured", "bold") +
      `  ${f.newsWords} words · ${f.paragraphs} paragraphs · mean sentence ${f.meanSentenceWords} words`,
    `            ${f.quotes} quotes (${f.attributedQuotes} attributed) · ${
      f.hasDateline ? "dateline" : "no dateline"
    } · ${f.hasContact ? "contact details" : "no contact details"} · ${f.jargonInstances} jargon instances`,
  );

  if (report.verdict) {
    lines.push("", `  ${paint("Verdict", "bold")}   ${report.verdict}`);
  }

  lines.push("");
  return lines.join("\n");
}

export function toJson(report: Report, meta: Record<string, unknown> = {}): string {
  return `${JSON.stringify({ ...meta, ...report }, null, 2)}\n`;
}
