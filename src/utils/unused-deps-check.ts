import type { FileDiff } from '../diff';
import type { UnusedDepsCheckResult, UnusedDepViolation } from '../analysis/types';

function extractAddedDeps(diff: string): string[] {
  const addedLines = diff
    .split('\n')
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1));

  const deps: string[] = [];
  for (const line of addedLines) {
    // Match "package-name": "version" lines inside dependencies/devDependencies
    const match = line.match(/^\s+"(@?[\w][\w./-]*)"\s*:\s*"[^"]+"/);
    if (match) {
      deps.push(match[1]);
    }
  }
  return deps;
}

function buildImportPattern(depName: string): RegExp {
  const escaped = depName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `(from\\s+['"]${escaped}(?:/[^'"]*)?['"]|require\\(['"]${escaped}(?:/[^'"]*)?['"]\\))`,
  );
}

function isImportedInChangedFiles(depName: string, fileDiffs: FileDiff[]): boolean {
  const pattern = buildImportPattern(depName);
  for (const { filePath, diff } of fileDiffs) {
    if (filePath.endsWith('package.json')) continue;
    const addedContent = diff
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .map((line) => line.slice(1))
      .join('\n');
    if (pattern.test(addedContent)) return true;
  }
  return false;
}

export function checkUnusedDeps(fileDiffs: FileDiff[]): UnusedDepsCheckResult {
  const unusedDeps: UnusedDepViolation[] = [];

  const packageJsonDiffs = fileDiffs.filter((f) => f.filePath.endsWith('package.json'));
  for (const { filePath, diff } of packageJsonDiffs) {
    const newDeps = extractAddedDeps(diff);
    for (const name of newDeps) {
      if (!isImportedInChangedFiles(name, fileDiffs)) {
        unusedDeps.push({ name, packageJsonPath: filePath });
      }
    }
  }

  return { unusedDeps };
}

export function renderUnusedDepsCheck(result: UnusedDepsCheckResult): string {
  if (!result || result.unusedDeps.length === 0) return '';

  const lines = ['- ### Unused Third-Party Dependency Check'];
  lines.push(
    '  The following dependencies were added to `package.json` but no import or require was found in the changed files:',
  );
  for (const d of result.unusedDeps) {
    lines.push(`  - \`${d.name}\` (in \`${d.packageJsonPath}\`)`);
  }
  return lines.join('\n');
}
