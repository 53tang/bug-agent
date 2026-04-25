/**
 * Run ESLint only on files changed in the working tree (staged + unstaged).
 *
 * By default, only lints: .ts, .tsx, .mjs, .cjs, .js, .jsx
 * Excludes file types in LINT_IGNORE_EXT (comma-separated, no leading dots).
 * Override lintable set with LINT_EXT (e.g. LINT_EXT=ts,tsx).
 *
 * LINT_BASE=main  — compare a ref to HEAD instead (branch changes vs main)
 *   example: LINT_BASE=main npm run lint:changed
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  dirname,
  join,
  resolve,
  normalize,
  relative,
  extname as pathExt,
} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const IGNORED_EXT = new Set(
  (process.env.LINT_IGNORE_EXT ||
    'md,json,lock,yml,yaml,html,htm,css,scss,less,svg,png,jpg,jpeg,gif,webp,ico,woff,woff2,ttf,eot,txt,log,env,example,snap')
    .split(/[\s,]+/)
    .map((e) => e.replace(/^\./, '').toLowerCase())
    .filter(Boolean),
);

const LINTABLE_EXT = new Set(
  (process.env.LINT_EXT || 'ts,tsx,js,mjs,cjs,jsx')
    .split(/[\s,]+/)
    .map((e) => e.replace(/^\./, '').toLowerCase())
    .filter(Boolean),
);

function sh(cmd) {
  const r = spawnSync(cmd, { shell: true, encoding: 'utf8', cwd: root });
  if (r.error) {
    throw r.error;
  }
  return (r.stdout || '')
    .trim()
    .split('\n')
    .filter(Boolean);
}

function changedPaths() {
  const base = process.env.LINT_BASE;
  if (base) {
    return sh(`git diff --name-only --diff-filter=ACMRT "${base}...HEAD"`);
  }
  const unstaged = sh('git diff --name-only --diff-filter=ACM');
  const staged = sh('git diff --name-only --cached --diff-filter=ACM');
  return [...new Set([...unstaged, ...staged])];
}

function fileExt(p) {
  return pathExt(p).replace(/^\./, '').toLowerCase();
}

function pickLintFiles(paths) {
  const out = [];
  for (const p of paths) {
    const rel = normalize(p).replaceAll('\\', '/');
    if (rel.startsWith('..')) {
      continue;
    }
    const abs = resolve(root, p);
    const fromRoot = relative(root, abs);
    if (fromRoot.startsWith('..') || fromRoot.includes('..')) {
      continue;
    }
    const ext = fileExt(abs);
    if (!ext) {
      continue;
    }
    if (IGNORED_EXT.has(ext) || !LINTABLE_EXT.has(ext)) {
      continue;
    }
    if (!existsSync(abs)) {
      continue;
    }
    out.push(fromRoot);
  }
  return [...new Set(out)];
}

function findEslint() {
  const local = join(root, 'node_modules', 'eslint', 'bin', 'eslint.js');
  if (existsSync(local)) {
    return local;
  }
  return null;
}

const files = pickLintFiles(changedPaths());
const eslintBin = findEslint();
if (!eslintBin) {
  console.error('eslint not found. Run npm install (or pnpm / bun i) in the project root first.');
  process.exit(1);
}
if (files.length === 0) {
  console.log('No matching changed files to lint (after extension filters).');
  process.exit(0);
}
console.log('Linting changed files:');
for (const f of files) {
  console.log(`  ${f}`);
}
const extra = process.argv.slice(2);
const r = spawnSync(
  process.execPath,
  [eslintBin, ...files, ...extra],
  { stdio: 'inherit', cwd: root, shell: false },
);
process.exit(r.status === null ? 1 : r.status);
