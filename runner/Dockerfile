# Session runner image: one container per Claude Code session.
# Build context: runner/   →   docker build -t claudecloud-runner runner
FROM node:24-bookworm-slim AS node

FROM debian:bookworm-slim

ARG CLAUDE_CODE_VERSION=2.1.322

ENV LANG=C.UTF-8 \
    GIT_TERMINAL_PROMPT=0 \
    DEBIAN_FRONTEND=noninteractive

# Node 24 from the official image (no curl | bash installers).
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
 && corepack enable pnpm

# Base tools + Docker CE (used only under Sysbox) + GitHub CLI.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg git tmux gosu jq tini procps \
      python3 python3-venv build-essential \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
 && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg -o /etc/apt/keyrings/githubcli.gpg \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli.gpg] https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce docker-ce-cli containerd.io docker-compose-plugin gh \
 && rm -rf /var/lib/apt/lists/*

RUN npm i -g @anthropic-ai/claude-code@${CLAUDE_CODE_VERSION} && npm cache clean --force

RUN groupadd -g 1000 claude \
 && useradd -m -u 1000 -g 1000 -G docker -s /bin/bash claude \
 && mkdir -p /workspace /opt/session-config /claude-auth \
 && chown claude:claude /workspace /claude-auth

COPY --chown=root:root . /opt/runner
RUN chmod 0755 /opt/runner/*.sh /opt/runner/test/stub-claude.sh \
 && ln -s /opt/runner/gh-wrapper.sh /usr/local/bin/gh

# Inner Docker data must not sit on the container's overlay rootfs. The panel mounts
# the session volume here so inner images/containers are deleted with the session.
VOLUME /var/lib/docker

WORKDIR /workspace

# Test builds only (docker-compose.e2e.yml): bake in a stand-in for the claude CLI, e.g.
# /opt/runner/test/stub-claude.sh. Empty (the default) means the real `claude`.
ARG CLAUDE_BIN=
ENV CLAUDE_BIN=${CLAUDE_BIN}

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/runner/entrypoint.sh"]
