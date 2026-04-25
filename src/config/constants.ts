import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Loaded by moonshot/prompt-builder.ts for LLM code-review requests (placeholders: {{PROMPT}}, {{PR_TITLE}}, etc.). */
export const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'code-review-system.txt');

export const MAX_FULL_CONTENT_CHARS = 4000;
export const EXCERPT_CONTEXT_LINES = 25;
export const EXCERPT_MAX_CHARS = 6000;
export const MAX_FILES_FOR_FULL_CONTENT = 25;
export const MOONSHOT_MODEL = 'kimi-k2.6';
export const MOONSHOT_TEMPERATURE = 1; // only 1 is allowed for Kimi K2.x
export const COMMENT_AUTHOR_UUID = '{5e1bd749-f9a6-49a1-a580-afadbe72fc5b}';

/** Recheck step: prompt template for verifying bugs with tools. */
export const RECHECK_PROMPT_PATH = path.join(
  __dirname,
  '..',
  '..',
  'prompts',
  'recheck-system.txt',
);

/** Max tool-call rounds the recheck agent is allowed. */
export const RECHECK_MAX_STEPS = 8;

/** When `PORT` is unset. */
export const DEFAULT_HTTP_PORT = 3000;

/**
 * When `PR_FETCH_INTERVAL_MS` is empty or invalid.
 * (Same as 5 * 60 * 1000 — 5 minutes.)
 */
export const PR_FETCH_DEFAULT_INTERVAL_MS = 5 * 60 * 1000;

/** When `BITBUCKET_WORKSPACE` is unset. */
export const DEFAULT_BITBUCKET_WORKSPACE = 'smart_eco-platform';

/** When `PR_AUTHOR_UUIDS` is unset (Bitbucket user UUIDs). */
export const DEFAULT_PR_AUTHOR_UUIDS: readonly string[] = [
  '{aff0f074-2041-4f5b-adde-ff8031c030bc}',
  '{151633df-1e30-482a-a61b-eb6fe589abe1}',
  '{17791846-d1f1-47f7-ac76-55f6101d4f82}',
  '{3c865dd0-c5bf-46a0-836c-ce32fb773b70}',
  '{5e1bd749-f9a6-49a1-a580-afadbe72fc5b}',
  '{32c4ef6f-3c67-431b-8fa6-0a4b1c4a77a9}',
  '{8ad2417d-9d07-4e7d-830b-b88fef044fb7}',
];

/** PR list fetch: repos to treat as ignored (e.g. placeholders). */
export const PR_FETCH_IGNORED_REPOS = new Set<string>(['test-user/test-repo']);
