function looksLikeFunctionSignature(line: string): boolean {
  if (/^\s*(if|for|while|switch|catch)\b/.test(line)) return false;
  if (/\bfunction\b/.test(line)) return true;
  if (/=>/.test(line) && /\(.*\)/.test(line)) return true;
  if (/^\s*def\s+\w+\s*\(.*\)/.test(line)) return true;
  if (/^\s*(public|private|protected)\b/.test(line) && /\(.*\)/.test(line)) return true;
  if (/^\s*\w+\s*\(.*\)\s*{/.test(line)) return true;
  return false;
}

function looksLikeFunctionalChange(line: string): boolean {
  if (/\b(if|else if|switch|case|return|throw|catch|while|for|await)\b/.test(line)) return true;
  if (/&&|\|\||===|!==|==|!=|<=|>=/.test(line)) return true;
  return false;
}

export function hasParamOrFunctionalChange(diffText: string): boolean {
  const lines = diffText.split('\n');
  for (const line of lines) {
    if (!(line.startsWith('+') || line.startsWith('-'))) continue;
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    const clean = line.slice(1).trim();
    if (!clean) continue;
    if (looksLikeFunctionSignature(clean) || looksLikeFunctionalChange(clean)) {
      return true;
    }
  }
  return false;
}

export function hasMultipleHunks(diffText: string): boolean {
  const lines = diffText.split('\n');
  let hunkCount = 0;
  for (const line of lines) {
    if (line.match(/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/)) {
      hunkCount++;
    }
  }
  return hunkCount > 1;
}
