import {
  DEFAULT_BITBUCKET_WORKSPACE,
  DEFAULT_PR_AUTHOR_UUIDS,
  PR_FETCH_IGNORED_REPOS,
} from '../config/constants';
import { buildTodayUtcRange } from './analysis-state';
import type { PrData, FetchJsonFn } from './types';

export function resolveWorkspace(rawWorkspace: string | undefined): string {
  if (rawWorkspace && String(rawWorkspace).trim()) {
    return String(rawWorkspace).trim();
  }
  return DEFAULT_BITBUCKET_WORKSPACE;
}

function normalizeUuid(raw: string): string {
  const cleaned = String(raw).trim().replace(/^"|"$/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
    return cleaned;
  }
  return `{${cleaned}}`;
}

export function resolveAuthorUuids(rawAuthorUuids: string | undefined): string[] {
  if (rawAuthorUuids && String(rawAuthorUuids).trim()) {
    const list = String(rawAuthorUuids)
      .split(',')
      .map((item) => normalizeUuid(item))
      .filter(Boolean);
    if (list.length > 0) {
      return list;
    }
  }
  return [...DEFAULT_PR_AUTHOR_UUIDS];
}

export function isIgnoredRepo(repoFullName: string): boolean {
  return PR_FETCH_IGNORED_REPOS.has(String(repoFullName || '').trim());
}

async function fetchAllPages(
  url: string,
  authHeader: string,
  fetchJson: FetchJsonFn,
): Promise<Record<string, unknown>[]> {
  const values: Record<string, unknown>[] = [];
  let next: string | null = url;
  while (next) {
    const data = await fetchJson(next, authHeader);
    if (Array.isArray(data.values)) {
      values.push(...data.values);
    }
    next = (data.next as string) || null;
  }
  return values;
}

export async function fetchTodaysPullRequests({
  getAuthHeader,
  fetchJson,
  workspace,
  authorUuids,
  latestTimestamp,
}: {
  getAuthHeader: () => string;
  fetchJson: FetchJsonFn;
  workspace: string | undefined;
  authorUuids?: string;
  latestTimestamp: string | null;
}): Promise<{
  prs: PrData[];
  workspace: string;
  startIso: string;
  endIso: string;
}> {
  const authHeader = getAuthHeader();
  const resolvedWorkspace = resolveWorkspace(workspace);
  const { startIso, endIso } = buildTodayUtcRange();
  const resolvedAuthorUuids = resolveAuthorUuids(authorUuids);

  let query = `created_on >= "${startIso}" AND created_on < "${endIso}"`;
  if (latestTimestamp) {
    query += ` AND created_on > "${latestTimestamp}"`;
  }

  const fetchPromises = resolvedAuthorUuids.map(async (uuid) => {
    const url = `https://api.bitbucket.org/2.0/workspaces/${resolvedWorkspace}/pullrequests/${uuid}?pagelen=50&q=${encodeURIComponent(query)}`;
    return fetchAllPages(url, authHeader, fetchJson);
  });

  const results = await Promise.allSettled(fetchPromises);

  const prs: PrData[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      prs.push(...(result.value as unknown as PrData[]));
    }
  }

  const filteredPrs = latestTimestamp
    ? prs.filter((pr) => new Date(pr.created_on!) > new Date(latestTimestamp))
    : prs;

  return { prs: filteredPrs, workspace: resolvedWorkspace, startIso, endIso };
}

export async function fetchUpdatedPullRequests({
  getAuthHeader,
  fetchJson,
  workspace,
  authorUuids,
  lastUpdateTimestamp,
}: {
  getAuthHeader: () => string;
  fetchJson: FetchJsonFn;
  workspace: string | undefined;
  authorUuids?: string;
  lastUpdateTimestamp: string | null;
}): Promise<{ prs: PrData[]; workspace: string }> {
  if (!lastUpdateTimestamp) {
    return { prs: [], workspace: resolveWorkspace(workspace) };
  }

  const authHeader = getAuthHeader();
  const resolvedWorkspace = resolveWorkspace(workspace);
  const resolvedAuthorUuids = resolveAuthorUuids(authorUuids);

  const query = `state = "OPEN" AND updated_on > "${lastUpdateTimestamp}"`;

  const fetchPromises = resolvedAuthorUuids.map(async (uuid) => {
    const url = `https://api.bitbucket.org/2.0/workspaces/${resolvedWorkspace}/pullrequests/${uuid}?pagelen=50&q=${encodeURIComponent(query)}`;
    return fetchAllPages(url, authHeader, fetchJson);
  });

  const results = await Promise.allSettled(fetchPromises);

  const prs: PrData[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled' && Array.isArray(result.value)) {
      prs.push(...(result.value as unknown as PrData[]));
    }
  }

  const filteredPrs = prs.filter((pr) => new Date(pr.updated_on!) > new Date(lastUpdateTimestamp));

  return { prs: filteredPrs, workspace: resolvedWorkspace };
}
