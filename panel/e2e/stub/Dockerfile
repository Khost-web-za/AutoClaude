# e2e only: Access JWKS + GitHub API stub + dumb-HTTP git server (see e2e-stub.mjs).
# Build context: panel/e2e/stub/
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY e2e-stub.mjs ./
EXPOSE 8080
HEALTHCHECK --interval=2s --timeout=3s --retries=15 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "e2e-stub.mjs"]
