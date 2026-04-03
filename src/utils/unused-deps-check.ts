import type { FileDiff } from '../diff';
import type { UnusedDepsCheckResult, UnusedDepViolation } from '../analysis/types';

const DEPENDENCY_BLOCK_START =
  /^"(dependencies|devDependencies|optionalDependencies|peerDependencies)"\s*:\s*\{\s*$/;

function escapeForRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split a unified diff body into @@ hunks (each chunk starts with @@). */
function splitIntoHunks(diff: string): string[] {
  const lines = diff.split(/\r?\n/);
  const hunks: string[] = [];
  let i = 0;
  while (i < lines.length && !lines[i].startsWith('@@')) {
    i += 1;
  }
  while (i < lines.length) {
    const start = i;
    i += 1;
    while (i < lines.length && !lines[i].startsWith('@@')) {
      i += 1;
    }
    hunks.push(lines.slice(start, i).join('\n'));
  }
  return hunks;
}

/**
 * Lines from a hunk that represent the "after" file: context and additions only.
 * Each line records whether it was newly added in the patch.
 */
function mergedHunkLines(hunk: string): Array<{ content: string; added: boolean }> {
  const out: Array<{ content: string; added: boolean }> = [];
  for (const line of hunk.split(/\r?\n/)) {
    if (line.startsWith('@@') || line.startsWith('---') || line.startsWith('+++')) {
      continue;
    }
    if (line.startsWith('-')) {
      continue;
    }
    if (line.startsWith('+')) {
      out.push({ content: line.slice(1), added: true });
    } else if (line.startsWith(' ')) {
      out.push({ content: line.slice(1), added: false });
    }
  }
  return out;
}

/**
 * Package names that appear on added lines inside real dependency blocks only
 * (excludes `engines`, `scripts`, and other `"key": "semver"`-looking entries).
 */
function extractAddedDependencyKeys(diff: string): string[] {
  const names: string[] = [];
  for (const hunk of splitIntoHunks(diff)) {
    let inDepBlock = false;
    for (const { content, added } of mergedHunkLines(hunk)) {
      const t = content.trim();
      if (!inDepBlock) {
        if (DEPENDENCY_BLOCK_START.test(t)) {
          inDepBlock = true;
        }
        continue;
      }
      if (t === '}' || t === '},') {
        inDepBlock = false;
        continue;
      }
      const match = t.match(/^"(@?[\w][\w./-]*)"\s*:\s*"[^"]+"/);
      if (match && added) {
        names.push(match[1]);
      }
    }
  }
  return names;
}

/** True if this key was already present and only the version (or line) changed. */
function hadRemovalOfPackageKey(packageJsonDiff: string, pkgName: string): boolean {
  const esc = escapeForRegExp(pkgName);
  return new RegExp(`^-\\s*"${esc}"\\s*:`, 'm').test(packageJsonDiff);
}

/**
 * Dependency keys that are newly introduced in this patch (no `- "pkg":` removal).
 * Version bumps and `engines.node`-style keys outside dependency blocks are excluded.
 */
function extractNewlyAddedDependencyNames(packageJsonDiff: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of extractAddedDependencyKeys(packageJsonDiff)) {
    if (hadRemovalOfPackageKey(packageJsonDiff, name)) {
      continue;
    }
    if (!seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

function buildImportPattern(depName: string): RegExp {
  const escaped = escapeForRegExp(depName);
  return new RegExp(
    `(from\\s+['"]${escaped}(?:/[^'"]*)?['"]|require\\(['"]${escaped}(?:/[^'"]*)?['"]\\))`,
  );
}

function isImportedInChangedFiles(depName: string, fileDiffs: FileDiff[]): boolean {
  const pattern = buildImportPattern(depName);
  for (const { filePath, diff } of fileDiffs) {
    if (filePath.endsWith('package.json')) continue;
    const addedContent = diff
      .split(/\r?\n/)
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
    const newDeps = extractNewlyAddedDependencyNames(diff);
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
    '  The following **new** dependencies were added to `package.json` (not a version bump of an existing key) but no import or require was found in the changed files:',
  );
  for (const d of result.unusedDeps) {
    lines.push(`  - \`${d.name}\` (in \`${d.packageJsonPath}\`)`);
  }
  return lines.join('\n');
}
