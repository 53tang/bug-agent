import type OpenAI from 'openai';
import type { TokenUsage } from './types';

export function extractJson(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) return match[1].trim();
  }
  return trimmed;
}

export function parseJsonResponse(text: string): {
  parsed: Record<string, unknown> | null;
  error: string | null;
} {
  const payload = extractJson(text);
  if (!payload) return { parsed: null, error: 'empty_response' };
  try {
    return { parsed: JSON.parse(payload), error: null };
  } catch (error) {
    return { parsed: null, error: (error as Error).message };
  }
}

export function extractUsageMetadata(response: OpenAI.Chat.ChatCompletion): TokenUsage | null {
  const usage = response?.usage;
  if (!usage) return null;
  return {
    promptTokens: usage.prompt_tokens ?? null,
    responseTokens: usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? null,
    cachedTokens: ((usage as unknown as Record<string, unknown>).cached_tokens as number) ?? null,
    toolUsePromptTokens:
      ((usage.prompt_tokens_details as Record<string, unknown> | undefined)
        ?.cached_tokens as number) ?? null,
    thoughtsTokens:
      ((usage.completion_tokens_details as Record<string, unknown> | undefined)
        ?.reasoning_tokens as number) ?? null,
    source: 'usage',
    model: '',
    elapsedMs: null,
  };
}
