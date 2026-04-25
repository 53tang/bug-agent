# Bug Agent (Minimal)

Single-file script that:

1. Fetches a Bitbucket PR diff
2. Detects parameter/functional changes
3. Fetches full file content once per file
4. Builds a change list and asks an LLM to find bugs

## Requirements

- Node.js >= 18
- pnpm

## Setup

```
pnpm install
```

Copy `.env.example` to `.env` and fill in values (or set the same keys in your shell).

- `BITBUCKET_EMAIL`, `BITBUCKET_API_TOKEN` (required for Bitbucket API)
- `MOON_SHOT_KEY` (required for Kimi / Moonshot analysis)
- Optional: `BITBUCKET_WORKSPACE` (default: smart_eco-platform)
- Optional: `PORT` (default: 3000 in code; use `.env` to override, e.g. 3002)
- Optional: `TAVILY_API_KEY` (web search in recheck step)
- Optional: `PR_FETCH_INTERVAL_MS` (default: 300000 = 5 minutes)
- Optional: `PR_AUTHOR_UUIDS` (comma-separated UUIDs; defaults to a built-in list)

## Run

```
pnpm start -- <bitbucket-pr-url>
```

Example:

```
pnpm start -- https://bitbucket.org/workspace/repo/pull-requests/123
```

## Scheduled PR Fetch

The server periodically fetches today's PRs (UTC day window) from the configured workspace every 5 minutes by default. It logs the total count each tick.
