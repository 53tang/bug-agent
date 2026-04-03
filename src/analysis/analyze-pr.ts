import { MAX_FILES_FOR_FULL_CONTENT, shouldSkipInputRateLimit } from '../config';
import { fetchPrData } from './steps/fetch-pr';
import { filterDiffFiles } from './steps/filter-files';
import { buildChangeLists } from './steps/build-change-list';
import { runLlmAnalysis } from './steps/run-llm';
import { saveAndNotifyQuotaExceeded, saveResultsAndPostComment } from './steps/post-results';
import type { AnalysisResult } from './types';

type AnalysisResultBody = Omit<AnalysisResult, 'durationMs'>;

function withDuration(result: AnalysisResultBody, startMs: number): AnalysisResult {
  const durationMs = Date.now() - startMs;
  console.log(`[analyze] PR #${result.prId} completed in ${durationMs}ms`);
  return { ...result, durationMs };
}

export async function analyzePR(prUrl: string): Promise<AnalysisResult> {
  const analysisStartMs = Date.now();

  // 1. Fetch PR data
  const prData = await fetchPrData(prUrl);

  if (!prData) {
    const match = prUrl.match(/pull-requests\/(\d+)/);
    const prId = match ? Number(match[1]) : 0;
    return withDuration(
      {
        success: true,
        skipped: true,
        reason: 'ignored_repo',
        prId,
        repoFullName: '',
        prTitle: '',
      },
      analysisStartMs,
    );
  }

  // 2. If PR data is found, process it
  const { authHeader, repoFullName, prId, pr, commitHash, fileDiffs, relatedPrDiffGaps, adbHeaderCheck, unusedDepsCheck } = prData;
  const prTitle = pr.title as string;

  // 3. Filter diff files
  const { includedFileDiffs, excludedFiles, filterStats } = filterDiffFiles(fileDiffs);

  if (includedFileDiffs.length === 0) {
    console.log('[analyze] No files to analyze after filtering');
    return withDuration(
      {
        success: true,
        message: 'No files to analyze after filtering.',
        bugs: [],
        prId,
        repoFullName,
        prTitle,
        relatedPrDiffGaps,
      },
      analysisStartMs,
    );
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
    return withDuration(
      {
        success: true,
        message: 'No files to analyze after filtering.',
        bugs: [],
        prId,
        repoFullName,
        prTitle,
        relatedPrDiffGaps,
      },
      analysisStartMs,
    );
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
      adbHeaderCheck,
      unusedDepsCheck,
      analysis,
      includedFileCount: includedFileDiffs.length,
      analysisStartMs,
    });
    return withDuration({ success: false, quotaExceeded: true, prId, repoFullName, prTitle }, analysisStartMs);
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
    adbHeaderCheck,
    unusedDepsCheck,
    analysis,
    analysisStartMs,
  });

  return withDuration({ success: true, analysis, prId, repoFullName, prTitle }, analysisStartMs);
}
