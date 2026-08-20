import { DEFAULT_THRESHOLDS, type Thresholds } from "./config.js";
import type { Judge, Judgment } from "./llm/port.js";
import { computeFacts, type Facts } from "./rubric/facts.js";
import { runHeadlineChecks } from "./rubric/headline.js";
import { runStructureChecks } from "./rubric/structure.js";
import { parseDraft } from "./rubric/text.js";
import type { Band, CategoryKey, Finding, Severity } from "./types.js";

const SEVERITY_PENALTY: Record<Severity, number> = { high: 1, medium: 0.5, low: 0.25 };
const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 };
const MAX_SCORE = 5;

export const BAND_THRESHOLDS = { ready: 80, needsWork: 60 } as const;

export interface CategoryResult {
  key: CategoryKey;
  label: string;
  score: number;
  weight: number;
  source: "deterministic" | "llm" | "hybrid";
  rationale: string | null;
  findings: Finding[];
}

export interface ReportFacts {
  headlineWords: number;
  newsWords: number;
  paragraphs: number;
  meanSentenceWords: number;
  quotes: number;
  attributedQuotes: number;
  jargonInstances: number;
  hasDateline: boolean;
  hasContact: boolean;
}

export interface Report {
  overall: number;
  band: Band;
  categories: CategoryResult[];
  skipped: CategoryKey[];
  topFixes: Finding[];
  suggestedHeadlines: string[];
  verdict: string | null;
  facts: ReportFacts;
}

/** 5 minus the weight of everything found wrong, floored at zero. */
export function scoreFromFindings(findings: Finding[]): number {
  const penalty = findings.reduce((total, finding) => total + SEVERITY_PENALTY[finding.severity], 0);
  return Math.max(0, MAX_SCORE - penalty);
}

export function bandFor(overall: number): Band {
  if (overall >= BAND_THRESHOLDS.ready) return "ready";
  if (overall >= BAND_THRESHOLDS.needsWork) return "needs-work";
  return "rewrite";
}

function tag(findings: Finding[], category: CategoryKey): Finding[] {
  return findings.map((finding) => ({ ...finding, category }));
}

/**
 * Turns the model's free-text fixes into findings so they rank alongside the
 * deterministic ones. Severity comes from the category score: advice about a
 * category scoring 2 out of 5 matters more than advice about one scoring 4.
 */
function judgmentFindings(category: CategoryKey, score: number, fixes: string[]): Finding[] {
  const severity: Severity = score <= 2 ? "high" : score === 3 ? "medium" : "low";
  return fixes.map((fix, index) => ({
    id: `${category}-fix-${index + 1}`,
    severity,
    message: fix,
    category,
  }));
}

function summarize(facts: Facts): ReportFacts {
  return {
    headlineWords: facts.headlineWords,
    newsWords: facts.newsWords,
    paragraphs: facts.paragraphs.length,
    meanSentenceWords: Number(facts.meanSentenceWords.toFixed(1)),
    quotes: facts.statements.length,
    attributedQuotes: facts.statements.filter((s) => s.attribution !== null).length,
    jargonInstances: facts.jargonTotal,
    hasDateline: facts.dateline !== null,
    hasContact: facts.hasEmail || facts.hasPhone,
  };
}

/**
 * Ranked so the reader's first three actions are the ones that move the score
 * most: severity first, then the weight of the category the finding sits in.
 */
function rankFixes(categories: CategoryResult[]): Finding[] {
  const weightOf = new Map(categories.map((category) => [category.key, category.weight]));
  return categories
    .flatMap((category) => category.findings)
    .sort((a, b) => {
      const bySeverity = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (bySeverity !== 0) return bySeverity;
      return (weightOf.get(b.category!) ?? 0) - (weightOf.get(a.category!) ?? 0);
    });
}

export function buildReport(
  raw: string,
  judgment: Judgment | null,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Report {
  const draft = parseDraft(raw);
  const facts = computeFacts(draft);
  const { weights } = thresholds;

  const structureFindings = tag(runStructureChecks(facts, thresholds), "structure");
  const headlineFindings = tag(runHeadlineChecks(facts, thresholds), "headline");

  const categories: CategoryResult[] = [
    {
      key: "structure",
      label: "Structure & length",
      score: scoreFromFindings(structureFindings),
      weight: weights.structure,
      source: "deterministic",
      rationale: null,
      findings: structureFindings,
    },
    {
      key: "headline",
      label: "Headline strength",
      // The deterministic faults are deducted from the model's judgement, so a
      // headline the model likes still loses points for being 20 words long.
      score: Math.max(
        0,
        (judgment?.headline.score ?? MAX_SCORE) - (MAX_SCORE - scoreFromFindings(headlineFindings)),
      ),
      weight: weights.headline,
      source: judgment ? "hybrid" : "deterministic",
      rationale: judgment?.headline.rationale ?? null,
      findings: [
        ...headlineFindings,
        ...(judgment
          ? judgmentFindings("headline", judgment.headline.score, judgment.headline.fixes)
          : []),
      ],
    },
  ];

  const skipped: CategoryKey[] = [];

  for (const key of ["newsworthiness", "quoteability"] as const) {
    const label = key === "newsworthiness" ? "Newsworthiness" : "Quoteability";
    if (!judgment) {
      skipped.push(key);
      continue;
    }
    categories.push({
      key,
      label,
      score: judgment[key].score,
      weight: weights[key],
      source: "llm",
      rationale: judgment[key].rationale,
      findings: judgmentFindings(key, judgment[key].score, judgment[key].fixes),
    });
  }

  const totalWeight = categories.reduce((total, category) => total + category.weight, 0);
  const earned = categories.reduce(
    (total, category) => total + (category.score / MAX_SCORE) * category.weight,
    0,
  );
  const overall = totalWeight === 0 ? 0 : Math.round((earned / totalWeight) * 100);

  const order: CategoryKey[] = ["newsworthiness", "structure", "quoteability", "headline"];
  categories.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));

  return {
    overall,
    band: bandFor(overall),
    categories,
    skipped,
    topFixes: rankFixes(categories),
    suggestedHeadlines: judgment?.suggestedHeadlines ?? [],
    verdict: judgment?.verdict ?? null,
    facts: summarize(facts),
  };
}

export interface GradeOptions {
  judge?: Judge | null;
  thresholds?: Thresholds;
}

export async function grade(raw: string, options: GradeOptions = {}): Promise<Report> {
  const thresholds = options.thresholds ?? DEFAULT_THRESHOLDS;
  const draft = parseDraft(raw);
  const judgment = options.judge
    ? await options.judge.judge({ draft, facts: computeFacts(draft) })
    : null;
  return buildReport(raw, judgment, thresholds);
}
