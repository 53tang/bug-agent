import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const PROMPT_PATH = path.join(__dirname, '..', 'prompt.txt');
export const MAX_FULL_CONTENT_CHARS = 4000;
export const EXCERPT_CONTEXT_LINES = 25;
export const EXCERPT_MAX_CHARS = 6000;
export const MAX_FILES_FOR_FULL_CONTENT = 25;
export const MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1';
export const MOONSHOT_MODEL = 'kimi-k2.5';
export const MOONSHOT_TEMPERATURE = 1; // only 1 is allowed for kimi-k2.5
export const COMMENT_AUTHOR_UUID = '{5e1bd749-f9a6-49a1-a580-afadbe72fc5b}';

const IGNORED_REPOS = new Set(['smart_eco-platform/api-integration-aws']);
const INPUT_RATE_LIMIT_FILE_THRESHOLD = 30;

export function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} must be set`);
  }
  return value;
}

export function getAuthHeader(): string {
  const email = getEnv('BITBUCKET_EMAIL');
  const token = getEnv('BITBUCKET_API_TOKEN');
  const creds = Buffer.from(`${email}:${token}`).toString('base64');
  return `Basic ${creds}`;
}

export function isIgnoredRepo(repoFullName: string): boolean {
  return IGNORED_REPOS.has(String(repoFullName || '').trim());
}

export function shouldSkipInputRateLimit(includedFileCount: number): boolean {
  return includedFileCount > INPUT_RATE_LIMIT_FILE_THRESHOLD;
}
