import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import type { NextConfig } from 'next';

const repoRoot = path.join(import.meta.dirname, '..');
const envFile = path.join(repoRoot, '.env.local');
// Local dev reads the repo-root .env.local. Variables already set (Docker, CI) are never overridden.
if (existsSync(envFile)) loadEnvFile(envFile);

const config: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingRoot: repoRoot,
  // Profiles are read from CONFIGS_DIR at runtime; the tracer otherwise pulls in test fixtures and docs.
  outputFileTracingExcludes: { '*': ['./test/**', './CLAUDE.md', './AGENTS.md'] },
  // requireOwner() calls forbidden() to render a 403.
  experimental: { authInterrupts: true },
  // No folder in this repository may be named `secrets` (ruling R12), so the Secrets tab's page lives
  // in `repo-secrets/` and keeps its public URL through this rewrite. proxy.ts runs before rewrites.
  rewrites: async () => [{ source: '/repos/:owner/:name/secrets', destination: '/repos/:owner/:name/repo-secrets' }],
};

export default config;
