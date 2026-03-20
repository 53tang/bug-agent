import fs from 'node:fs';
import { PROMPT_PATH } from '../config';
import type { PromptMeta } from './types';

export function loadPromptTemplate(): string {
  return fs.readFileSync(PROMPT_PATH, 'utf8');
}

export function buildPrompt(
  prompt: string,
  changeList: Record<string, unknown>[],
  meta: PromptMeta = {},
): string {
  const { prTitle = '', repoFullName = '', prId = '' } = meta;
  const template = loadPromptTemplate();
  return template
    .replace('{{PROMPT}}', prompt)
    .replace('{{PR_TITLE}}', prTitle)
    .replace('{{REPO}}', repoFullName)
    .replace('{{PR_ID}}', String(prId))
    .replace('{{CHANGE_LIST}}', JSON.stringify(changeList, null, 2));
}
