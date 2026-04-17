import { tool } from 'ai';
import { z } from 'zod';

export interface FetchFileContext {
  repoFullName: string;
  commitHash: string;
  authHeader: string;
}

/**
 * Creates a fetch_file tool that retrieves the **entire** raw file content
 * from Bitbucket at a specific commit. This is a standalone fetch — it does
 * NOT reuse fetchFileContent or any build-change-list helpers — to guarantee
 * zero truncation or excerpting.
 */
export function createFetchFileTool(ctx: FetchFileContext) {
  return tool({
    description:
      'Fetch the complete source file from the repository at the PR commit. ' +
      'Use this when you need to see the full file to verify a bug — especially ' +
      'when the initial analysis only had truncated or excerpted content.',
    inputSchema: z.object({
      filePath: z
        .string()
        .describe('Repository-relative file path, e.g. "src/utils/api.ts"'),
    }),
    execute: async ({ filePath }: { filePath: string }) => {
      const encodedPath = filePath
        .split('/')
        .filter(Boolean)
        .map(encodeURIComponent)
        .join('/');
      const url = `https://api.bitbucket.org/2.0/repositories/${ctx.repoFullName}/src/${ctx.commitHash}/${encodedPath}`;

      const res = await fetch(url, {
        headers: {
          Authorization: ctx.authHeader,
          Accept: 'text/plain',
        },
      });

      if (!res.ok) {
        if (res.status === 404) {
          return `File not found: ${filePath}`;
        }
        return `Failed to fetch file (${res.status}): ${filePath}`;
      }

      const content = await res.text();
      console.log(`[recheck:fetch_file] ${filePath} (${content.length} chars)`);
      return content;
    },
  });
}
