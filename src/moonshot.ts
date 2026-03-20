import fs from 'node:fs';
import OpenAI from 'openai';
import {
  PROMPT_PATH,
  MOONSHOT_BASE_URL,
  MOONSHOT_MODEL,
  MOONSHOT_TEMPERATURE,
  getEnv,
} from './config';

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

interface PromptMeta {
  prTitle?: string;
  repoFullName?: string;
  prId?: string | number;
}

function getMoonshotClient(): OpenAI {
  const apiKey = getEnv('MOON_SHOT_KEY');
  return new OpenAI({
    apiKey,
    baseURL: MOONSHOT_BASE_URL,
  });
}

function loadPromptTemplate(): string {
  return fs.readFileSync(PROMPT_PATH, 'utf8');
}

function buildPrompt(
  prompt: string,
  changeList: Record<string, unknown>[],
  meta: PromptMeta = {},
): string {
  const { prTitle = '', repoFullName = '', prId = '' } = meta;
  const template = loadPromptTemplate();
  return template
    .replace('{{PROMPT}}', prompt)
    .replace('{{PR_TITLE}}', prTitle)
    .replace('{{REPO}}', repoFullName)
    .replace('{{PR_ID}}', String(prId))
    .replace('{{CHANGE_LIST}}', JSON.stringify(changeList, null, 2));
}

function extractJson(text: string): string {
  if (!text) return '';
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (match) return match[1].trim();
  }
  return trimmed;
}

function parseJsonResponse(text: string): {
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

function extractUsageMetadata(response: OpenAI.Chat.ChatCompletion): TokenUsage | null {
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

async function attemptMoonshotCall(
  client: OpenAI,
  model: string,
  fullPrompt: string,
  fileCount: number,
): Promise<{
  rawText: string;
  structured: Record<string, unknown> | null;
  parseError: string | null;
  tokenUsage: TokenUsage;
}> {
  console.log(`[moonshot] Start analysis for ${fileCount} file(s) using ${model}`);
  const start = Date.now();
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: fullPrompt }],
    temperature: MOONSHOT_TEMPERATURE,
  });
  const elapsedMs = Date.now() - start;
  console.log(`[moonshot] Done in ${elapsedMs} ms with ${model}`);

  const usage = extractUsageMetadata(response);
  const usageRecord: TokenUsage = usage
    ? { ...usage, model, elapsedMs }
    : {
        model,
        elapsedMs,
        promptTokens: null,
        responseTokens: null,
        totalTokens: null,
        cachedTokens: null,
        toolUsePromptTokens: null,
        thoughtsTokens: null,
        source: 'usage_missing',
      };
  const inputTokens = usageRecord.promptTokens ?? '?';
  const outputTokens = usageRecord.responseTokens ?? '?';
  const totalTokens = usageRecord.totalTokens ?? '?';
  console.log(
    `[moonshot] Tokens (${model}): input=${inputTokens} output=${outputTokens} total=${totalTokens}`,
  );

  const rawText = response?.choices?.[0]?.message?.content ?? '';
  const { parsed, error } = parseJsonResponse(rawText);
  if (error) {
    console.warn(`[moonshot] JSON parse failed: ${error}`);
  }
  return {
    rawText,
    structured: parsed,
    parseError: error,
    tokenUsage: usageRecord,
  };
}

export async function callMoonshotAI(
  prompt: string,
  changeList: Record<string, unknown>[],
  meta: PromptMeta,
): Promise<MoonshotResult> {
  const client = getMoonshotClient();
  const fullPrompt = buildPrompt(prompt, changeList, meta);
  const tokenUsage: TokenUsage[] = [];

  try {
    const result = await attemptMoonshotCall(client, MOONSHOT_MODEL, fullPrompt, changeList.length);
    if (result.tokenUsage) {
      tokenUsage.push(result.tokenUsage);
    }
    return { ...result, tokenUsage };
  } catch (error) {
    const status =
      ((error as Record<string, unknown>)?.status as number | undefined) ||
      (((error as Record<string, unknown>)?.response as Record<string, unknown>)?.status as
        | number
        | undefined);
    const message = (error as Error)?.message || '';
    const isRateLimit =
      status === 429 ||
      message.includes('429') ||
      message.includes('rate limit') ||
      message.includes('Rate limit') ||
      message.includes('RATE_LIMIT');

    if (isRateLimit) {
      tokenUsage.push({
        model: MOONSHOT_MODEL,
        elapsedMs: null,
        promptTokens: null,
        responseTokens: null,
        totalTokens: null,
        cachedTokens: null,
        toolUsePromptTokens: null,
        thoughtsTokens: null,
        source: 'error',
      });
      console.warn('[moonshot] Rate limit hit, skipping retry');
      return {
        rawText: '',
        structured: null,
        parseError: 'rate_limit',
        quotaExceeded: true,
        tokenUsage,
      };
    }
    throw error;
  }
}
