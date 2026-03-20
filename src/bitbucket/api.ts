// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function fetchJson(url: string, authHeader: string): Promise<any> {
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Request failed: ${res.status} ${res.statusText} - ${body}`);
  }
  return res.json();
}

export async function fetchText(
  url: string,
  authHeader: string,
  options?: { allow404?: boolean },
): Promise<string | null> {
  const { allow404 = false } = options ?? {};
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: 'text/plain',
    },
  });
  if (!res.ok) {
    const body = await res.text();
    if (allow404 && res.status === 404) {
      return null;
    }
    throw new Error(`Request failed: ${res.status} ${res.statusText} - ${body}`);
  }
  return res.text();
}

export async function fetchFileContent(
  repoFullName: string,
  commitHash: string,
  filePath: string,
  authHeader: string,
): Promise<string | null> {
  const apiUrl = `https://api.bitbucket.org/2.0/repositories/${repoFullName}/src/${commitHash}/${filePath}`;
  return fetchText(apiUrl, authHeader, { allow404: true });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPages(url: string, authHeader: string): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: any[] = [];
  let next: string | null = url;
  while (next) {
    const data = await fetchJson(next, authHeader);
    if (Array.isArray(data.values)) {
      values.push(...data.values);
    }
    next = data.next || null;
  }
  return values;
}

export { fetchAllPages };
