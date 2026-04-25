# Bun runtime. Build: docker build -t bug-agent .  Run: docker run -p 3000:3000 --env-file .env bug-agent
# Do not COPY .env; pass secrets at runtime.
FROM oven/bun:1 AS base
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY bug-agent.ts prScheduler.ts fileFilter.ts ./
COPY file-filter.yaml ./
COPY src ./src
COPY prompts ./prompts

RUN mkdir -p pr-analysis
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["bun", "run", "bug-agent.ts"]
