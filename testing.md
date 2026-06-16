# Testing

## Prerequisites

- Node.js 20+
- Docker (for integration and E2E tests)

## Unit tests

No Docker required. Runs instantly.

```sh
npm run test:unit
```

## Integration tests

Requires Docker. Starts a real PostgreSQL instance on port 5433.

```sh
npm run db:up
npm run test:integration
npm run db:down   # optional cleanup
```

## E2E tests (Playwright)

Requires Docker. Starts the full app stack (postgres, mail server, GitHub API mock).

```sh
npx playwright install chromium   # first time only
npm run e2e:up
npm run test:e2e
npm run e2e:down   # optional cleanup
```

## All tests

```sh
npm run db:up && npm run e2e:up && npm run test:all
```
