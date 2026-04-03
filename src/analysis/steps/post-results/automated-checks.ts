import { COMMENT_AUTHOR_UUID } from '../../../config';
import { postPRComment } from '../../../bitbucket';
import { sendWeChatAutomatedChecksWebhook, buildAutomatedChecksComment } from '../../../utils';
import type { RelatedPrDiffGaps, UnusedDepsCheckResult } from '../../types';

export function getPrAuthor(pr: Record<string, unknown>): string {
  const author = pr.author as Record<string, string> | undefined;
  return author?.display_name || author?.username || 'Unknown';
}

export function buildPrWebhookUrl(repoFullName: string, prId: number): string {
  return `https://bitbucket.org/${repoFullName}/pull-requests/${prId}`;
}

export function canPostPrComments(pr: Record<string, unknown>): boolean {
  const authorUuid = (pr.author as Record<string, string>)?.uuid || '';
  return authorUuid === COMMENT_AUTHOR_UUID;
}

export async function notifyAutomatedChecks(
  repoFullName: string,
  prId: number,
  pr: Record<string, unknown>,
  relatedPrDiffGaps: RelatedPrDiffGaps,
  unusedDepsCheck: UnusedDepsCheckResult,
): Promise<void> {
  const markdown = buildAutomatedChecksComment(relatedPrDiffGaps, unusedDepsCheck);
  if (!markdown) return;

  if (canPostPrComments(pr)) {
    try {
      await postPRComment(repoFullName, prId, markdown);
      console.log(`Successfully posted automated checks comment to PR #${prId}`);
    } catch (error) {
      console.error('Failed to post automated checks comment:', (error as Error).message);
      throw error;
    }
  } else {
    console.log('[analyze] Skipping automated checks comment (author not in allowlist)');
  }

  await sendWeChatAutomatedChecksWebhook(
    pr.title as string,
    getPrAuthor(pr),
    repoFullName,
    buildPrWebhookUrl(repoFullName, prId),
    markdown,
  );
}
