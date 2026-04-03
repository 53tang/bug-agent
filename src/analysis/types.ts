import type { MoonshotResult } from '../moonshot';

export interface UnusedDepViolation {
  name: string;
  packageJsonPath: string;
}

export interface UnusedDepsCheckResult {
  unusedDeps: UnusedDepViolation[];
}

export interface RelatedPrDiffGaps {
  searchedTitle: string;
  matchStrategy: string;
  currentPr: { id: number; title: string; destination: string };
  candidatesFound: number;
  eligibleRelatedPrs: RelatedPrEntry[];
  skipped: boolean;
  reason?: string;
  error?: string;
}

export interface RelatedPrEntry {
  id: number;
  title: string;
  state: string;
  destination: string;
  missingFiles: string[];
  error?: string;
}

export interface AnalysisResult {
  success: boolean;
  skipped?: boolean;
  reason?: string;
  message?: string;
  quotaExceeded?: boolean;
  analysis?: MoonshotResult;
  bugs?: unknown[];
  prId: number;
  repoFullName: string;
  prTitle: string;
  relatedPrDiffGaps?: RelatedPrDiffGaps;
  /** Wall-clock milliseconds for the full `analyzePR` call (including post-save work). */
  durationMs: number;
}
