import fs from 'node:fs';
import path from 'node:path';
import { getTodayAnalysisDir } from '../../../scheduler/analysis-state';
import type { MoonshotResult } from '../../../moonshot';
import { buildSparseCheck } from '../../../utils';
import type {
  BffRawErrorLeakCheckResult,
  RelatedPrDiffGaps,
  UnusedDepsCheckResult,
} from '../../types';

function savedAnalysisCheckPayload(
  relatedPrDiffGaps: RelatedPrDiffGaps,
  unusedDepsCheck: UnusedDepsCheckResult,
  bffRawErrorLeakCheck: BffRawErrorLeakCheckResult,
) {
  const sparseCheck = buildSparseCheck(relatedPrDiffGaps, unusedDepsCheck, bffRawErrorLeakCheck);
  return {
    relatedPrDiffGaps,
    unusedDepsCheck,
    bffRawErrorLeakCheck,
    ...(sparseCheck ? { check: sparseCheck } : {}),
  };
}

function writeJsonFile(todayDir: string, prId: number, data: unknown): void {
  if (!fs.existsSync(todayDir)) {
    fs.mkdirSync(todayDir, { recursive: true });
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filepath = path.join(todayDir, `${timestamp}-pr-${prId}.json`);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
}

export function saveQuotaExceededResult({
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
}): void {
  const isInputRateLimit = analysis.parseError === 'input_rate_limit';
  const durationMs = Date.now() - analysisStartMs;
  try {
    writeJsonFile(getTodayAnalysisDir(false), prId, {
      prId,
      repoFullName,
      prTitle: pr.title,
      commitHash,
      timestamp: new Date().toISOString(),
      durationMs,
      error: isInputRateLimit
        ? `Input rate limit: ${includedFileCount} files`
        : 'Rate limit exceeded',
      filterStats,
      changeList: changeListForSave,
      excludedFiles,
      ...savedAnalysisCheckPayload(relatedPrDiffGaps, unusedDepsCheck, bffRawErrorLeakCheck),
      tokenUsage: analysis.tokenUsage ?? [],
      analysis: {
        summary: isInputRateLimit
          ? 'Analysis skipped: input rate limit'
          : 'Analysis failed: rate limit',
        bugs: [],
        notBugs: [],
      },
    });
    console.log(`Saved partial analysis results for PR #${prId} (${durationMs}ms)`);
  } catch (saveError) {
    console.error('Failed to save partial analysis results:', (saveError as Error).message);
  }
}

export function saveAnalysisResult({
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
}): boolean {
  const bugsArray = (analysis.structured as { bugs?: unknown[] } | null)?.bugs || [];
  const hasBugs = Array.isArray(bugsArray) && bugsArray.length > 0;
  const durationMs = Date.now() - analysisStartMs;
  try {
    writeJsonFile(getTodayAnalysisDir(hasBugs), prId, {
      prId,
      repoFullName,
      prTitle: pr.title,
      commitHash,
      timestamp: new Date().toISOString(),
      durationMs,
      filterStats,
      changeList: changeListForSave,
      excludedFiles,
      ...savedAnalysisCheckPayload(relatedPrDiffGaps, unusedDepsCheck, bffRawErrorLeakCheck),
      tokenUsage: analysis.tokenUsage ?? [],
      analysis: analysis.structured || {
        summary: 'Failed to parse LLM JSON output',
        bugs: [],
        notBugs: [],
        parseError: analysis.parseError,
      },
    });
    console.log(
      `Saved analysis results for PR #${prId} (${hasBugs ? 'with-bugs' : 'without-bugs'}, ${durationMs}ms)`,
    );
  } catch (saveError) {
    console.error('Failed to save analysis results:', (saveError as Error).message);
  }
  return hasBugs;
}
