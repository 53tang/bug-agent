"use strict";

const { URL } = require("url");
const { getAuthHeader } = require("./config");

function parsePrUrl(prUrl) {
  const url = new URL(prUrl);
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 4 || parts[2] !== "pull-requests") {
    throw new Error(
      "Invalid PR URL format. Expected: https://bitbucket.org/workspace/repo/pull-requests/123"
    );
  }
  const workspace = parts[0];
  const repo = parts[1];
  const prId = Number(parts[3]);
  if (!Number.isFinite(prId)) {
    throw new Error("Invalid PR ID in URL");
  }
  return { repoFullName: `${workspace}/${repo}`, prId };
}

async function fetchJson(url, authHeader) {
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Request failed: ${res.status} ${res.statusText} - ${body}`
    );
  }
  return res.json();
}

async function fetchText(url, authHeader, options = {}) {
  const { allow404 = false } = options;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      Accept: "text/plain",
    },
  });
  if (!res.ok) {
    const body = await res.text();
    if (allow404 && res.status === 404) {
      return null;
    }
    throw new Error(
      `Request failed: ${res.status} ${res.statusText} - ${body}`
    );
  }
  return res.text();
}

async function fetchFileContent(
  repoFullName,
  commitHash,
  filePath,
  authHeader
) {
  const apiUrl = `https://api.bitbucket.org/2.0/repositories/${repoFullName}/src/${commitHash}/${filePath}`;
  return fetchText(apiUrl, authHeader, { allow404: true });
}

async function postPRComment(repoFullName, prId, comment) {
  const apiUrl = `https://api.bitbucket.org/2.0/repositories/${repoFullName}/pullrequests/${prId}/comments`;
  const authHeader = getAuthHeader();

  const res = await fetch(apiUrl, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      content: {
        raw: comment,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Failed to post comment: ${res.status} ${res.statusText} - ${body}`
    );
  }

  const data = await res.json();
  console.log(`Successfully posted comment (ID: ${data.id})`);
  return data;
}

async function fetchAllPages(url, authHeader) {
  const values = [];
  let next = url;
  while (next) {
    const data = await fetchJson(next, authHeader);
    if (Array.isArray(data.values)) {
      values.push(...data.values);
    }
    next = data.next || null;
  }
  return values;
}

async function searchPullRequestsByTitle(repoFullName, title, authHeader) {
  const trimmed = String(title || "").trim();
  if (!trimmed) return [];
  const escaped = trimmed.replace(/"/g, '\\"');
  const query = `title ~ "${escaped}"`;
  const url = `https://api.bitbucket.org/2.0/repositories/${repoFullName}/pullrequests?pagelen=50&q=${encodeURIComponent(
    query
  )}`;
  return fetchAllPages(url, authHeader);
}

module.exports = {
  parsePrUrl,
  fetchJson,
  fetchText,
  fetchFileContent,
  postPRComment,
  searchPullRequestsByTitle,
};
