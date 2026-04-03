import { getAuthHeader, isIgnoredRepo } from '../../config';
import { parsePrUrl, fetchJson, fetchText } from '../../bitbucket';
import { splitDiffByFile, type FileDiff } from '../../diff';
import { computeRelatedPrDiffGaps, checkUnusedDeps } from '../../utils';
import type { RelatedPrDiffGaps, UnusedDepsCheckResult } from '../types';

export interface FetchPrResult {
  authHeader: string;
  repoFullName: string;
  prId: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pr: any;
  commitHash: string;
  diffText: string;
  fileDiffs: FileDiff[];
  relatedPrDiffGaps: RelatedPrDiffGaps;
  unusedDepsCheck: UnusedDepsCheckResult;
}

export async function fetchPrData(prUrl: string): Promise<FetchPrResult | null> {
  const authHeader = getAuthHeader();
  const { repoFullName, prId } = parsePrUrl(prUrl);

  if (isIgnoredRepo(repoFullName)) {
    console.log(`[analyze] Skipping PR #${prId} from ignored repo: ${repoFullName}`);
    return null;
  }

  console.log(`Analyzing PR #${prId} from ${repoFullName}`);

  const prApi = `https://api.bitbucket.org/2.0/repositories/${repoFullName}/pullrequests/${prId}`;
  const pr = await fetchJson(prApi, authHeader);
  const diffUrl = (pr.links as Record<string, Record<string, string>>)?.diff?.href;
  const commitHash = ((pr.source as Record<string, unknown>)?.commit as Record<string, string>)
    ?.hash;

  if (!diffUrl) {
    throw new Error('PR diff URL not found');
  }
  if (!commitHash) {
    throw new Error('PR commit hash not found');
  }

  const diffText = (await fetchText(diffUrl, authHeader))!;
  const fileDiffs = splitDiffByFile(diffText);

  // do all kinds of checks
  const relatedPrDiffGaps = await computeRelatedPrDiffGaps({
    pr,
    repoFullName,
    prId,
    prTitle: pr.title as string,
    diffText,
    authHeader,
  });
  const unusedDepsCheck = checkUnusedDeps(fileDiffs);

  return { authHeader, repoFullName, prId, pr, commitHash, diffText, fileDiffs, relatedPrDiffGaps, unusedDepsCheck };
}
