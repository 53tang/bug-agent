import type {
  AdbHeaderCheckResult,
  RelatedPrDiffGaps,
  UnusedDepsCheckResult,
} from '../analysis/types';
import { renderAdbHeaderCheck } from './adb-header-check';
import { renderRelatedPrDiffGaps } from './related-prs';
import { renderUnusedDepsCheck } from './unused-deps-check';

function shouldIncludeRelatedPr(relatedPrDiffGaps: RelatedPrDiffGaps): boolean {
  if (relatedPrDiffGaps.candidatesFound <= 0) return false;
  return Boolean(renderRelatedPrDiffGaps(relatedPrDiffGaps));
}

/** Which automated-check sections have reportable findings (full payloads stay top-level on the saved JSON). */
export type SparseCheck = {
  relatedPrDiffGaps?: true;
  adbHeaderCheck?: true;
  unusedDepsCheck?: true;
};

export function buildSparseCheck(
  relatedPrDiffGaps: RelatedPrDiffGaps,
  adbHeaderCheck: AdbHeaderCheckResult,
  unusedDepsCheck: UnusedDepsCheckResult,
): SparseCheck | undefined {
  const check: SparseCheck = {};
  if (shouldIncludeRelatedPr(relatedPrDiffGaps)) {
    check.relatedPrDiffGaps = true;
  }
  if (adbHeaderCheck.violations.length > 0) {
    check.adbHeaderCheck = true;
  }
  if (unusedDepsCheck.unusedDeps.length > 0) {
    check.unusedDepsCheck = true;
  }
  return Object.keys(check).length > 0 ? check : undefined;
}

export function buildAutomatedChecksComment(
  relatedPrDiffGaps: RelatedPrDiffGaps,
  adbHeaderCheck: AdbHeaderCheckResult,
  unusedDepsCheck: UnusedDepsCheckResult,
): string {
  const sections: string[] = [];
  if (shouldIncludeRelatedPr(relatedPrDiffGaps)) {
    sections.push(renderRelatedPrDiffGaps(relatedPrDiffGaps));
  }
  const adbMd = renderAdbHeaderCheck(adbHeaderCheck);
  if (adbMd) sections.push(adbMd);
  const unusedMd = renderUnusedDepsCheck(unusedDepsCheck);
  if (unusedMd) sections.push(unusedMd);
  if (sections.length === 0) return '';

  return `## Automated checks

${sections.join('\n\n')}`;
}
