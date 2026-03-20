import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { minimatch } from 'minimatch';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface SizeRules {
  hard_exclude_bytes: number;
  soft_exclude_bytes: number;
  always_include_exts_even_if_large: string[];
}

interface FilterConfig {
  exclude_paths: string[];
  exclude_exts: string[];
  exclude_files: string[];
  size_rules: SizeRules;
}

let filterConfig: FilterConfig | null = null;

export function loadFilterConfig(): FilterConfig {
  if (filterConfig) {
    return filterConfig;
  }

  const configPath = path.join(__dirname, 'file-filter.yaml');

  if (!fs.existsSync(configPath)) {
    console.warn(`File filter config not found at ${configPath}, using defaults`);
    filterConfig = {
      exclude_paths: [],
      exclude_exts: [],
      exclude_files: [],
      size_rules: {
        hard_exclude_bytes: 2097152,
        soft_exclude_bytes: 307200,
        always_include_exts_even_if_large: [],
      },
    };
    return filterConfig;
  }

  try {
    const fileContent = fs.readFileSync(configPath, 'utf8');
    const parsed = yaml.load(fileContent) as Record<string, unknown>;
    filterConfig = (parsed.bug_agent_file_filter || parsed) as FilterConfig;
    console.log('Loaded file filter configuration');
    return filterConfig;
  } catch (error) {
    console.error('Error loading file filter config:', (error as Error).message);
    filterConfig = {
      exclude_paths: [],
      exclude_exts: [],
      exclude_files: [],
      size_rules: {
        hard_exclude_bytes: 2097152,
        soft_exclude_bytes: 307200,
        always_include_exts_even_if_large: [],
      },
    };
    return filterConfig;
  }
}

function getFileExtension(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return ext || '';
}

function matchesGlob(filePath: string, patterns: string[]): boolean {
  if (!patterns || patterns.length === 0) {
    return false;
  }

  return patterns.some((pattern) => minimatch(filePath, pattern));
}

function estimateFileSizeFromDiff(diffContent: string): number {
  const lines = diffContent.split('\n');
  let lineCount = 0;

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      lineCount++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      lineCount++;
    }
  }

  return lineCount * 50;
}

export function shouldIncludeFile(filePath: string, diffContent: string | null = null): boolean {
  const config = loadFilterConfig();
  const normalizedPath = filePath.replace(/\\/g, '/');

  if (config.exclude_paths && matchesGlob(normalizedPath, config.exclude_paths)) {
    return false;
  }

  const ext = getFileExtension(filePath);
  if (config.exclude_exts && config.exclude_exts.includes(ext)) {
    return false;
  }

  if (config.exclude_files && matchesGlob(normalizedPath, config.exclude_files)) {
    return false;
  }

  if (diffContent && config.size_rules) {
    const fileSize = estimateFileSizeFromDiff(diffContent);
    const hardLimit = config.size_rules.hard_exclude_bytes || 2097152;
    const softLimit = config.size_rules.soft_exclude_bytes || 307200;
    const alwaysIncludeExts = config.size_rules.always_include_exts_even_if_large || [];

    if (alwaysIncludeExts.includes(ext)) {
      return true;
    }

    if (fileSize > hardLimit) {
      return false;
    }

    if (fileSize > softLimit) {
      // Include but could log a warning here
    }
  }

  return true;
}
