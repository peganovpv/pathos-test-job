import type { Draft, Quote, QuoteStatement } from "../types.js";
import {
  collectStatements,
  countWords,
  extractQuotes,
  normalizePunctuation,
  splitSentences,
  words,
} from "./text.js";

const MONTHS =
  "January|February|March|April|May|June|July|August|September|October|November|December" +
  "|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec";

export const DATE_PATTERN = new RegExp(
  "\\b(?:" +
    `\\d{1,2}\\s+(?:${MONTHS})\\.?\\s+\\d{4}` +
    `|(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}` +
    "|\\d{4}-\\d{2}-\\d{2}" +
    "|\\d{1,2}/\\d{1,2}/\\d{2,4}" +
    ")\\b",
);

const RECENCY_PATTERN =
  /\b(?:today|yesterday|this (?:week|month|morning|afternoon)|next (?:week|month|year)|earlier this)\b/i;

const CITY_DASH = /^([A-Z][A-Za-z.'&-]*(?:\s+[A-Z][A-Za-z.'&-]*){0,3})(?:,\s*([A-Za-z.'&\s-]{2,30}?))?\s*-{1,3}\s*/;

const BOILERPLATE_START = /^(?:about\b|notes? to editors?\b)/i;
const CONTACT_START = /^(?:(?:media|press|for more)\s+)?(?:contact|contacts|enquiries|inquiries)\b/i;
const TERMINATOR = /^(?:#{3,}|-30-|-\s*ends?\s*-|ends\.?)$/i;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]{2,}/;
const PHONE = /(?:\+?\d[\d\s().-]{8,}\d)/;

const JARGON = [
  "leading provider", "world-class", "best-in-class", "cutting-edge", "state-of-the-art",
  "industry-leading", "game-chang(?:ing|er)", "revolutionary", "disrupt(?:ive|ing)",
  "synerg(?:y|ies|ise|ize)", "seamless(?:ly)?", "frictionless", "future-proof",
  "paradigm shift", "holistic", "end-to-end", "next generation", "next-generation",
  "delighted to announce", "excited to announce", "proud to announce", "thrilled to",
  "unlock(?:ing)? value", "drive outcomes", "transformational", "transformative",
  "mission-critical", "single source of truth", "actionable insights", "touchpoint",
  "one-stop shop", "move the needle", "low-hanging fruit", "leverag(?:e|es|ing)",
  "empower(?:s|ing)?", "in its DNA", "embedded into the DNA", "incredible journey",
];

const PASSIVE_PATTERN =
  /\b(?:is|are|was|were|been|being|be)\s+(?:\w+ly\s+)?(\w+(?:ed|en))\b/gi;

export interface Dateline {
  text: string;
  hasDate: boolean;
}

export interface Segments {
  news: string[];
  boilerplate: string[];
  contact: string[];
  hasTerminator: boolean;
}

export interface LeadSignals {
  who: boolean;
  when: boolean;
  where: boolean;
}

export interface Facts {
  headline: string;
  headlineWords: number;
  headlineChars: number;
  segments: Segments;
  newsWords: number;
  paragraphs: string[];
  sentences: string[];
  meanSentenceWords: number;
  longestSentences: string[];
  dateline: Dateline | null;
  lead: string;
  leadWords: number;
  leadSignals: LeadSignals;
  quotes: Quote[];
  statements: QuoteStatement[];
  jargon: Array<{ phrase: string; count: number }>;
  jargonTotal: number;
  passiveCount: number;
  passiveExamples: string[];
  hasEmail: boolean;
  hasPhone: boolean;
}

/**
 * A dateline is only accepted when the place is in the usual all-caps form, or
 * when a date follows the dash. Without that guard an ordinary sentence opening
 * with a proper noun and an em dash reads as a dateline.
 */
export function findDateline(lead: string): Dateline | null {
  const normalized = normalizePunctuation(lead);
  const match = CITY_DASH.exec(normalized);
  if (!match) return null;

  const place = match[1]!;
  const rest = normalized.slice(match[0].length);
  const leadingDate = new RegExp(`^(${DATE_PATTERN.source})\\s*-{1,3}\\s*`).exec(rest);
  const dateNearby = DATE_PATTERN.test(rest.slice(0, 40));

  if (place !== place.toUpperCase() && !dateNearby) return null;

  return {
    text: normalized.slice(0, match[0].length + (leadingDate?.[0].length ?? 0)).trim(),
    hasDate: dateNearby,
  };
}

export function stripDateline(lead: string): string {
  const dateline = findDateline(lead);
  if (!dateline) return lead;
  return normalizePunctuation(lead).slice(dateline.text.length).replace(/^[\s-]+/, "").trim();
}

/**
 * Boilerplate and contact blocks are not news copy, so they are held apart from
 * the paragraphs that length and readability checks run over. Counting them
 * would make every release look longer and flabbier than it reads.
 */
export function segmentBody(paragraphs: string[]): Segments {
  const news: string[] = [];
  const boilerplate: string[] = [];
  const contact: string[] = [];
  let hasTerminator = false;
  let section: "news" | "boilerplate" | "contact" = "news";

  for (const paragraph of paragraphs) {
    if (TERMINATOR.test(paragraph)) {
      hasTerminator = true;
      continue;
    }
    if (BOILERPLATE_START.test(paragraph)) {
      section = "boilerplate";
      boilerplate.push(paragraph);
      continue;
    }
    if (CONTACT_START.test(paragraph) || (section !== "news" && EMAIL.test(paragraph))) {
      section = "contact";
      contact.push(paragraph);
      continue;
    }
    if (section === "news") news.push(paragraph);
    else if (section === "boilerplate") boilerplate.push(paragraph);
    else contact.push(paragraph);
  }

  return { news, boilerplate, contact, hasTerminator };
}

function countJargon(text: string): Array<{ phrase: string; count: number }> {
  const hits: Array<{ phrase: string; count: number }> = [];
  for (const phrase of JARGON) {
    const matches = text.match(new RegExp(`\\b${phrase}\\b`, "gi"));
    if (matches) hits.push({ phrase: matches[0]!.toLowerCase(), count: matches.length });
  }
  return hits.sort((a, b) => b.count - a.count);
}

function findPassive(text: string): string[] {
  return [...text.matchAll(PASSIVE_PATTERN)].map((m) => m[0]!);
}

/**
 * A lead opening with the company name is correct inverted-pyramid style, so a
 * capitalised first word counts as naming an actor unless it is one of the
 * words a lead commonly opens with ("The company today announced...").
 */
const LEAD_OPENERS = new Set([
  "the", "a", "an", "this", "these", "it", "its", "they", "their", "we", "our",
  "in", "on", "at", "as", "after", "following", "today", "new", "there",
]);

function namesAnActor(text: string): boolean {
  return words(text).some(
    (token, index) =>
      /^[A-Z]/.test(token) && (index > 0 || !LEAD_OPENERS.has(token.toLowerCase())),
  );
}

function detectLeadSignals(lead: string, dateline: Dateline | null): LeadSignals {
  const withoutDateline = stripDateline(lead);
  return {
    who: namesAnActor(withoutDateline),
    when: DATE_PATTERN.test(lead) || RECENCY_PATTERN.test(withoutDateline),
    where: dateline !== null || /\b(?:in|across|at|from)\s+[A-Z][\w'-]+/.test(withoutDateline),
  };
}

export function computeFacts(draft: Draft): Facts {
  const segments = segmentBody(draft.paragraphs);
  const newsText = segments.news.join("\n\n");
  const sentences = splitSentences(newsText);
  const newsWords = countWords(newsText);
  const lead = segments.news[0] ?? "";
  const dateline = findDateline(lead);
  const quotes = extractQuotes(draft.body);
  const contactText = [...segments.contact, ...segments.boilerplate].join(" ");
  const jargon = countJargon(`${draft.headline}\n${newsText}`);
  const passive = findPassive(newsText);

  return {
    headline: draft.headline,
    headlineWords: countWords(draft.headline),
    headlineChars: draft.headline.length,
    segments,
    newsWords,
    paragraphs: segments.news,
    sentences,
    meanSentenceWords: sentences.length === 0 ? 0 : newsWords / sentences.length,
    longestSentences: [...sentences].sort((a, b) => countWords(b) - countWords(a)).slice(0, 2),
    dateline,
    lead,
    leadWords: countWords(stripDateline(lead)),
    leadSignals: detectLeadSignals(lead, dateline),
    quotes,
    statements: collectStatements(quotes),
    jargon,
    jargonTotal: jargon.reduce((total, hit) => total + hit.count, 0),
    passiveCount: passive.length,
    passiveExamples: passive.slice(0, 3),
    hasEmail: EMAIL.test(contactText) || EMAIL.test(draft.body),
    hasPhone: PHONE.test(contactText),
  };
}
