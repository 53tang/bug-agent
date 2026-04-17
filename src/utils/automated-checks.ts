import type {
  BffRawErrorLeakCheckResult,
  RelatedPrDiffGaps,
  UnusedDepsCheckResult,
} from '../analysis/types';
import { renderBffRawErrorLeakCheck } from './bff-raw-error-response-check';
import { renderRelatedPrDiffGaps } from './related-prs';
import { renderUnusedDepsCheck } from './unused-deps-check';

function shouldIncludeRelatedPr(relatedPrDiffGaps: RelatedPrDiffGaps): boolean {
  if (relatedPrDiffGaps.candidatesFound <= 0) return false;
  return Boolean(renderRelatedPrDiffGaps(relatedPrDiffGaps));
}

/** Which automated-check sections have reportable findings (full payloads stay top-level on the saved JSON). */
export type SparseCheck = {
  relatedPrDiffGaps?: true;
  unusedDepsCheck?: true;
  bffRawErrorLeakCheck?: true;
};

export function buildSparseCheck(
  relatedPrDiffGaps: RelatedPrDiffGaps,
  unusedDepsCheck: UnusedDepsCheckResult,
  bffRawErrorLeakCheck: BffRawErrorLeakCheckResult,
): SparseCheck | undefined {
  const check: SparseCheck = {};
  if (shouldIncludeRelatedPr(relatedPrDiffGaps)) {
    check.relatedPrDiffGaps = true;
  }
  if (unusedDepsCheck.unusedDeps.length > 0) {
    check.unusedDepsCheck = true;
  }
  if (bffRawErrorLeakCheck.violations.length > 0) {
    check.bffRawErrorLeakCheck = true;
  }
  return Object.keys(check).length > 0 ? check : undefined;
}

export function buildAutomatedChecksComment(
  relatedPrDiffGaps: RelatedPrDiffGaps,
  unusedDepsCheck: UnusedDepsCheckResult,
  bffRawErrorLeakCheck: BffRawErrorLeakCheckResult,
): string {
  const sections: string[] = [];
  if (shouldIncludeRelatedPr(relatedPrDiffGaps)) {
    sections.push(renderRelatedPrDiffGaps(relatedPrDiffGaps));
  }
  const unusedMd = renderUnusedDepsCheck(unusedDepsCheck);
  if (unusedMd) sections.push(unusedMd);
  const bffMd = renderBffRawErrorLeakCheck(bffRawErrorLeakCheck);
  if (bffMd) sections.push(bffMd);
  if (sections.length === 0) return '';

  return `## Automated checks

${sections.join('\n\n')}`;
}
