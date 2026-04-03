import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ANALYSIS_DIR = path.join(PROJECT_ROOT, 'pr-analysis');
const TIMESTAMP_FILE = path.join(ANALYSIS_DIR, '.latest-timestamp');
const UPDATE_TIMESTAMP_FILE = path.join(ANALYSIS_DIR, '.latest-update-timestamp');
const COMMIT_HASH_FILE = path.join(ANALYSIS_DIR, '.analyzed-commits');

function ensureAnalysisDir(): void {
  if (!fs.existsSync(ANALYSIS_DIR)) {
    fs.mkdirSync(ANALYSIS_DIR, { recursive: true });
  }
}

export function getTodayDateString(): string {
  return new Date().toISOString().split('T')[0];
}

export function getTodayAnalysisDir(hasBugs: boolean | null = null): string {
  const today = getTodayDateString();
  if (hasBugs === null) {
    return path.join(ANALYSIS_DIR, today);
  }
  const bugStatus = hasBugs ? 'with-bugs' : 'without-bugs';
  return path.join(ANALYSIS_DIR, bugStatus, today);
}

export function buildTodayUtcRange(): { startIso: string; endIso: string } {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 1);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

// --- created_on timestamp cursor ---

export function saveLatestTimestamp(timestamp: string): void {
  try {
    ensureAnalysisDir();
    fs.writeFileSync(TIMESTAMP_FILE, timestamp, 'utf8');
  } catch (error) {
    console.error('[timestamp] Failed to save latest timestamp:', (error as Error).message);
  }
}

export function loadLatestTimestamp(): string | null {
  try {
    if (fs.existsSync(TIMESTAMP_FILE)) {
      return fs.readFileSync(TIMESTAMP_FILE, 'utf8').trim();
    }
  } catch (error) {
    console.error('[timestamp] Failed to load latest timestamp:', (error as Error).message);
  }
  return null;
}

// --- updated_on timestamp cursor ---

export function saveUpdateTimestamp(timestamp: string): void {
  try {
    ensureAnalysisDir();
    fs.writeFileSync(UPDATE_TIMESTAMP_FILE, timestamp, 'utf8');
  } catch (error) {
    console.error('[timestamp] Failed to save update timestamp:', (error as Error).message);
  }
}

export function loadUpdateTimestamp(): string | null {
  try {
    if (fs.existsSync(UPDATE_TIMESTAMP_FILE)) {
      return fs.readFileSync(UPDATE_TIMESTAMP_FILE, 'utf8').trim();
    }
  } catch (error) {
    console.error('[timestamp] Failed to load update timestamp:', (error as Error).message);
  }
  return null;
}

// --- analyzed commit hash tracking ---

interface AnalyzedCommits {
  date: string;
  commits: Record<string, string>;
}

function loadAnalyzedCommits(): Record<string, string> {
  try {
    if (fs.existsSync(COMMIT_HASH_FILE)) {
      const raw: AnalyzedCommits = JSON.parse(fs.readFileSync(COMMIT_HASH_FILE, 'utf8'));
      if (raw.date === getTodayDateString()) {
        return raw.commits;
      }
    }
  } catch {
    // corrupted file — start fresh
  }
  return {};
}

export function saveAnalyzedCommit(prId: number, commitHash: string): void {
  try {
    ensureAnalysisDir();
    const commits = loadAnalyzedCommits();
    commits[String(prId)] = commitHash;
    const data: AnalyzedCommits = { date: getTodayDateString(), commits };
    fs.writeFileSync(COMMIT_HASH_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('[commits] Failed to save analyzed commit:', (error as Error).message);
  }
}

export function getAnalyzedCommitHash(prId: number): string | null {
  const commits = loadAnalyzedCommits();
  return commits[String(prId)] || null;
}

// --- analysis file checks ---

export function isPrAnalyzedToday(prId: number): boolean {
  const withBugsDir = getTodayAnalysisDir(true);
  const withoutBugsDir = getTodayAnalysisDir(false);

  const checkDir = (dir: string): boolean => {
    if (!fs.existsSync(dir)) {
      return false;
    }
    const files = fs.readdirSync(dir);
    return files.some((f) => f.startsWith(`pr-${prId}-`) && f.endsWith('.json'));
  };

  return checkDir(withBugsDir) || checkDir(withoutBugsDir);
}

export function initializeLatestTimestamp(): string | null {
  const saved = loadLatestTimestamp();
  if (saved) {
    return saved;
  }

  if (!fs.existsSync(ANALYSIS_DIR)) {
    return null;
  }

  let latestTimestamp: Date | null = null;
  const entries = fs.readdirSync(ANALYSIS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const dateFolder = path.join(ANALYSIS_DIR, entry.name);
    const files = fs.readdirSync(dateFolder);
    const prFiles = files.filter((f) => f.startsWith('pr-') && f.endsWith('.json'));

    for (const filename of prFiles) {
      const match = filename.match(/^pr-\d+-(.+)\.json$/);
      if (match) {
        const timestampStr = match[1]
          .replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
          .replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3.000Z');

        const timestamp = new Date(timestampStr);
        if (!isNaN(timestamp.getTime())) {
          if (!latestTimestamp || timestamp > latestTimestamp) {
            latestTimestamp = timestamp;
          }
        }
      }
    }
  }

  return latestTimestamp ? latestTimestamp.toISOString() : null;
}

// --- migration ---

export function migratePrAnalysisFiles(): void {
  if (!fs.existsSync(ANALYSIS_DIR)) {
    return;
  }

  const files = fs.readdirSync(ANALYSIS_DIR);
  const prFiles = files.filter(
    (f) => f.startsWith('pr-') && f.endsWith('.json') && f !== '.latest-timestamp',
  );

  if (prFiles.length === 0) {
    return;
  }

  let movedCount = 0;
  for (const filename of prFiles) {
    const match = filename.match(/^pr-\d+-(.+)\.json$/);
    if (match) {
      const timestampStr = match[1]
        .replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z')
        .replace(/T(\d{2})-(\d{2})-(\d{2})Z$/, 'T$1:$2:$3.000Z');

      const timestamp = new Date(timestampStr);
      if (!isNaN(timestamp.getTime())) {
        const fileDate = timestamp.toISOString().split('T')[0];
        const targetDir = path.join(ANALYSIS_DIR, fileDate);

        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }

        const sourcePath = path.join(ANALYSIS_DIR, filename);
        const targetPath = path.join(targetDir, filename);

        if (!fs.existsSync(targetPath)) {
          fs.renameSync(sourcePath, targetPath);
          movedCount++;
        } else {
          fs.unlinkSync(sourcePath);
        }
      }
    }
  }

  if (movedCount > 0) {
    console.log(`[migration] Moved ${movedCount} PR analysis file(s) to date subfolders`);
  }
}
