import { postPRComment } from '../../../bitbucket';
import { sendWeChatAutomatedChecksWebhook, buildAutomatedChecksComment } from '../../../utils';
import type {
  BffRawErrorLeakCheckResult,
  RelatedPrDiffGaps,
  UnusedDepsCheckResult,
} from '../../types';

export function getPrAuthor(pr: Record<string, unknown>): string {
  const author = pr.author as Record<string, string> | undefined;
  return author?.display_name || author?.username || 'Unknown';
}

export function buildPrWebhookUrl(repoFullName: string, prId: number): string {
  return `https://bitbucket.org/${repoFullName}/pull-requests/${prId}`;
}

export async function notifyAutomatedChecks(
  repoFullName: string,
  prId: number,
  pr: Record<string, unknown>,
  relatedPrDiffGaps: RelatedPrDiffGaps,
  unusedDepsCheck: UnusedDepsCheckResult,
  bffRawErrorLeakCheck: BffRawErrorLeakCheckResult,
): Promise<void> {
  const markdown = buildAutomatedChecksComment(
    relatedPrDiffGaps,
    unusedDepsCheck,
    bffRawErrorLeakCheck,
  );
  if (!markdown) return;

  try {
    await postPRComment(repoFullName, prId, markdown);
    console.log(`Successfully posted automated checks comment to PR #${prId}`);
  } catch (error) {
    console.error('Failed to post automated checks comment:', (error as Error).message);
    throw error;
  }

  await sendWeChatAutomatedChecksWebhook(
    pr.title as string,
    getPrAuthor(pr),
    repoFullName,
    buildPrWebhookUrl(repoFullName, prId),
    markdown,
  );
}
