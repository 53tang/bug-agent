export interface Bug {
  title?: string;
  issue?: string;
  description?: string;
  filePath?: string;
  file?: string;
  lineHint?: string;
  risk?: string;
  codeSnippet?: string;
}

export interface NotBug {
  topic?: string;
  reason?: string;
}

/** Matches moonshot/analysisOutputSchema for markdown and post-results */
export interface Structured {
  summary?: string;
  bugs?: Bug[];
  notBugs?: NotBug[];
}
