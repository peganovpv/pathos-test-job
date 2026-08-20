import type { Thresholds } from "../config.js";
import type { Finding } from "../types.js";
import type { Facts } from "./facts.js";
import type { Check } from "./structure.js";
import { words } from "./text.js";

/**
 * Verbs that carry news in a headline. Deliberately excludes "introducing",
 * "announcing" and friends — those label a thing rather than report an event,
 * and are handled by headlineIsLabel below.
 */
const NEWS_VERBS = new Set([
  "launch", "launches", "launching", "open", "opens", "opening", "win", "wins", "winning",
  "won", "raise", "raises", "raising", "raised", "secure", "secures", "securing", "secured",
  "appoint", "appoints", "appointing", "appointed", "acquire", "acquires", "acquiring",
  "acquired", "buy", "buys", "buying", "bought", "sell", "sells", "selling", "sold",
  "expand", "expands", "expanding", "expanded", "report", "reports", "reporting", "reported",
  "name", "names", "naming", "named", "join", "joins", "joining", "joined", "partner",
  "partners", "partnering", "partnered", "sign", "signs", "signing", "signed", "hire",
  "hires", "hiring", "hired", "cut", "cuts", "cutting", "invest", "invests", "investing",
  "invested", "back", "backs", "backing", "backed", "close", "closes", "closing", "closed",
  "add", "adds", "adding", "added", "create", "creates", "creating", "created", "double",
  "doubles", "doubling", "doubled", "triple", "triples", "tripling", "grow", "grows",
  "growing", "grew", "rise", "rises", "rising", "rose", "fall", "falls", "falling", "fell",
  "beat", "beats", "beating", "take", "takes", "taking", "took", "move", "moves", "moving",
  "moved", "plan", "plans", "planning", "planned", "agree", "agrees", "agreeing", "agreed",
  "complete", "completes", "completing", "completed", "start", "starts", "starting",
  "started", "begin", "begins", "beginning", "began", "set", "sets", "setting", "bring",
  "brings", "bringing", "brought", "deliver", "delivers", "delivering", "delivered",
  "extend", "extends", "extending", "extended", "choose", "chooses", "choosing", "chose",
  "select", "selects", "selecting", "selected", "award", "awards", "awarding", "awarded",
  "receive", "receives", "receiving", "received", "unveil", "unveils", "unveiling",
  "unveiled", "roll", "rolls", "rolling", "rolled", "reach", "reaches", "reaching",
  "reached", "pass", "passes", "passing", "passed", "lands", "land", "landing", "landed",
  "hits", "hit", "hitting", "adopts", "adopt", "adopting", "adopted", "returns", "return",
  "returning", "returned", "files", "file", "filing", "filed", "posts", "post", "posting",
  "posted", "seeks", "seek", "seeking", "sought", "faces", "face", "facing", "faced",
]);

const LABEL_OPENERS = new Set([
  "introducing", "announcing", "presenting", "unveiling", "meet", "say", "welcome",
]);

export const headlinePresent: Check = (facts) => {
  if (facts.headline.trim().length > 0) return [];
  return [{
    id: "headline-missing",
    severity: "high",
    message: "No headline on the first line.",
    suggestion: "Open with the news in one line. It is the only part guaranteed to be read.",
  }];
};

export const headlineWordCount: Check = (facts, { headline }) => {
  if (facts.headline.trim().length === 0) return [];
  const count = facts.headlineWords;

  if (count > headline.maxWords) {
    return [{
      id: "headline-length",
      severity: "medium",
      message: `${count} words in the headline, past the ${headline.maxWords}-word maximum.`,
      evidence: facts.headline,
      suggestion: `Cut to ${headline.idealMaxWords}. Decide what the single most surprising fact is and lead with that.`,
    }];
  }
  if (count > headline.idealMaxWords) {
    return [{
      id: "headline-length",
      severity: "low",
      message: `${count} words in the headline, a little over the ${headline.idealMinWords}-${headline.idealMaxWords} range.`,
      evidence: facts.headline,
      suggestion: "Trim the qualifiers. The subject, the verb and the number are what survive.",
    }];
  }
  if (count < headline.idealMinWords) {
    return [{
      id: "headline-length",
      severity: "low",
      message: `${count} words in the headline, under the ${headline.idealMinWords}-word minimum.`,
      evidence: facts.headline,
      suggestion: "Add the outcome — a headline needs a subject, a verb and a consequence.",
    }];
  }
  return [];
};

export const headlineCharCount: Check = (facts, { headline }) => {
  if (facts.headlineChars <= headline.maxChars) return [];
  return [{
    id: "headline-width",
    severity: "low",
    message: `${facts.headlineChars} characters, past ${headline.maxChars}. It will be truncated in a subject line or search result.`,
    evidence: facts.headline,
    suggestion: `Aim for under ${headline.maxChars} characters so it survives being pasted into an email subject.`,
  }];
};

export const headlineVerb: Check = (facts) => {
  if (facts.headline.trim().length === 0) return [];
  if (words(facts.headline).some((word) => NEWS_VERBS.has(word.toLowerCase()))) return [];
  return [{
    id: "headline-verb",
    severity: "medium",
    message: "No news verb found in the headline, checked against a list of the verbs headlines usually turn on.",
    evidence: facts.headline,
    suggestion: "Say what happened: opens, wins, raises, appoints, cuts. A headline without a verb is a label.",
  }];
};

export const headlineIsLabel: Check = (facts) => {
  const first = words(facts.headline)[0]?.toLowerCase();
  const findings: Finding[] = [];

  if (first !== undefined && LABEL_OPENERS.has(first)) {
    findings.push({
      id: "headline-label",
      severity: "medium",
      message: `The headline opens with "${first}", which announces that an announcement is happening rather than reporting the news.`,
      evidence: facts.headline,
      suggestion: "Start with the subject and put the verb second: who did what.",
    });
  }
  return findings;
};

export const headlinePunctuation: Check = (facts) => {
  const findings: Finding[] = [];
  const headline = facts.headline.trim();
  if (headline.length === 0) return findings;

  if (/\.$/.test(headline) && !/\.\.\.$/.test(headline)) {
    findings.push({
      id: "headline-punctuation",
      severity: "low",
      message: "The headline ends in a full stop.",
      evidence: headline,
      suggestion: "Headlines do not take a closing full stop.",
    });
  }
  if (headline.length > 12 && headline === headline.toUpperCase()) {
    findings.push({
      id: "headline-case",
      severity: "low",
      message: "The headline is set in capitals throughout.",
      evidence: headline,
      suggestion: "Sentence case reads faster and does not trip spam filters.",
    });
  }
  return findings;
};

export const HEADLINE_CHECKS: Check[] = [
  headlinePresent,
  headlineWordCount,
  headlineCharCount,
  headlineVerb,
  headlineIsLabel,
  headlinePunctuation,
];

export function runHeadlineChecks(facts: Facts, thresholds: Thresholds): Finding[] {
  return HEADLINE_CHECKS.flatMap((check) => check(facts, thresholds));
}
