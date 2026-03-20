import type { Structured } from './types';

export function renderMarkdownFromStructured(structured: Structured | null | undefined): string {
  if (!structured) return '';

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
}
