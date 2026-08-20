export type Severity = "high" | "medium" | "low";

export interface Finding {
  id: string;
  severity: Severity;
  message: string;
  evidence?: string;
  suggestion?: string;
  category?: CategoryKey;
}

export interface Draft {
  raw: string;
  headline: string;
  body: string;
  paragraphs: string[];
}

export interface Quote {
  text: string;
  words: number;
  attribution: string | null;
  spansParagraphs: boolean;
  unterminated: boolean;
}

/** Consecutive quoted passages from the same speaker, treated as one statement. */
export interface QuoteStatement {
  text: string;
  words: number;
  attribution: string | null;
  passages: number;
  spansParagraphs: boolean;
  unterminated: boolean;
}

export type CategoryKey = "newsworthiness" | "structure" | "quoteability" | "headline";

export type Band = "ready" | "needs-work" | "rewrite";
