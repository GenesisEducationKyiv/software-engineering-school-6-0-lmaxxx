import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/api-unit/**/*.test.ts'],
    env: {
      DATABASE_URL: 'postgres://test:test@localhost:5432/test_db',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/config.ts'],
    },
  },
});
