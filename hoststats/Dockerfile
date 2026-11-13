# Host stats sidecar: GET /stats on :9100 (read-only host /proc and docker data dir).
# Build context: hoststats/   →   docker build -t claudecloud-hoststats hoststats
FROM node:24-bookworm-slim

ENV NODE_ENV=production \
    PORT=9100

WORKDIR /app
COPY package.json server.mjs stats.mjs ./

USER node
# Internal only: the stack never publishes 9100.
EXPOSE 9100
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:9100/stats').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "server.mjs"]
