import type { AnalysisOutput } from './schema';

/** Token usage mapped from AI SDK LanguageModelUsage (input/output tokens). */
export interface TokenUsage {
  model: string;
  elapsedMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cacheReadTokens: number | null;
  reasoningTokens: number | null;
  source: string;
}

export interface MoonshotResult {
  rawText: string;
  structured: AnalysisOutput | null;
  parseError: string | null;
  quotaExceeded?: boolean;
  tokenUsage: TokenUsage[];
  /** Token usage from the recheck step (only present when recheck ran). */
  recheckTokenUsage?: TokenUsage[];
}

export interface PromptMeta {
  prTitle?: string;
  repoFullName?: string;
  prId?: string | number;
}
