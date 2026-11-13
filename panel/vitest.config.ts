import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: { '@': path.join(import.meta.dirname, 'src') } },
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: ['test/**/*.integration.test.{ts,tsx}', 'node_modules/**'],
  },
});
