import fs from 'node:fs';
import path from 'node:path';
import { getTodayAnalysisDir } from '../../../prScheduler';
import { COMMENT_AUTHOR_UUID } from '../../config';
import { postPRComment } from '../../bitbucket';
import type { MoonshotResult } from '../../moonshot';
import {
  hasSpeculativeNotBugs,
  formatSpeculativeNotBugs,
  renderMarkdownFromStructured,
  type Structured,
} from '../../render';
import { sendWeChatWebhook, renderRelatedPrDiffGaps } from '../../utils';
import type { RelatedPrDiffGaps } from '../types';

function getPrAuthor(pr: Record<string, unknown>): string {
  const author = pr.author as Record<string, string> | undefined;
  return author?.display_name || author?.username || 'Unknown';
}

function buildPrWebhookUrl(repoFullName: string, prId: number): string {
  return `https://bitbucket.org/${repoFullName}/pull-requests/${prId}`;
}

export async function saveAndNotifyQuotaExceeded({
  prId,
  repoFullName,
  pr,
  filterStats,
  changeListForSave,
  excludedFiles,
  relatedPrDiffGaps,
  analysis,
  includedFileCount,
}: {
  prId: number;
  repoFullName: string;
  pr: Record<string, unknown>;
  filterStats: { total: number; included: number; excluded: number };
  changeListForSave: Record<string, unknown>[];
  excludedFiles: string[];
  relatedPrDiffGaps: RelatedPrDiffGaps;
  analysis: MoonshotResult;
  includedFileCount: number;
}): Promise<void> {
  const isInputRateLimit = analysis.parseError === 'input_rate_limit';
  const rateLimitLabel = isInputRateLimit ? 'input rate limit' : 'rate limit';
  console.warn(`[analyze] ${rateLimitLabel} triggered, saving partial results`);

  try {
    const todayDir = getTodayAnalysisDir(false);
    if (!fs.existsSync(todayDir)) {
      fs.mkdirSync(todayDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}-pr-${prId}.json`;
    const filepath = path.join(todayDir, filename);

    const dataToSave = {
      prId,
      repoFullName,
      prTitle: pr.title,
      timestamp: new Date().toISOString(),
      error: isInputRateLimit
        ? `Input rate limit: ${includedFileCount} files`
        : 'Rate limit exceeded',
      filterStats,
      changeList: changeListForSave,
      excludedFiles,
      relatedPrDiffGaps,
      tokenUsage: analysis.tokenUsage ?? [],
      analysis: {
        summary: isInputRateLimit
          ? 'Analysis skipped: input rate limit'
          : 'Analysis failed: rate limit',
        bugs: [],
        notBugs: [],
      },
    };

    fs.writeFileSync(filepath, JSON.stringify(dataToSave, null, 2), 'utf8');
    console.log(`Saved partial analysis results to: ${filepath}`);
  } catch (saveError) {
    console.error('Failed to save partial analysis results:', (saveError as Error).message);
  }

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
  filterStats,
  changeListForSave,
  excludedFiles,
  relatedPrDiffGaps,
  analysis,
}: {
  prId: number;
  repoFullName: string;
  pr: Record<string, unknown>;
  filterStats: { total: number; included: number; excluded: number };
  changeListForSave: Record<string, unknown>[];
  excludedFiles: string[];
  relatedPrDiffGaps: RelatedPrDiffGaps;
  analysis: MoonshotResult;
}): Promise<void> {
  try {
    const structured = analysis.structured as unknown as Structured | null;
    const bugsArray = structured?.bugs || [];
    const hasBugs = Array.isArray(bugsArray) && bugsArray.length > 0;

    const todayDir = getTodayAnalysisDir(hasBugs);
    if (!fs.existsSync(todayDir)) {
      fs.mkdirSync(todayDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${timestamp}-pr-${prId}.json`;
    const filepath = path.join(todayDir, filename);

    const dataToSave = {
      prId,
      repoFullName,
      prTitle: pr.title,
      timestamp: new Date().toISOString(),
      filterStats,
      changeList: changeListForSave,
      excludedFiles,
      relatedPrDiffGaps,
      tokenUsage: analysis.tokenUsage ?? [],
      analysis: analysis.structured || {
        summary: 'Failed to parse LLM JSON output',
        bugs: [],
        notBugs: [],
        parseError: analysis.parseError,
      },
    };

    fs.writeFileSync(filepath, JSON.stringify(dataToSave, null, 2), 'utf8');
    const bugStatusMsg = hasBugs ? 'with-bugs' : 'without-bugs';
    console.log(`Saved analysis results to: ${filepath} (${bugStatusMsg})`);
  } catch (saveError) {
    console.error('Failed to save analysis results:', (saveError as Error).message);
  }

  if (!analysis.structured) {
    console.warn('[analyze] LLM output not valid JSON. Skipping PR comment.');
    return;
  }

  const structured = analysis.structured as unknown as Structured;
  const formattedAnalysis = renderMarkdownFromStructured(structured);
  const trimmedAnalysis = (formattedAnalysis || '').trim();
  const relatedGapsMarkdown = renderRelatedPrDiffGaps(relatedPrDiffGaps);
  const hasCommentContent = Boolean(trimmedAnalysis) || Boolean(relatedGapsMarkdown);
  const notBugs = Array.isArray(structured.notBugs) ? structured.notBugs : [];
  const hasSpeculative = hasSpeculativeNotBugs(notBugs);
  const speculativeContent = hasSpeculative ? formatSpeculativeNotBugs(notBugs) : '';
  const shouldSendWebhook = Boolean(trimmedAnalysis) || hasSpeculative;

  if (!hasCommentContent) {
    console.log('[analyze] No confirmed high severity bugs. Skipping PR comment.');
    if (shouldSendWebhook) {
      try {
        await sendWeChatWebhook(
          pr.title as string,
          getPrAuthor(pr),
          repoFullName,
          buildPrWebhookUrl(repoFullName, prId),
          speculativeContent,
        );
      } catch (webhookError) {
        console.error('Failed to send webhook notification:', (webhookError as Error).message);
      }
    }
    return;
  }

  const commentSections: string[] = [];
  if (trimmedAnalysis) {
    commentSections.push(trimmedAnalysis);
  }
  if (relatedGapsMarkdown) {
    commentSections.push(relatedGapsMarkdown);
  }

  const comment = `## Automated Code Review Analysis

${commentSections.join('\n\n')}

---

*This analysis was generated automatically by Bug Agent using Moonshot (Kimi).*`;

  const authorUuid = (pr.author as Record<string, string>)?.uuid || '';
  const canComment = authorUuid === COMMENT_AUTHOR_UUID;

  if (canComment) {
    try {
      await postPRComment(repoFullName, prId, comment);
      console.log(`Successfully posted analysis comment to PR #${prId}`);
    } catch (error) {
      console.error('Failed to post comment to PR:', (error as Error).message);
      console.log('\n=== Analysis Result ===');
      console.log(analysis);
      console.log('======================\n');
      throw error;
    }
  } else {
    console.log(
      `[analyze] Skipping PR comment (author ${authorUuid || 'unknown'} not in allowlist)`,
    );
  }

  if (shouldSendWebhook) {
    try {
      await sendWeChatWebhook(
        pr.title as string,
        getPrAuthor(pr),
        repoFullName,
        buildPrWebhookUrl(repoFullName, prId),
        trimmedAnalysis,
      );
    } catch (webhookError) {
      console.error('Failed to send webhook notification:', (webhookError as Error).message);
    }
  }
}
