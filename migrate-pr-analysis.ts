/**
 * Migration script to reorganize PR analysis files into with-bugs and without-bugs directories
 * Usage: bun migrate-pr-analysis.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PR_ANALYSIS_DIR = path.join(__dirname, 'pr-analysis');

interface MigrationStats {
  totalProcessed: number;
  withBugs: number;
  withoutBugs: number;
  errors: Array<{ file: string; error: string }>;
  skipped: number;
}

const stats: MigrationStats = {
  totalProcessed: 0,
  withBugs: 0,
  withoutBugs: 0,
  errors: [],
  skipped: 0,
};

interface PrAnalysisData {
  analysis?: {
    bugs?: unknown[];
    structured?: {
      bugs?: unknown[];
    };
  };
}

function hasBugs(data: PrAnalysisData): boolean {
  if (!data || !data.analysis) {
    return false;
  }

  if (Array.isArray(data.analysis.bugs)) {
    return data.analysis.bugs.length > 0;
  }

  if (data.analysis.structured && Array.isArray(data.analysis.structured.bugs)) {
    return data.analysis.structured.bugs.length > 0;
  }

  return false;
}

function processFile(sourcePath: string, dateFolder: string, filename: string): void {
  try {
    const content = fs.readFileSync(sourcePath, 'utf8');

    if (!content.trim()) {
      console.warn(`Warning: Empty file: ${filename}`);
      stats.errors.push({ file: filename, error: 'Empty file' });
      stats.skipped++;
      return;
    }

    const data: PrAnalysisData = JSON.parse(content);

    const prHasBugs = hasBugs(data);
    const bugStatus = prHasBugs ? 'with-bugs' : 'without-bugs';

    const targetDir = path.join(PR_ANALYSIS_DIR, bugStatus, dateFolder);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const targetPath = path.join(targetDir, filename);

    if (fs.existsSync(targetPath)) {
      console.log(`Already exists: ${bugStatus}/${dateFolder}/${filename}`);
      fs.unlinkSync(sourcePath);
      stats.skipped++;
      return;
    }

    fs.renameSync(sourcePath, targetPath);

    stats.totalProcessed++;
    if (prHasBugs) {
      stats.withBugs++;
      console.log(`[WITH BUGS] Moved: ${dateFolder}/${filename}`);
    } else {
      stats.withoutBugs++;
      console.log(`[NO BUGS] Moved: ${dateFolder}/${filename}`);
    }
  } catch (error) {
    console.error(`Error processing ${filename}:`, (error as Error).message);
    stats.errors.push({ file: filename, error: (error as Error).message });
  }
}

function processDateFolder(dateFolder: string): void {
  const dateFolderPath = path.join(PR_ANALYSIS_DIR, dateFolder);

  const stat = fs.statSync(dateFolderPath);
  if (!stat.isDirectory()) {
    return;
  }

  if (dateFolder === 'with-bugs' || dateFolder === 'without-bugs') {
    return;
  }

  console.log(`\nProcessing folder: ${dateFolder}`);

  const files = fs.readdirSync(dateFolderPath);
  const prFiles = files.filter((f) => f.startsWith('pr-') && f.endsWith('.json'));

  console.log(`   Found ${prFiles.length} PR analysis file(s)`);

  for (const filename of prFiles) {
    const sourcePath = path.join(dateFolderPath, filename);
    processFile(sourcePath, dateFolder, filename);
  }

  const remainingFiles = fs.readdirSync(dateFolderPath);
  if (remainingFiles.length === 0) {
    fs.rmdirSync(dateFolderPath);
    console.log(`   Removed empty folder: ${dateFolder}`);
  }
}

export function migrate(): void {
  console.log('Starting PR Analysis Migration');
  console.log('================================\n');

  if (!fs.existsSync(PR_ANALYSIS_DIR)) {
    console.error('pr-analysis directory not found!');
    process.exit(1);
  }

  const entries = fs.readdirSync(PR_ANALYSIS_DIR);
  const dateFolders = entries.filter((entry) => {
    const entryPath = path.join(PR_ANALYSIS_DIR, entry);
    const stat = fs.statSync(entryPath);
    return (
      stat.isDirectory() && entry !== 'with-bugs' && entry !== 'without-bugs' && entry !== '.git'
    );
  });

  console.log(`Found ${dateFolders.length} date folder(s) to process\n`);

  if (dateFolders.length === 0) {
    console.log('No files to migrate. All files are already organized.');
    return;
  }

  for (const dateFolder of dateFolders) {
    processDateFolder(dateFolder);
  }

  console.log('\n================================');
  console.log('Migration Summary');
  console.log('================================');
  console.log(`Total files processed: ${stats.totalProcessed}`);
  console.log(`  - With bugs: ${stats.withBugs}`);
  console.log(`  - Without bugs: ${stats.withoutBugs}`);
  console.log(`Files skipped (already exist): ${stats.skipped}`);
  console.log(`Errors encountered: ${stats.errors.length}`);

  if (stats.errors.length > 0) {
    console.log('\nErrors:');
    stats.errors.forEach(({ file, error }) => {
      console.log(`  - ${file}: ${error}`);
    });
  }

  console.log('\nMigration complete!');
}

if (import.meta.main) {
  try {
    migrate();
  } catch (error) {
    console.error('Fatal error during migration:', error);
    process.exit(1);
  }
}
