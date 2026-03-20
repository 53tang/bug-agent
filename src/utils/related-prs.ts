import { fetchText, searchPullRequestsByTitle } from '../bitbucket';
import { getChangedFilesFromDiff } from '../diff';
import type { RelatedPrDiffGaps, RelatedPrEntry } from '../analysis/types';

export function renderRelatedPrDiffGaps(relatedPrDiffGaps: RelatedPrDiffGaps | null): string {
  if (!relatedPrDiffGaps || relatedPrDiffGaps.skipped) return '';
  const relatedList = Array.isArray(relatedPrDiffGaps.eligibleRelatedPrs)
    ? relatedPrDiffGaps.eligibleRelatedPrs
    : [];
  const withMissing = relatedList.filter(
    (item) => Array.isArray(item.missingFiles) && item.missingFiles.length > 0,
  );
  if (withMissing.length === 0) return '';
  const lines = ['### Related PR Diff Gaps'];
  for (const item of withMissing) {
    const state = String(item.state || '').toUpperCase() || 'UNKNOWN';
    const dest = String(item.destination || 'unknown');
    lines.push(`- Related PR #${item.id} (${state} -> ${dest}): missing files in current PR`);
    for (const file of item.missingFiles) {
      lines.push(`  - ${file}`);
    }
  }
  return lines.join('\n');
}

export async function computeRelatedPrDiffGaps({
  pr,
  repoFullName,
  prId,
  prTitle,
  diffText,
  authHeader,
}: {
  pr: Record<string, unknown>;
  repoFullName: string;
  prId: number;
  prTitle: string;
  diffText: string;
  authHeader: string;
}): Promise<RelatedPrDiffGaps> {
  const dest = pr?.destination as Record<string, unknown> | undefined;
  const destBranch = String((dest?.branch as Record<string, unknown>)?.name || '');
  const trimmedTitle = String(prTitle || '').trim();
  const base: RelatedPrDiffGaps = {
    searchedTitle: trimmedTitle,
    matchStrategy: 'case_insensitive_exact',
    currentPr: {
      id: prId,
      title: prTitle || '',
      destination: destBranch || '',
    },
    candidatesFound: 0,
    eligibleRelatedPrs: [],
    skipped: false,
  };

  if (!trimmedTitle) {
    return { ...base, skipped: true, reason: 'missing_title' };
  }
  if (destBranch !== 'main') {
    return {
      ...base,
      skipped: true,
      reason: `destination_not_main:${destBranch || 'unknown'}`,
    };
  }

  try {
    const candidates = await searchPullRequestsByTitle(repoFullName, trimmedTitle, authHeader);
    const normalizedTitle = trimmedTitle.toLowerCase();
    const exactMatches = candidates.filter(
      (item: Record<string, unknown>) =>
        String(item?.title || '')
          .trim()
          .toLowerCase() === normalizedTitle,
    );
    const withoutCurrent = exactMatches.filter(
      (item: Record<string, unknown>) => Number(item?.id) !== Number(prId),
    );
    base.candidatesFound = withoutCurrent.length;

    const eligible = withoutCurrent.filter((item: Record<string, unknown>) => {
      const state = String(item?.state || '').toUpperCase();
      const itemDest = (item?.destination as Record<string, unknown>)?.branch as
        | Record<string, unknown>
        | undefined;
      const d = String(itemDest?.name || '');
      return state === 'MERGED' && d === 'develop';
    });

    if (eligible.length === 0) {
      return base;
    }

    const currentFiles = getChangedFilesFromDiff(diffText);
    const results: RelatedPrEntry[] = [];
    for (const related of eligible) {
      const entry: RelatedPrEntry = {
        id: related.id as number,
        title: (related.title as string) || '',
        state: (related.state as string) || '',
        destination:
          (((related.destination as Record<string, unknown>)?.branch as Record<string, unknown>)
            ?.name as string) || '',
        missingFiles: [],
      };
      const links = related.links as Record<string, Record<string, string>> | undefined;
      const diffUrl = links?.diff?.href;
      if (!diffUrl) {
        entry.error = 'diff_url_missing';
        results.push(entry);
        continue;
      }
      try {
        const relatedDiff = await fetchText(diffUrl, authHeader);
        const relatedFiles = getChangedFilesFromDiff(relatedDiff!);
        const missing = [...relatedFiles].filter((file) => !currentFiles.has(file));
        entry.missingFiles = missing.sort();
      } catch (error) {
        entry.error = (error as Error).message;
      }
      results.push(entry);
    }

    base.eligibleRelatedPrs = results;
    return base;
  } catch (error) {
    return { ...base, skipped: true, reason: 'search_failed', error: (error as Error).message };
  }
}
