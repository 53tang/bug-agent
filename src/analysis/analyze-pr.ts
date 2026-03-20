import { MAX_FILES_FOR_FULL_CONTENT, shouldSkipInputRateLimit } from '../config';
import { fetchPrData } from './steps/fetch-pr';
import { filterDiffFiles } from './steps/filter-files';
import { buildChangeLists } from './steps/build-change-list';
import { runLlmAnalysis } from './steps/run-llm';
import { saveAndNotifyQuotaExceeded, saveResultsAndPostComment } from './steps/post-results';
import type { AnalysisResult } from './types';

export async function analyzePR(prUrl: string): Promise<AnalysisResult> {
  // 1. Fetch PR data
  const prData = await fetchPrData(prUrl);

  if (!prData) {
    const match = prUrl.match(/pull-requests\/(\d+)/);
    const prId = match ? Number(match[1]) : 0;
    return {
      success: true,
      skipped: true,
      reason: 'ignored_repo',
      prId,
      repoFullName: '',
      prTitle: '',
    };
  }

  // 2. If PR data is found, process it
  const { authHeader, repoFullName, prId, pr, commitHash, fileDiffs, relatedPrDiffGaps } = prData;
  const prTitle = pr.title as string;

  // 3. Filter diff files
  const { includedFileDiffs, excludedFiles, filterStats } = filterDiffFiles(fileDiffs);

  if (includedFileDiffs.length === 0) {
    console.log('[analyze] No files to analyze after filtering');
    return {
      success: true,
      message: 'No files to analyze after filtering.',
      bugs: [],
      prId,
      repoFullName,
      prTitle,
      relatedPrDiffGaps,
    };
  }

  // 4. Check if we should skip full content
  const skipFullContent = includedFileDiffs.length > MAX_FILES_FOR_FULL_CONTENT;
  if (skipFullContent) {
    console.log(
      `[analyze] ${includedFileDiffs.length} files > ${MAX_FILES_FOR_FULL_CONTENT}; using diff-only without full content`,
    );
  }

  // 5. Build change lists
  const { promptChangeList, changeListForSave } = await buildChangeLists(
    includedFileDiffs,
    repoFullName,
    commitHash,
    authHeader,
    skipFullContent,
  );

  if (changeListForSave.length === 0) {
    console.log('[analyze] No files to analyze after filtering');
    return {
      success: true,
      message: 'No files to analyze after filtering.',
      bugs: [],
      prId,
      repoFullName,
      prTitle,
      relatedPrDiffGaps,
    };
  }

  // 6. rate limit check
  const skipInputRateLimit = shouldSkipInputRateLimit(includedFileDiffs.length);
  // 7. Run LLM analysis
  const analysis = await runLlmAnalysis(
    promptChangeList,
    prTitle,
    repoFullName,
    prId,
    skipInputRateLimit,
  );

  if (analysis.quotaExceeded) {
    // 8. Save and notify quota exceeded
    await saveAndNotifyQuotaExceeded({
      prId,
      repoFullName,
      pr,
      filterStats,
      changeListForSave,
      excludedFiles,
      relatedPrDiffGaps,
      analysis,
      includedFileCount: includedFileDiffs.length,
    });
    return { success: false, quotaExceeded: true, prId, repoFullName, prTitle };
  }

  // 9. Save results and post comment
  await saveResultsAndPostComment({
    prId,
    repoFullName,
    pr,
    filterStats,
    changeListForSave,
    excludedFiles,
    relatedPrDiffGaps,
    analysis,
  });

  return { success: true, analysis, prId, repoFullName, prTitle };
}
