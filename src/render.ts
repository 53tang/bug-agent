export interface Bug {
  title?: string;
  issue?: string;
  description?: string;
  filePath?: string;
  file?: string;
  lineHint?: string;
  risk?: string;
  codeSnippet?: string;
}

export interface NotBug {
  topic?: string;
  reason?: string;
}

export interface Suggestion {
  topic?: string;
  suggestion?: string;
  recommendation?: string;
  text?: string;
  rationale?: string;
}

export interface Structured {
  bugs?: Bug[];
  notBugs?: NotBug[];
  suggestions?: Suggestion[];
}

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

export function renderMarkdownFromStructured(structured: Structured | null | undefined): string {
  if (!structured) return '';

  const renderBugsSection = (): string => {
    if (!Array.isArray(structured.bugs) || structured.bugs.length === 0) {
      return '';
    }
    const filteredBugs = structured.bugs.filter((bug) => {
      const title = String(bug.title || bug.issue || '').toLowerCase();
      const desc = String(bug.description || '').toLowerCase();
      return !(
        title.includes('react hook') ||
        title.includes('rules of hooks') ||
        title.includes('hook rule') ||
        title.includes('hook violation') ||
        title.includes('conditional hook') ||
        desc.includes('react hook') ||
        desc.includes('rules of hooks') ||
        desc.includes('hook rule') ||
        desc.includes('hook violation') ||
        desc.includes('conditional hook')
      );
    });
    if (filteredBugs.length === 0) {
      return '';
    }
    return filteredBugs
      .slice(0, 3)
      .map((bug, index) => {
        const file = bug.filePath || bug.file || 'unknown file';
        const line = bug.lineHint ? ` (${bug.lineHint})` : '';
        const title = bug.title || bug.issue || `Issue ${index + 1}`;
        const description = bug.description ? `- Desc: ${bug.description}` : '';
        // const risk = bug.risk ? `- Risk: ${bug.risk}` : '';

        // Add code snippet with diff formatting if available
        const codeSnippet = bug.codeSnippet ? `\n\`\`\`diff\n${bug.codeSnippet}\n\`\`\`` : '';

        return [
          `### 🔴 HIGH SEVERITY ISSUE: ${title}`,
          `- File: \`${file}\`${line}`,
          codeSnippet,
          description,
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');
  };

  const renderSuggestionsSection = (): string => {
    if (!Array.isArray(structured.suggestions)) return '';
    const normalized = structured.suggestions
      .map((item) => {
        const topic = String((item as Suggestion)?.topic || 'Suggestion').trim();
        const suggestion = String(
          (item as Suggestion)?.suggestion ||
            (item as Suggestion)?.recommendation ||
            (item as Suggestion)?.text ||
            '',
        ).trim();
        const rationale = String((item as Suggestion)?.rationale || '').trim();
        if (!suggestion) return null;
        const topicLabel = topic ? `${topic}: ` : '';
        const rationaleText = rationale ? ` (Reason: ${rationale})` : '';
        return `- ${topicLabel}${suggestion}${rationaleText}`;
      })
      .filter(Boolean);
    if (normalized.length === 0) return '';
    return [`### 🟡 Suggestions`, ...normalized].join('\n');
  };

  const bugsSection = renderBugsSection();
  const suggestionsSection = renderSuggestionsSection();

  if (!bugsSection && !suggestionsSection) return '';
  if (bugsSection && suggestionsSection) {
    return `${bugsSection}\n\n${suggestionsSection}`;
  }
  return bugsSection || suggestionsSection;
}
