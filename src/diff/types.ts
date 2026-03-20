export interface FileDiff {
  filePath: string;
  diff: string;
}

export interface HunkRange {
  start: number;
  end: number;
}
