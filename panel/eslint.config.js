import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/coverage/**',
    '**/migrations/**',
    '**/next-env.d.ts',
    '**/test-results/**',
    '**/playwright-report/**',
    'dist/**',
  ]),
  ...nextVitals,
  ...nextTypescript,
  // eslint-plugin-react's automatic version detection crashes on ESLint 10, so pin it.
  { settings: { react: { version: '19.3' }, next: { rootDir: '.' } } },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
]);
