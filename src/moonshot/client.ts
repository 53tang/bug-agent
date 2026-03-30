import { createMoonshotAI } from '@ai-sdk/moonshotai';
import { generateText, Output, type LanguageModelUsage } from 'ai';
import { getEnv, MOONSHOT_MODEL, MOONSHOT_TEMPERATURE } from '../config';
import { buildPrompt } from './prompt-builder';
import { analysisOutputSchema, type AnalysisOutput } from './schema';
import type { MoonshotResult, PromptMeta, TokenUsage } from './types';

/** CN region API (same endpoint as previous OpenAI-compatible client). */
const MOONSHOT_API_BASE_URL = 'https://api.moonshot.cn/v1';

function getMoonshotProvider() {
  return createMoonshotAI({
    apiKey: getEnv('MOON_SHOT_KEY'),
    baseURL: MOONSHOT_API_BASE_URL,
  });
}

function mapUsage(
  usage: LanguageModelUsage | undefined,
  model: string,
  elapsedMs: number,
): TokenUsage {
  return {
    model,
    elapsedMs,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? null,
    source: 'ai_sdk',
  };
}

async function attemptMoonshotCall(
  fullPrompt: string,
  fileCount: number,
): Promise<{
  rawText: string;
  structured: AnalysisOutput | null;
  parseError: string | null;
  tokenUsage: TokenUsage;
}> {
  const moonshot = getMoonshotProvider();
  console.log(`[moonshot] Start analysis for ${fileCount} file(s) using ${MOONSHOT_MODEL}`);
  const start = Date.now();

  const { output: parsed, usage, finishReason, warnings } = await generateText({
    model: moonshot(MOONSHOT_MODEL),
    prompt: fullPrompt,
    temperature: MOONSHOT_TEMPERATURE,
    output: Output.object({ schema: analysisOutputSchema }),
  });

  const elapsedMs = Date.now() - start;
  console.log(
    `[moonshot] Done in ${elapsedMs} ms with ${MOONSHOT_MODEL} (finish: ${finishReason})`,
  );
  if (warnings?.length) {
    console.warn('[moonshot] Warnings:', warnings);
  }

  const usageRecord = mapUsage(usage, MOONSHOT_MODEL, elapsedMs);
  const inTok = usageRecord.inputTokens ?? '?';
  const outTok = usageRecord.outputTokens ?? '?';
  const totTok = usageRecord.totalTokens ?? '?';
  console.log(
    `[moonshot] Tokens (${MOONSHOT_MODEL}): input=${inTok} output=${outTok} total=${totTok}`,
  );

  const rawText = JSON.stringify(parsed, null, 2);
  return {
    rawText,
    structured: parsed,
    parseError: null,
    tokenUsage: usageRecord,
  };
}

function isRateLimitError(error: unknown): boolean {
  const status =
    ((error as Record<string, unknown>)?.status as number | undefined) ||
    (((error as Record<string, unknown>)?.response as Record<string, unknown>)?.status as
      | number
      | undefined);
  const message = (error as Error)?.message || '';
  return (
    status === 429 ||
    message.includes('429') ||
    message.includes('rate limit') ||
    message.includes('Rate limit') ||
    message.includes('RATE_LIMIT')
  );
}

export async function callMoonshotAI(
  prompt: string,
  changeList: Record<string, unknown>[],
  meta: PromptMeta,
): Promise<MoonshotResult> {
  const fullPrompt = buildPrompt(prompt, changeList, meta);
  const tokenUsage: TokenUsage[] = [];

  try {
    const result = await attemptMoonshotCall(fullPrompt, changeList.length);
    tokenUsage.push(result.tokenUsage);
    return { ...result, tokenUsage };
  } catch (error) {
    if (isRateLimitError(error)) {
      tokenUsage.push({
        model: MOONSHOT_MODEL,
        elapsedMs: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        cacheReadTokens: null,
        reasoningTokens: null,
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
