# Bug Agent

Express service that analyzes Bitbucket PR diffs and posts a summary comment. It also runs a scheduler that fetches today's PRs from a workspace every 10 minutes (UTC day window) and logs the count.

## Requirements
- Node.js >= 18
- pnpm

## Env
- PORT (optional, default 3000)
- BITBUCKET_EMAIL
- BITBUCKET_API_TOKEN
- BITBUCKET_WORKSPACE (optional, default smart_eco-platform)
- PR_FETCH_INTERVAL_MS (optional, default 600000)
- PR_AUTHOR_UUIDS (optional, comma-separated UUIDs)
- GEMINI_KEY

## Run
pnpm start

Health check:
GET /health

Manual analysis:
POST /analyze
Body: { "prUrl": "https://bitbucket.org/<workspace>/<repo>/pull-requests/<id>" }
