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

export interface Structured {
  bugs?: Bug[];
  notBugs?: NotBug[];
}
