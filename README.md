# Bug Agent (Minimal)

Single-file script that:
1) Fetches a Bitbucket PR diff
2) Detects parameter/functional changes
3) Fetches full file content once per file
4) Builds a change list and asks an LLM to find bugs

## Requirements
- Node.js >= 18
- pnpm

## Setup

```
pnpm install
```

Set env vars in `.envrc` (or export in your shell):

- BITBUCKET_EMAIL
- BITBUCKET_API_TOKEN
- Optional: BITBUCKET_WORKSPACE (default: smart_eco-platform)
- Optional: PR_FETCH_INTERVAL_MS (default: 600000 = 10 minutes)
- Optional: PR_AUTHOR_UUIDS (comma-separated UUIDs; defaults to built-in list)
- LLM_API_URL
- Optional: LLM_API_KEY, LLM_MODEL

## Run

```
pnpm start -- <bitbucket-pr-url>
```

Example:

```
pnpm start -- https://bitbucket.org/workspace/repo/pull-requests/123
```

## Scheduled PR Fetch

The server periodically fetches today's PRs (UTC day window) from the configured workspace every 10 minutes by default. It logs the total count each tick.
