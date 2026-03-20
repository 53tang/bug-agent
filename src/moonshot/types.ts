export interface TokenUsage {
  model: string;
  elapsedMs: number | null;
  promptTokens: number | null;
  responseTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
  toolUsePromptTokens: number | null;
  thoughtsTokens: number | null;
  source: string;
}

export interface MoonshotResult {
  rawText: string;
  structured: Record<string, unknown> | null;
  parseError: string | null;
  quotaExceeded?: boolean;
  tokenUsage: TokenUsage[];
}

export interface PromptMeta {
  prTitle?: string;
  repoFullName?: string;
  prId?: string | number;
}
