"use strict";

function splitDiffByFile(diffText) {
  const files = [];
  const lines = diffText.split("\n");
  let currentFile = null;
  let currentLines = [];

  for (const line of lines) {
    const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
    if (match) {
      if (currentFile) {
        files.push({ filePath: currentFile, diff: currentLines.join("\n") });
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
    files.push({ filePath: currentFile, diff: currentLines.join("\n") });
  }

  return files;
}

function getChangedFilesFromDiff(diffText) {
  const files = splitDiffByFile(diffText);
  return new Set(files.map((file) => file.filePath));
}

function parseHunkRanges(diffText, contextLines) {
  const ranges = [];
  const lines = diffText.split("\n");
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
  const merged = [ranges[0]];
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

function buildContentExcerpt(fullContent, diffText, contextLines, maxChars) {
  const ranges = parseHunkRanges(diffText, contextLines);
  if (ranges.length === 0) return "";
  const lines = fullContent.split("\n");
  const chunks = [];
  for (const range of ranges) {
    const start = Math.max(1, range.start);
    const end = Math.min(lines.length, range.end);
    if (start > end) continue;
    chunks.push(`@@ L${start}-L${end} @@`);
    for (let i = start; i <= end; i++) {
      const line = lines[i - 1] ?? "";
      chunks.push(`${i}|${line}`);
      if (maxChars && chunks.join("\n").length >= maxChars) {
        const joined = chunks.join("\n");
        return joined.slice(0, maxChars);
      }
    }
  }
  const result = chunks.join("\n");
  if (maxChars && result.length > maxChars) {
    return result.slice(0, maxChars);
  }
  return result;
}

function looksLikeFunctionSignature(line) {
  if (/^\s*(if|for|while|switch|catch)\b/.test(line)) return false;
  if (/\bfunction\b/.test(line)) return true;
  if (/=>/.test(line) && /\(.*\)/.test(line)) return true;
  if (/^\s*def\s+\w+\s*\(.*\)/.test(line)) return true;
  if (/^\s*(public|private|protected)\b/.test(line) && /\(.*\)/.test(line))
    return true;
  if (/^\s*\w+\s*\(.*\)\s*{/.test(line)) return true;
  return false;
}

function looksLikeFunctionalChange(line) {
  if (
    /\b(if|else if|switch|case|return|throw|catch|while|for|await)\b/.test(line)
  )
    return true;
  if (/&&|\|\||===|!==|==|!=|<=|>=/.test(line)) return true;
  return false;
}

function hasParamOrFunctionalChange(diffText) {
  const lines = diffText.split("\n");
  for (const line of lines) {
    if (!(line.startsWith("+") || line.startsWith("-"))) continue;
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    const clean = line.slice(1).trim();
    if (!clean) continue;
    if (looksLikeFunctionSignature(clean) || looksLikeFunctionalChange(clean)) {
      return true;
    }
  }
  return false;
}

function hasMultipleHunks(diffText) {
  const lines = diffText.split("\n");
  let hunkCount = 0;
  for (const line of lines) {
    if (line.match(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/)) {
      hunkCount++;
    }
  }
  return hunkCount > 1;
}

module.exports = {
  splitDiffByFile,
  getChangedFilesFromDiff,
  parseHunkRanges,
  buildContentExcerpt,
  hasParamOrFunctionalChange,
  hasMultipleHunks,
};
