import fs from 'node:fs';
import { createMoonshotAI } from '@ai-sdk/moonshotai';
import { generateText, Output, stepCountIs, type LanguageModelUsage } from 'ai';
import {
  getEnv,
  getTavilyApiKey,
  MOONSHOT_MODEL,
  MOONSHOT_TEMPERATURE,
  RECHECK_PROMPT_PATH,
  RECHECK_MAX_STEPS,
} from '../../config';
import { analysisOutputSchema, type AnalysisOutput } from '../../moonshot/schema';
import type { TokenUsage } from '../../moonshot/types';
import { createFetchFileTool, createWebSearchTool } from '../../tools';

const MOONSHOT_API_BASE_URL = 'https://api.moonshot.cn/v1';

interface RecheckContext {
  repoFullName: string;
  commitHash: string;
  authHeader: string;
  prTitle: string;
  prId: number;
}

export interface RecheckResult {
  structured: AnalysisOutput | null;
  tokenUsage: TokenUsage[];
}

function loadRecheckTemplate(): string {
  return fs.readFileSync(RECHECK_PROMPT_PATH, 'utf8');
}

function formatBugsForPrompt(bugs: AnalysisOutput['bugs']): string {
  if (bugs.length === 0) return '(none)';
  return bugs
    .map((b, i) => {
      const parts = [`Bug ${i + 1}: ${b.title ?? '(untitled)'}`];
      if (b.filePath) parts.push(`  File: ${b.filePath}`);
      if (b.lineHint) parts.push(`  Line: ${b.lineHint}`);
      if (b.description) parts.push(`  Description: ${b.description}`);
      if (b.risk) parts.push(`  Risk: ${b.risk}`);
      if (b.codeSnippet) parts.push(`  Code:\n    ${b.codeSnippet}`);
      return parts.join('\n');
    })
    .join('\n\n');
}

function formatSpeculativeForPrompt(notBugs: AnalysisOutput['notBugs']): string {
  const speculative = notBugs.filter((nb) => nb.reason?.toLowerCase().includes('speculative'));
  if (speculative.length === 0) return '(none)';
  return speculative
    .map((nb, i) => `${i + 1}. ${nb.topic ?? '(untitled)'}\n   Reason: ${nb.reason}`)
    .join('\n\n');
}

function buildRecheckPrompt(analysis: AnalysisOutput, ctx: RecheckContext): string {
  const template = loadRecheckTemplate();
  return template
    .replace('{{PR_TITLE}}', ctx.prTitle)
    .replace('{{REPO}}', ctx.repoFullName)
    .replace('{{PR_ID}}', String(ctx.prId))
    .replace('{{BUGS}}', formatBugsForPrompt(analysis.bugs))
    .replace('{{SPECULATIVE_NOT_BUGS}}', formatSpeculativeForPrompt(analysis.notBugs));
}

function mapUsage(usage: LanguageModelUsage | undefined, model: string, elapsedMs: number): TokenUsage {
  return {
    model,
    elapsedMs,
    inputTokens: usage?.inputTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    totalTokens: usage?.totalTokens ?? null,
    cacheReadTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
    reasoningTokens: usage?.outputTokenDetails?.reasoningTokens ?? null,
    source: 'ai_sdk_recheck',
  };
}

/** Returns true when the recheck step should run. */
export function shouldRecheck(analysis: AnalysisOutput): boolean {
  const hasBugs = analysis.bugs.length > 0;
  const hasSpeculative = analysis.notBugs.some((nb) =>
    nb.reason?.toLowerCase().includes('speculative'),
  );
  return hasBugs || hasSpeculative;
}

/**
 * Run the recheck step: a second LLM call with tools (fetch_file + web_search)
 * to verify/dismiss bugs and investigate speculative items.
 * Falls back gracefully on failure — returns null so the caller can use the
 * original analysis.
 */
export async function recheckBugs(
  initialAnalysis: AnalysisOutput,
  ctx: RecheckContext,
): Promise<RecheckResult | null> {
  const prompt = buildRecheckPrompt(initialAnalysis, ctx);

  const moonshot = createMoonshotAI({
    apiKey: getEnv('MOON_SHOT_KEY'),
    baseURL: MOONSHOT_API_BASE_URL,
  });

  const fetchFileTool = createFetchFileTool({
    repoFullName: ctx.repoFullName,
    commitHash: ctx.commitHash,
    authHeader: ctx.authHeader,
  });

  const webSearchTool = createWebSearchTool(getTavilyApiKey());

  console.log(
    `[recheck] Starting recheck for PR #${ctx.prId} — ` +
      `${initialAnalysis.bugs.length} bug(s), ` +
      `${initialAnalysis.notBugs.filter((nb) => nb.reason?.toLowerCase().includes('speculative')).length} speculative item(s)`,
  );

  const start = Date.now();

  try {
    const { output: parsed, usage, finishReason, steps } = await generateText({
      model: moonshot(MOONSHOT_MODEL),
      prompt,
      temperature: MOONSHOT_TEMPERATURE,
      tools: {
        fetch_file: fetchFileTool,
        web_search: webSearchTool,
      },
      stopWhen: stepCountIs(RECHECK_MAX_STEPS),
      output: Output.object({ schema: analysisOutputSchema }),
    });

    const elapsedMs = Date.now() - start;
    const totalToolCalls = steps.reduce((n, s) => n + (s.toolCalls?.length ?? 0), 0);
    console.log(
      `[recheck] Done in ${elapsedMs} ms (finish: ${finishReason}, ` +
        `steps: ${steps.length}, tool calls: ${totalToolCalls})`,
    );

    const usageRecord = mapUsage(usage, MOONSHOT_MODEL, elapsedMs);
    console.log(
      `[recheck] Tokens: input=${usageRecord.inputTokens ?? '?'} ` +
        `output=${usageRecord.outputTokens ?? '?'} ` +
        `total=${usageRecord.totalTokens ?? '?'}`,
    );

    return {
      structured: parsed,
      tokenUsage: [usageRecord],
    };
  } catch (error) {
    const elapsedMs = Date.now() - start;
    console.error(`[recheck] Failed after ${elapsedMs} ms:`, error);
    return null;
  }
}
