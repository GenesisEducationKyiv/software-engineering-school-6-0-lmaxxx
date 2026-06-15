import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/specs',
  globalTeardown: './tests/e2e/teardown.ts',
  timeout: 30_000,
  use: {
    baseURL: process.env['BASE_URL'] ?? 'http://localhost:3000',
    headless: true,
  },
  retries: process.env['CI'] ? 2 : 0,
  reporter: [['html', { open: 'never' }]],
});
