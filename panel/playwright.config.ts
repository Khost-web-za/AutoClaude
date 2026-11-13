import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end smoke against the e2e stack (docker-compose.e2e.yml at the repo root), which must already
 * be up: `docker compose -f docker-compose.e2e.yml up -d --build --wait`. Nothing is started here.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 5 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  outputDir: 'test-results/e2e',
  use: {
    baseURL: process.env.E2E_PANEL_URL ?? 'http://127.0.0.1:3310',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
