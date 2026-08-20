import type { Draft, Quote, QuoteStatement } from "../types.js";

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

const DOUBLE_QUOTE = '"';

const NAME = "(?:[A-Z][\\w'-]*\\s+){0,3}[A-Z][\\w'-]*";
const VERBS = "said|says|added|commented|explained|noted";

/**
 * Ordered most specific first: "Ruth Ellery, executive member, said" has to be
 * tried before "said <Name>", or the title clause swallows the name.
 */
const ATTRIBUTION_PATTERNS = [
  new RegExp(`\\b(${NAME})\\s*,[^.]{0,90},\\s*(?:${VERBS})\\b`),
  new RegExp(`\\b(?:${VERBS})\\s+(${NAME})`),
  new RegExp(`\\b(${NAME})\\s*,?\\s+(?:${VERBS})\\b`),
];

function matchAttribution(context: string): string | null {
  for (const pattern of ATTRIBUTION_PATTERNS) {
    const match = pattern.exec(context);
    if (match) return match[1]!.trim();
  }
  return null;
}

/**
 * The window is deliberately narrow — the text between this quote and its
 * neighbours, not the whole paragraph. A paragraph carrying two speakers would
 * otherwise attribute both quotes to whichever name appeared first, and putting
 * words in the wrong person's mouth is worse than reporting no attribution.
 * Text after the quote wins, since "…," said X is the commoner construction.
 */
function attributionFor(before: string, after: string): string | null {
  return matchAttribution(after) ?? matchAttribution(before);
}

interface PendingQuote {
  parts: string[];
  startParagraph: number;
  before: string;
}

function windowAfter(paragraph: string, close: number): string {
  const next = paragraph.indexOf(DOUBLE_QUOTE, close + 1);
  return next === -1 ? paragraph.slice(close + 1) : paragraph.slice(close + 1, next);
}

function buildQuote(
  pending: PendingQuote,
  after: string,
  endParagraph: number,
  unterminated: boolean,
): Quote {
  const text = pending.parts.join(" ").replace(/\s+/g, " ").trim();
  return {
    text,
    words: countWords(text),
    attribution: attributionFor(pending.before, after),
    spansParagraphs: endParagraph > pending.startParagraph,
    unterminated,
  };
}

/**
 * Only double quotes delimit a quote. Single quotes are left alone because in
 * running prose they are overwhelmingly apostrophes, and typographic
 * apostrophes are folded onto them by normalizePunctuation.
 */
export function extractQuotes(body: string): Quote[] {
  const paragraphs = splitParagraphs(normalizePunctuation(body));
  const quotes: Quote[] = [];
  let pending: PendingQuote | null = null;

  paragraphs.forEach((paragraph, index) => {
    let cursor = 0;

    if (pending) {
      // A quote continued across a paragraph break re-opens with a quote mark
      // and never closed the previous paragraph. Drop the continuation marker.
      if (paragraph.startsWith(DOUBLE_QUOTE)) cursor = 1;
      const close = paragraph.indexOf(DOUBLE_QUOTE, cursor);
      if (close === -1) {
        pending.parts.push(paragraph.slice(cursor));
        return;
      }
      pending.parts.push(paragraph.slice(cursor, close));
      quotes.push(buildQuote(pending, windowAfter(paragraph, close), index, false));
      pending = null;
      cursor = close + 1;
    }

    for (;;) {
      const open = paragraph.indexOf(DOUBLE_QUOTE, cursor);
      if (open === -1) break;

      const before = paragraph.slice(cursor, open);
      const close = paragraph.indexOf(DOUBLE_QUOTE, open + 1);

      if (close === -1) {
        pending = { parts: [paragraph.slice(open + 1)], startParagraph: index, before };
        break;
      }

      quotes.push(
        buildQuote(
          { parts: [paragraph.slice(open + 1, close)], startParagraph: index, before },
          windowAfter(paragraph, close),
          index,
          false,
        ),
      );
      cursor = close + 1;
    }
  });

  if (pending) {
    quotes.push(buildQuote(pending, "", paragraphs.length - 1, true));
  }

  return quotes;
}

/**
 * `"A." said Okafor. "B."` is house style for one quote interrupted by
 * attribution, not two quotes. Counting passages would flag a correctly
 * written release for having too many quotes, so consecutive passages sharing
 * an attribution are merged into a single statement.
 */
export function collectStatements(quotes: Quote[]): QuoteStatement[] {
  const statements: QuoteStatement[] = [];

  for (const quote of quotes) {
    const previous = statements.at(-1);
    const mergeable =
      previous !== undefined &&
      previous.attribution !== null &&
      previous.attribution === quote.attribution;

    if (mergeable) {
      previous.text = `${previous.text} ${quote.text}`.replace(/\s+/g, " ").trim();
      previous.words = countWords(previous.text);
      previous.passages += 1;
      previous.spansParagraphs ||= quote.spansParagraphs;
      previous.unterminated ||= quote.unterminated;
      continue;
    }

    statements.push({
      text: quote.text,
      words: quote.words,
      attribution: quote.attribution,
      passages: 1,
      spansParagraphs: quote.spansParagraphs,
      unterminated: quote.unterminated,
    });
  }

  return statements;
}
