import type { FileDiff, HunkRange } from './types';

export function splitDiffByFile(diffText: string): FileDiff[] {
  const files: FileDiff[] = [];
  const lines = diffText.split('\n');
  let currentFile: string | null = null;
  let currentLines: string[] = [];

  for (const line of lines) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (match) {
      if (currentFile) {
        files.push({ filePath: currentFile, diff: currentLines.join('\n') });
      }
      currentFile = match[2];
      currentLines = [line];
      continue;
    }
    if (currentFile) {
      currentLines.push(line);
    }
  }

  if (currentFile) {
    files.push({ filePath: currentFile, diff: currentLines.join('\n') });
  }

  return files;
}

export function getChangedFilesFromDiff(diffText: string): Set<string> {
  const files = splitDiffByFile(diffText);
  return new Set(files.map((file) => file.filePath));
}

export function parseHunkRanges(diffText: string, contextLines: number): HunkRange[] {
  const ranges: HunkRange[] = [];
  const lines = diffText.split('\n');
  for (const line of lines) {
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
    if (!match) continue;
    const start = Number(match[1]);
    const count = match[2] ? Number(match[2]) : 1;
    if (!Number.isFinite(start) || !Number.isFinite(count)) continue;
    if (count <= 0) continue;
    const rangeStart = Math.max(1, start - contextLines);
    const rangeEnd = start + count - 1 + contextLines;
    ranges.push({ start: rangeStart, end: rangeEnd });
  }
  if (ranges.length === 0) return [];
  ranges.sort((a, b) => a.start - b.start);
  const merged: HunkRange[] = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    const current = ranges[i];
    if (current.start <= last.end + 1) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }
  return merged;
}

export function buildContentExcerpt(
  fullContent: string,
  diffText: string,
  contextLines: number,
  maxChars: number,
): string {
  const ranges = parseHunkRanges(diffText, contextLines);
  if (ranges.length === 0) return '';
  const lines = fullContent.split('\n');
  const chunks: string[] = [];
  for (const range of ranges) {
    const start = Math.max(1, range.start);
    const end = Math.min(lines.length, range.end);
    if (start > end) continue;
    chunks.push(`@@ L${start}-L${end} @@`);
    for (let i = start; i <= end; i++) {
      const line = lines[i - 1] ?? '';
      chunks.push(`${i}|${line}`);
      if (maxChars && chunks.join('\n').length >= maxChars) {
        const joined = chunks.join('\n');
        return joined.slice(0, maxChars);
      }
    }
  }
  const result = chunks.join('\n');
  if (maxChars && result.length > maxChars) {
    return result.slice(0, maxChars);
  }
  return result;
}
