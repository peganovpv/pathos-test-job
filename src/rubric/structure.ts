import type { Thresholds } from "../config.js";
import type { Finding } from "../types.js";
import type { Facts } from "./facts.js";
import { countWords, splitSentences } from "./text.js";

export type Check = (facts: Facts, thresholds: Thresholds) => Finding[];

function excerpt(text: string, limit = 110): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1).trimEnd()}…`;
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export const bodyLength: Check = (facts, { body }) => {
  const words = facts.newsWords;

  if (words > body.hardMax) {
    return [{
      id: "body-length",
      severity: "high",
      message: `${words} words of news copy, against a ${body.idealMin}-${body.idealMax} target. Past ${body.hardMax} words a journalist stops reading before the point arrives.`,
      suggestion: `Cut to ${body.idealMax} words. Anything a reader could skip without losing the news belongs in the boilerplate or a follow-up.`,
    }];
  }
  if (words < body.hardMin) {
    return [{
      id: "body-length",
      severity: "high",
      message: `Only ${words} words of news copy. There is not enough here for a journalist to write from.`,
      suggestion: "Add the specifics: numbers, dates, names, and what changes for whom.",
    }];
  }
  if (words > body.idealMax) {
    return [{
      id: "body-length",
      severity: "low",
      message: `${words} words of news copy, a little over the ${body.idealMax}-word target.`,
      suggestion: "Tighten rather than restructure — the shape is right.",
    }];
  }
  if (words < body.idealMin) {
    return [{
      id: "body-length",
      severity: "low",
      message: `${words} words of news copy, a little under the ${body.idealMin}-word target.`,
      suggestion: "One more paragraph of substance — context, a second data point, or what happens next.",
    }];
  }
  return [];
};

export const leadLength: Check = (facts, { lead }) => {
  if (facts.leadWords <= lead.maxWords) return [];
  const severity = facts.leadWords > lead.maxWords * 1.5 ? "high" : "medium";
  return [{
    id: "lead-length",
    severity,
    message: `The lead runs to ${facts.leadWords} words, against a ${lead.maxWords}-word maximum.`,
    evidence: excerpt(facts.lead),
    suggestion: "State the news in one sentence, then stop. Everything else is paragraph two.",
  }];
};

export const leadSignals: Check = (facts) => {
  const missing = (["who", "when", "where"] as const).filter((key) => !facts.leadSignals[key]);
  if (missing.length === 0) return [];
  return [{
    id: "lead-signals",
    severity: missing.length > 1 ? "medium" : "low",
    message: `The lead does not appear to establish ${missing.join(" or ")}.`,
    evidence: excerpt(facts.lead),
    suggestion: "A lead should carry who did what, when, and where, in that order of priority.",
  }];
};

export const dateline: Check = (facts) => {
  if (facts.dateline === null) {
    return [{
      id: "dateline",
      severity: "medium",
      message: "No dateline found at the start of the lead.",
      suggestion: "Open with the convention: CITY, Country — Date — then the news.",
    }];
  }
  if (!facts.dateline.hasDate) {
    return [{
      id: "dateline",
      severity: "low",
      message: `The dateline names a place but no date: "${facts.dateline.text}".`,
      suggestion: "Add the release date so a desk picking this up months later knows it is not current.",
    }];
  }
  return [];
};

export const paragraphLength: Check = (facts, { paragraph }) => {
  const offenders = facts.paragraphs.filter(
    (p) => splitSentences(p).length > paragraph.maxSentences || countWords(p) > paragraph.maxWords,
  );
  if (offenders.length === 0) return [];
  return [{
    id: "paragraph-length",
    severity: offenders.length > 2 ? "medium" : "low",
    message: `${plural(offenders.length, "paragraph")} ${offenders.length === 1 ? "exceeds" : "exceed"} ${paragraph.maxSentences} sentences or ${paragraph.maxWords} words.`,
    evidence: excerpt(offenders[0]!),
    suggestion: "Break on the turn in the argument. Two or three sentences a paragraph reads faster on a phone.",
  }];
};

export const sentenceLength: Check = (facts, { sentence }) => {
  if (facts.sentences.length === 0 || facts.meanSentenceWords <= sentence.maxMeanWords) return [];
  const mean = facts.meanSentenceWords;
  return [{
    id: "sentence-length",
    severity: mean > sentence.maxMeanWords * 1.6 ? "high" : "medium",
    message: `Sentences average ${mean.toFixed(0)} words, against a ${sentence.maxMeanWords}-word target.`,
    evidence: excerpt(facts.longestSentences[0] ?? ""),
    suggestion: "Split on every 'and' and every subordinate clause that carries a second idea.",
  }];
};

export const quoteCount: Check = (facts, { quotes }) => {
  const count = facts.statements.length;

  if (count === 0) {
    return [{
      id: "quote-count",
      severity: "high",
      message: "No direct quotes. There is nothing here a journalist can lift.",
      suggestion: "Add one quote that makes an argument the surrounding copy cannot make for itself.",
    }];
  }
  if (count < quotes.min) {
    return [{
      id: "quote-count",
      severity: "high",
      message: `${plural(count, "quote")}, against a minimum of ${quotes.min}.`,
      suggestion: "Add a quote from someone with standing to say it.",
    }];
  }
  if (count > quotes.idealMax) {
    return [{
      id: "quote-count",
      severity: "low",
      message: `${plural(count, "quote")}, more than the ${quotes.idealMax} a release of this length carries comfortably.`,
      suggestion: "Keep the ones that argue. Cut the ones that congratulate.",
    }];
  }
  return [];
};

export const quoteAttribution: Check = (facts) => {
  const unattributed = facts.statements.filter((statement) => statement.attribution === null);
  if (unattributed.length === 0) return [];
  return [{
    id: "quote-attribution",
    severity: "medium",
    message: `${plural(unattributed.length, "quote")} could not be tied to a named speaker.`,
    evidence: excerpt(unattributed[0]!.text),
    suggestion: "Attribute every quote by name and job title. An unattributed quote is unusable.",
  }];
};

export const quoteLength: Check = (facts, { quotes }) => {
  const long = facts.statements.filter((statement) => statement.words > quotes.maxWords);
  if (long.length === 0) return [];
  const longest = long.reduce((a, b) => (b.words > a.words ? b : a));
  return [{
    id: "quote-length",
    severity: "low",
    message: `${plural(long.length, "quote")} ${long.length === 1 ? "runs" : "run"} past ${quotes.maxWords} words — the longest is ${longest.words}.`,
    evidence: excerpt(longest.text),
    suggestion: "A quote that survives editing is one or two sentences. Move the rest into the body as fact.",
  }];
};

export const unterminatedQuote: Check = (facts) => {
  if (!facts.quotes.some((quote) => quote.unterminated)) return [];
  return [{
    id: "quote-unterminated",
    severity: "medium",
    message: "A quote mark opens and is never closed.",
    suggestion: "Check the quote marks. As written, it is ambiguous where the speaker stops.",
  }];
};

export const boilerplate: Check = (facts) => {
  if (facts.segments.boilerplate.length > 0) return [];
  return [{
    id: "boilerplate",
    severity: "low",
    message: "No 'About …' boilerplate.",
    suggestion: "Add two or three sentences on what the company is, so a desk can identify you without searching.",
  }];
};

export const contactDetails: Check = (facts) => {
  if (facts.hasEmail || facts.hasPhone) return [];
  return [{
    id: "contact",
    severity: "medium",
    message: "No contact email or phone number.",
    suggestion: "Name a person who can answer a question today, with a direct line.",
  }];
};

export const jargonDensity: Check = (facts) => {
  if (facts.jargonTotal === 0) return [];
  const severity = facts.jargonTotal >= 6 ? "high" : facts.jargonTotal >= 3 ? "medium" : "low";
  return [{
    id: "jargon",
    severity,
    message: `${plural(facts.jargonTotal, "instance")} of PR boilerplate language.`,
    evidence: facts.jargon.slice(0, 6).map((hit) => (hit.count > 1 ? `${hit.phrase} (×${hit.count})` : hit.phrase)).join(", "),
    suggestion: "Replace each with the specific claim underneath it, or cut it. A journalist reads these as padding.",
  }];
};

export const passiveVoice: Check = (facts) => {
  if (facts.sentences.length === 0) return [];
  const ratio = facts.passiveCount / facts.sentences.length;
  if (ratio <= 0.5) return [];
  return [{
    id: "passive-voice",
    severity: ratio > 1 ? "medium" : "low",
    message: `${plural(facts.passiveCount, "passive or weak linking construction")} across ${plural(facts.sentences.length, "sentence")}.`,
    evidence: facts.passiveExamples.join(", "),
    suggestion: "Name the actor and use an active verb: who did what, not what was done.",
  }];
};

export const terminator: Check = (facts) => {
  if (facts.segments.hasTerminator) return [];
  return [{
    id: "terminator",
    severity: "low",
    message: "No end marker after the copy.",
    suggestion: "Close with ### or ENDS so it is clear nothing was truncated.",
  }];
};

export const STRUCTURE_CHECKS: Check[] = [
  bodyLength,
  leadLength,
  leadSignals,
  dateline,
  paragraphLength,
  sentenceLength,
  quoteCount,
  quoteAttribution,
  quoteLength,
  unterminatedQuote,
  boilerplate,
  contactDetails,
  jargonDensity,
  passiveVoice,
  terminator,
];

export function runStructureChecks(facts: Facts, thresholds: Thresholds): Finding[] {
  return STRUCTURE_CHECKS.flatMap((check) => check(facts, thresholds));
}
