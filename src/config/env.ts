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
