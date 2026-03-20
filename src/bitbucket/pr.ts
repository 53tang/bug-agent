import { getAuthHeader } from '../config';
import { fetchAllPages } from './api';

export function parsePrUrl(prUrl: string): { repoFullName: string; prId: number } {
  const url = new URL(prUrl);
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 4 || parts[2] !== 'pull-requests') {
    throw new Error(
      'Invalid PR URL format. Expected: https://bitbucket.org/workspace/repo/pull-requests/123',
    );
  }
  const workspace = parts[0];
  const repo = parts[1];
  const prId = Number(parts[3]);
  if (!Number.isFinite(prId)) {
    throw new Error('Invalid PR ID in URL');
  }
  return { repoFullName: `${workspace}/${repo}`, prId };
}

export async function postPRComment(
  repoFullName: string,
  prId: number,
  comment: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const apiUrl = `https://api.bitbucket.org/2.0/repositories/${repoFullName}/pullrequests/${prId}/comments`;
  const authHeader = getAuthHeader();

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      content: {
        raw: comment,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Failed to post comment: ${res.status} ${res.statusText} - ${body}`);
  }

  const data = await res.json();
  console.log(`Successfully posted comment (ID: ${data.id})`);
  return data;
}

export async function searchPullRequestsByTitle(
  repoFullName: string,
  title: string,
  authHeader: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  const trimmed = String(title || '').trim();
  if (!trimmed) return [];
  const escaped = trimmed.replace(/"/g, '\\"');
  const query = `title ~ "${escaped}"`;
  const url = `https://api.bitbucket.org/2.0/repositories/${repoFullName}/pullrequests?pagelen=50&q=${encodeURIComponent(
    query,
  )}`;
  return fetchAllPages(url, authHeader);
}
