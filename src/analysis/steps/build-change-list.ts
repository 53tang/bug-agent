import { EXCERPT_CONTEXT_LINES, EXCERPT_MAX_CHARS, MAX_FULL_CONTENT_CHARS } from '../../config';
import { fetchFileContent } from '../../bitbucket';
import { hasParamOrFunctionalChange, hasMultipleHunks, buildContentExcerpt } from '../../diff';
import type { FileDiff } from '../../diff';

export interface ChangeListResult {
  promptChangeList: Record<string, unknown>[];
  changeListForSave: Record<string, unknown>[];
}

export async function buildChangeLists(
  includedFileDiffs: FileDiff[],
  repoFullName: string,
  commitHash: string,
  authHeader: string,
  skipFullContent: boolean,
): Promise<ChangeListResult> {
  const fetchedFiles = new Map<string, string | null>();
  const promptChangeList: Record<string, unknown>[] = [];
  const changeListForSave: Record<string, unknown>[] = [];

  for (const file of includedFileDiffs) {
    const hasFunctionalChange = hasParamOrFunctionalChange(file.diff);
    const hasMultipleHunks_ = hasMultipleHunks(file.diff);
    const shouldFetchContent = hasFunctionalChange || hasMultipleHunks_;

    if (!skipFullContent && shouldFetchContent && !fetchedFiles.has(file.filePath)) {
      const fullContent = await fetchFileContent(
        repoFullName,
        commitHash,
        file.filePath,
        authHeader,
      );
      fetchedFiles.set(file.filePath, fullContent);
      if (fullContent === null) {
        console.log(`[analyze] File content not found (404): ${file.filePath}`);
      } else {
        const reason = hasFunctionalChange ? 'functional change' : 'multiple hunks';
        console.log(
          `[analyze] Fetched content (${reason}): ${file.filePath} (${fullContent.length} chars)`,
        );
      }
    } else if (!shouldFetchContent) {
      console.log(`[analyze] Diff-only (no functional change or multiple hunks): ${file.filePath}`);
    }

    const promptEntry: Record<string, unknown> = {
      file: file.filePath,
      diff: file.diff,
      hasFunctionalChange,
      hasMultipleHunks: hasMultipleHunks_,
    };
    const saveEntry: Record<string, unknown> = {
      file: file.filePath,
      hasFunctionalChange,
      hasMultipleHunks: hasMultipleHunks_,
    };
    if (shouldFetchContent) {
      const fullContent = fetchedFiles.get(file.filePath);
      if (fullContent !== null && fullContent !== undefined) {
        const contentLength = fullContent.length;
        promptEntry.full_content_length = contentLength;
        saveEntry.full_content_length = contentLength;
        if (contentLength > MAX_FULL_CONTENT_CHARS) {
          const excerpt = buildContentExcerpt(
            fullContent,
            file.diff,
            EXCERPT_CONTEXT_LINES,
            EXCERPT_MAX_CHARS,
          );
          if (excerpt) {
            promptEntry.full_content_excerpt = excerpt;
            promptEntry.full_content_truncated = true;
            saveEntry.full_content = fullContent.slice(0, MAX_FULL_CONTENT_CHARS);
            saveEntry.full_content_truncated = true;
            console.log(
              `[analyze] Truncated content for ${file.filePath} (excerpt length ${excerpt.length} chars)`,
            );
          } else {
            const truncated = fullContent.slice(0, MAX_FULL_CONTENT_CHARS);
            promptEntry.full_content = truncated;
            promptEntry.full_content_truncated = true;
            saveEntry.full_content = truncated;
            saveEntry.full_content_truncated = true;
            console.log(
              `[analyze] Truncated content for ${file.filePath} (head ${MAX_FULL_CONTENT_CHARS} chars)`,
            );
          }
        } else {
          promptEntry.full_content = fullContent;
          saveEntry.full_content = fullContent;
        }
      }
    }
    promptChangeList.push(promptEntry);
    changeListForSave.push(saveEntry);
  }

  return { promptChangeList, changeListForSave };
}
