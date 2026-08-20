import type { Draft } from "../types.js";

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st",
  "inc", "ltd", "llc", "plc", "corp", "co", "dept", "div",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sept", "sep", "oct", "nov", "dec",
  "e.g", "i.e", "etc", "vs", "approx", "est", "no", "fig", "cf",
  "u.s", "u.k", "u.s.a", "a.m", "p.m",
]);

const WORD_PATTERN = /[\p{L}\p{N}](?:[\p{L}\p{N}'’-]|[.,](?=[\p{L}\p{N}]))*/gu;
const HAS_WORD = /[\p{L}\p{N}]/u;

/** Collapses typographic punctuation to its ASCII equivalent. */
export function normalizePunctuation(text: string): string {
  return text
    .replace(/[“”„‟«»]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[–—‒]/g, "-")
    .replace(/…/g, "...");
}

export function countWords(text: string): number {
  return (text.match(WORD_PATTERN) ?? []).length;
}

export function words(text: string): string[] {
  return text.match(WORD_PATTERN) ?? [];
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
}

function endsWithAbbreviation(sentence: string): boolean {
  const match = /([\p{L}.]+)\.["'”’)\]]*$/u.exec(sentence.trim());
  if (!match) return false;
  const token = match[1]!.toLowerCase().replace(/\.+$/, "");
  return ABBREVIATIONS.has(token) || /^\p{L}$/u.test(token);
}

export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];

  const sentences: string[] = [];
  const boundary = /[.!?]+["'”’)\]]*\s+/g;
  let start = 0;
  let match: RegExpExecArray | null;

  while ((match = boundary.exec(normalized)) !== null) {
    const end = match.index + match[0].length;
    const candidate = normalized.slice(start, end).trim();
    if (endsWithAbbreviation(candidate)) continue;
    sentences.push(candidate);
    start = end;
  }

  const tail = normalized.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences.filter((s) => HAS_WORD.test(s));
}

function cleanHeadline(line: string): string {
  return line
    .replace(/^#+\s*/, "")
    .replace(/^\*\*(.*)\*\*$/, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseDraft(raw: string): Draft {
  const lines = raw.split(/\r?\n/);
  const headlineIndex = lines.findIndex((line) => line.trim().length > 0);

  if (headlineIndex === -1) {
    return { raw, headline: "", body: "", paragraphs: [] };
  }

  const headline = cleanHeadline(lines[headlineIndex]!);
  const body = lines.slice(headlineIndex + 1).join("\n");

  return { raw, headline, body, paragraphs: splitParagraphs(body) };
}
