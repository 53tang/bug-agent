import { postPRComment } from '../../../bitbucket';
import type { MoonshotResult } from '../../../moonshot';
import {
  hasSpeculativeNotBugs,
  formatSpeculativeNotBugs,
  renderMarkdownFromStructured,
  type Structured,
} from '../../../render';
import { sendWeChatWebhook } from '../../../utils';
import type {
  BffRawErrorLeakCheckResult,
  RelatedPrDiffGaps,
  UnusedDepsCheckResult,
} from '../../types';
import { getPrAuthor, buildPrWebhookUrl, notifyAutomatedChecks } from './automated-checks';
import { COMMENT_AUTHOR_UUID } from '../../../config';
import { saveQuotaExceededResult, saveAnalysisResult } from './save-results';

function canPostPrComments(pr: Record<string, unknown>): boolean {
  const authorUuid = (pr.author as Record<string, string>)?.uuid || '';
  return authorUuid === COMMENT_AUTHOR_UUID;
}

export async function saveAndNotifyQuotaExceeded({
  prId,
  repoFullName,
  pr,
  commitHash,
  filterStats,
  changeListForSave,
  excludedFiles,
  relatedPrDiffGaps,
  unusedDepsCheck,
  bffRawErrorLeakCheck,
  analysis,
  includedFileCount,
  analysisStartMs,
}: {
  prId: number;
  repoFullName: string;
  pr: Record<string, unknown>;
  commitHash: string;
  filterStats: { total: number; included: number; excluded: number };
  changeListForSave: Record<string, unknown>[];
  excludedFiles: string[];
  relatedPrDiffGaps: RelatedPrDiffGaps;
  unusedDepsCheck: UnusedDepsCheckResult;
  bffRawErrorLeakCheck: BffRawErrorLeakCheckResult;
  analysis: MoonshotResult;
  includedFileCount: number;
  analysisStartMs: number;
}): Promise<void> {
  const isInputRateLimit = analysis.parseError === 'input_rate_limit';
  console.warn(
    `[analyze] ${isInputRateLimit ? 'input rate limit' : 'rate limit'} triggered, saving partial results`,
  );

  saveQuotaExceededResult({
    prId,
    repoFullName,
    pr,
    commitHash,
    filterStats,
    changeListForSave,
    excludedFiles,
    relatedPrDiffGaps,
    unusedDepsCheck,
    bffRawErrorLeakCheck,
    analysis,
    includedFileCount,
    analysisStartMs,
  });

  await notifyAutomatedChecks(
    repoFullName,
    prId,
    pr,
    relatedPrDiffGaps,
    unusedDepsCheck,
    bffRawErrorLeakCheck,
  );

  try {
    const bugContent = isInputRateLimit
      ? 'No bugs analyzed due to input rate limit'
      : 'No bugs analyzed due to rate limit';
    await sendWeChatWebhook(
      pr.title as string,
      getPrAuthor(pr),
      repoFullName,
      buildPrWebhookUrl(repoFullName, prId),
      bugContent,
    );
    console.log('Sent webhook notification for quota exceeded');
  } catch (webhookError) {
    console.error('Failed to send webhook notification:', (webhookError as Error).message);
  }
}

export async function saveResultsAndPostComment({
  prId,
  repoFullName,
  pr,
  commitHash,
  filterStats,
  changeListForSave,
  excludedFiles,
  relatedPrDiffGaps,
  unusedDepsCheck,
  bffRawErrorLeakCheck,
  analysis,
  analysisStartMs,
}: {
  prId: number;
  repoFullName: string;
  pr: Record<string, unknown>;
  commitHash: string;
  filterStats: { total: number; included: number; excluded: number };
  changeListForSave: Record<string, unknown>[];
  excludedFiles: string[];
  relatedPrDiffGaps: RelatedPrDiffGaps;
  unusedDepsCheck: UnusedDepsCheckResult;
  bffRawErrorLeakCheck: BffRawErrorLeakCheckResult;
  analysis: MoonshotResult;
  analysisStartMs: number;
}): Promise<void> {
  saveAnalysisResult({
    prId,
    repoFullName,
    pr,
    commitHash,
    filterStats,
    changeListForSave,
    excludedFiles,
    relatedPrDiffGaps,
    unusedDepsCheck,
    bffRawErrorLeakCheck,
    analysis,
    analysisStartMs,
  });

  if (!analysis.structured) {
    console.warn('[analyze] LLM output not valid JSON. Skipping analysis PR comment.');
    await notifyAutomatedChecks(
      repoFullName,
      prId,
      pr,
      relatedPrDiffGaps,
      unusedDepsCheck,
      bffRawErrorLeakCheck,
    );
    return;
  }

  const structured = analysis.structured as unknown as Structured;
  const formattedAnalysis = renderMarkdownFromStructured(structured);
  const trimmedAnalysis = (formattedAnalysis || '').trim();
  const notBugs = Array.isArray(structured.notBugs) ? structured.notBugs : [];
  const hasSpeculative = hasSpeculativeNotBugs(notBugs);
  const speculativeContent = hasSpeculative ? formatSpeculativeNotBugs(notBugs) : '';
  const shouldSendWebhook = Boolean(trimmedAnalysis) || hasSpeculative;

  if (trimmedAnalysis) {
    const analysisComment = `## Automated Code Review Analysis\n\n${trimmedAnalysis}\n\n---`;
    if (canPostPrComments(pr)) {
      try {
        await postPRComment(repoFullName, prId, analysisComment);
        console.log(`Successfully posted analysis comment to PR #${prId}`);
      } catch (error) {
        console.error('Failed to post comment to PR:', (error as Error).message);
        console.log('\n=== Analysis Result ===');
        console.log(analysis);
        console.log('======================\n');
        throw error;
      }
    } else {
      const authorUuid = (pr.author as Record<string, string>)?.uuid || '';
      console.log(
        `[analyze] Skipping analysis PR comment (author ${authorUuid || 'unknown'} not in allowlist)`,
      );
    }
  } else {
    console.log('[analyze] No analysis markdown for PR comment.');
  }

  await notifyAutomatedChecks(
    repoFullName,
    prId,
    pr,
    relatedPrDiffGaps,
    unusedDepsCheck,
    bffRawErrorLeakCheck,
  );

  if (shouldSendWebhook) {
    try {
      await sendWeChatWebhook(
        pr.title as string,
        getPrAuthor(pr),
        repoFullName,
        buildPrWebhookUrl(repoFullName, prId),
        trimmedAnalysis || speculativeContent,
      );
    } catch (webhookError) {
      console.error('Failed to send webhook notification:', (webhookError as Error).message);
    }
  }
}
