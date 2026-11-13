import { existsSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { defineConfig } from 'vitest/config';

const envFile = path.join(import.meta.dirname, '..', '.env.local');
if (existsSync(envFile)) loadEnvFile(envFile);

export default defineConfig({
  resolve: { alias: { '@': path.join(import.meta.dirname, 'src') } },
  test: {
    include: ['test/**/*.integration.test.ts'],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
