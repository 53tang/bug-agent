import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Loaded by moonshot/prompt-builder.ts for LLM code-review requests (placeholders: {{PROMPT}}, {{PR_TITLE}}, etc.). */
export const PROMPT_PATH = path.join(__dirname, '..', '..', 'prompts', 'code-review-system.txt');

export const MAX_FULL_CONTENT_CHARS = 4000;
export const EXCERPT_CONTEXT_LINES = 25;
export const EXCERPT_MAX_CHARS = 6000;
export const MAX_FILES_FOR_FULL_CONTENT = 25;
export const MOONSHOT_BASE_URL = 'https://api.moonshot.cn/v1';
export const MOONSHOT_MODEL = 'kimi-k2.5';
export const MOONSHOT_TEMPERATURE = 1; // only 1 is allowed for kimi-k2.5
export const COMMENT_AUTHOR_UUID = '{5e1bd749-f9a6-49a1-a580-afadbe72fc5b}';
