import type { Bug, NotBug, Structured } from './types';

export function hasSpeculativeNotBugs(notBugs: unknown): boolean {
  if (!Array.isArray(notBugs)) return false;
  return notBugs.some((item) =>
    String((item as NotBug)?.reason || '')
      .toLowerCase()
      .includes('speculative'),
  );
}

export function formatSpeculativeNotBugs(notBugs: unknown): string {
  if (!Array.isArray(notBugs)) return '';
  const items = notBugs.filter((item) =>
    String((item as NotBug)?.reason || '')
      .toLowerCase()
      .includes('speculative'),
  );
  if (items.length === 0) return '';
  const lines = items.slice(0, 3).map((item) => {
    const topic = String((item as NotBug)?.topic || 'Speculative');
    const reason = String((item as NotBug)?.reason || 'speculative');
    return `- ${topic}: ${reason}`;
  });
  return ['Speculative issues (not confirmed):', ...lines].join('\n');
}

export function shouldDemoteVocCdcMulesoftBug(bug: Bug): boolean {
  const title = String(bug?.title || '').toLowerCase();
  const description = String(bug?.description || '').toLowerCase();
  const filePath = String(bug?.filePath || bug?.file || '').toLowerCase();
  const mentionsVoc = title.includes('voc') || description.includes('voc');
  const mentionsMulesoft = title.includes('mulesoft') || description.includes('mulesoft');
  const mentionsConsent = title.includes('consent') || description.includes('consent');
  const isConsentFile = filePath.includes('consents') || filePath.includes('consent');
  return mentionsVoc && mentionsMulesoft && mentionsConsent && isConsentFile;
}

export function demoteVocCdcMulesoftBugs(
  structured: Structured | null | undefined,
): Structured | null | undefined {
  if (!structured || !Array.isArray(structured.bugs)) return structured;
  const retained: Bug[] = [];
  const demoted: NotBug[] = [];
  for (const bug of structured.bugs) {
    if (shouldDemoteVocCdcMulesoftBug(bug)) {
      demoted.push({
        topic: bug.title || 'VOC consent mapping',
        reason:
          'CDC vs Mulesoft path mapping differences; not a bug unless the same path is internally inconsistent or the diff explicitly removes required VOC handling.',
      });
    } else {
      retained.push(bug);
    }
  }
  if (demoted.length === 0) return structured;
  const notBugs = Array.isArray(structured.notBugs) ? structured.notBugs : [];
  return {
    ...structured,
    bugs: retained,
    notBugs: notBugs.concat(demoted),
  };
}
