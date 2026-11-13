# syntax=docker/dockerfile:1.7
# Panel image: Next.js standalone server + bundled migration entry + the repo's config profiles.
# Build context: repo root (it copies configs/)   →   docker build -f panel/Dockerfile .
# Ignore rules: panel/Dockerfile.dockerignore.
FROM node:24-bookworm-slim AS build
RUN npm install -g pnpm@10.32.1
WORKDIR /repo/panel
COPY panel/package.json panel/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
# Explicit paths, never `panel/`: a panel/.env* or local build output must not reach the build stage even
# where Dockerfile.dockerignore is not honoured (legacy builder).
COPY panel/next.config.ts panel/tsconfig.json panel/postcss.config.mjs panel/next-env.d.ts ./
COPY panel/src ./src
ENV NEXT_TELEMETRY_DISABLED=1
# dist/migrate.js: src/db/migrate-cli.ts bundled with its dependencies (resolves the @/ alias), so it
# runs from the standalone output without the source tree or dev dependencies.
RUN pnpm build && pnpm build:migrate

FROM node:24-bookworm-slim AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# outputFileTracingRoot is the repo root, so the standalone tree is /app/panel/server.js.
WORKDIR /app/panel
COPY --from=build --chown=node:node /repo/panel/.next/standalone /app
COPY --from=build --chown=node:node /repo/panel/.next/static ./.next/static
COPY --from=build --chown=node:node /repo/panel/dist ./dist
COPY --chown=node:node panel/migrations ./migrations
COPY --chown=node:node configs /app/configs
# The claude-auth volume is created from this directory, so it starts owned by 1000:1000: `node` here is
# uid/gid 1000, the same as the runner's `claude` user, so session containers can read the 0600
# credentials file the panel writes.
RUN mkdir -p /claude-auth && chown node:node /claude-auth
USER node
# 3000: the panel (published by Coolify). 3100: internal runner API (never published).
EXPOSE 3000 3100
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
# Migrations first; a failed migration stops the container before the server ever serves.
CMD ["sh", "-c", "node dist/migrate.js && exec node server.js"]
