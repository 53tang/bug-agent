export interface Logger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

export interface PrData {
  id: number;
  title?: string;
  state?: string;
  created_on?: string;
  updated_on?: string;
  source?: { repository?: { full_name?: string }; commit?: { hash?: string } };
  destination?: { branch?: { name?: string } };
  links?: {
    html?: { href?: string };
    self?: { href?: string };
    diff?: { href?: string };
  };
  author?: { display_name?: string; username?: string; uuid?: string };
}

export type FetchJsonFn = (url: string, authHeader: string) => Promise<Record<string, unknown>>;
export type AnalyzePRFn = (prUrl: string) => Promise<unknown>;
