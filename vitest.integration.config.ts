import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['tests/integration/setup/globalSetup.ts'],
    testTimeout: 30_000,
    env: {
      DATABASE_URL: 'postgres://testuser:testpass@localhost:5433/github_notifier_test',
      GITHUB_API_BASE_URL: 'http://localhost:4001',
      REDIS_URL: '',
      NODE_ENV: 'test',
      BASE_URL: 'http://localhost:3000',
      SMTP_HOST: 'localhost',
      SMTP_PORT: '1025',
      SMTP_FROM: 'noreply@test.local',
      GITHUB_TOKEN: '',
    },
  },
});
