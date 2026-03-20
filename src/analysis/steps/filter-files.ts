import { shouldIncludeFile } from '../../../fileFilter';
import type { FileDiff } from '../../diff';

export interface FilterResult {
  includedFileDiffs: FileDiff[];
  excludedFiles: string[];
  filterStats: { total: number; included: number; excluded: number };
}

export function filterDiffFiles(fileDiffs: FileDiff[]): FilterResult {
  const includedFileDiffs: FileDiff[] = [];
  const excludedFiles: string[] = [];

  for (const file of fileDiffs) {
    if (shouldIncludeFile(file.filePath, file.diff)) {
      includedFileDiffs.push(file);
    } else {
      excludedFiles.push(file.filePath);
    }
  }

  console.log(`\n=== File Filtering Results ===`);
  console.log(`Total files: ${fileDiffs.length}`);
  console.log(`Included files: ${includedFileDiffs.length}`);
  console.log(`Excluded files: ${excludedFiles.length}`);
  if (excludedFiles.length > 0) {
    console.log(`Excluded file paths:`, excludedFiles);
  }
  console.log(`=============================\n`);

  return {
    includedFileDiffs,
    excludedFiles,
    filterStats: {
      total: fileDiffs.length,
      included: includedFileDiffs.length,
      excluded: excludedFiles.length,
    },
  };
}
