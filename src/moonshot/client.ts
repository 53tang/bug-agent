import OpenAI from 'openai';
import { MOONSHOT_BASE_URL, MOONSHOT_MODEL, MOONSHOT_TEMPERATURE, getEnv } from '../config';
import { buildPrompt } from './prompt-builder';
import { extractUsageMetadata, parseJsonResponse } from './response';
import type { MoonshotResult, PromptMeta, TokenUsage } from './types';

function getMoonshotClient(): OpenAI {
  const apiKey = getEnv('MOON_SHOT_KEY');
  return new OpenAI({
    apiKey,
    baseURL: MOONSHOT_BASE_URL,
  });
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
