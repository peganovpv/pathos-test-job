export type Severity = "high" | "medium" | "low";

export interface Finding {
  id: string;
  severity: Severity;
  message: string;
  evidence?: string;
  suggestion?: string;
}

export interface Draft {
  raw: string;
  headline: string;
  body: string;
  paragraphs: string[];
}
