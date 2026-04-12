# GitHub Release Notification API

A monolithic Node.js service that lets users subscribe to email notifications when a GitHub repository publishes a new release. Three components run in a single process: an **API** (REST endpoints), a **Scanner** (periodic GitHub poller), and a **Notifier** (email sender via SMTP).

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  Single Process                  │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │   API    │  │ Scanner  │  │   Notifier    │  │
│  │ (Express)│  │(setInterval)│  │ (Nodemailer) │  │
│  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
│       │              │                │           │
└───────┼──────────────┼────────────────┼───────────┘
        │              │                │
        ▼              ▼                ▼
   PostgreSQL      GitHub API        SMTP Server
```

- **API** handles subscription lifecycle (subscribe, confirm, unsubscribe, list).
- **Scanner** runs every 5 minutes (configurable), fetches the latest release for each subscribed repo, and triggers notifications when a new tag is detected.
- **Notifier** sends transactional emails: confirmation links and release alerts.

---

## Quick Start (Docker)

```bash
cp .env.example .env
# Edit .env if needed (defaults work with docker-compose)

docker-compose up
```

The API is available at `http://localhost:3000`.  
Mailhog (local email UI) is at `http://localhost:8025`.

---

## Manual Setup

**Prerequisites:** Node.js 20+, PostgreSQL

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env with your database and SMTP credentials

# Run database migrations
DATABASE_URL=<your-url> npm run migrate up

# Start development server
npm run dev
```

---

## Environment Variables

See `.env.example` for all variables with descriptions.

| Variable | Required | Default | Description |
|---|---|---|---|
| `PORT` | No | `3000` | HTTP server port |
| `DATABASE_URL` | Yes | — | PostgreSQL connection URL |
| `GITHUB_TOKEN` | No | — | GitHub PAT (raises rate limit to 5000 req/hr) |
| `SMTP_HOST` | Yes | — | SMTP server hostname |
| `SMTP_PORT` | Yes | — | SMTP server port |
| `SMTP_USER` | Yes | — | SMTP username |
| `SMTP_PASS` | Yes | — | SMTP password |
| `SCAN_INTERVAL_MS` | No | `300000` | Scanner interval in milliseconds (5 min) |
| `BASE_URL` | Yes | — | Public base URL for email links |

---

## API Endpoints

Full spec: [`swagger.yaml`](./swagger.yaml)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/subscribe` | Subscribe an email to a repo's releases |
| `GET` | `/api/confirm/:token` | Confirm a subscription via email link |
| `GET` | `/api/unsubscribe/:token` | Unsubscribe via token in notification emails |
| `GET` | `/api/subscriptions?email=` | List confirmed subscriptions for an email |

### Example

```bash
# Subscribe
curl -X POST http://localhost:3000/api/subscribe \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","repo":"golang/go"}'

# List subscriptions
curl 'http://localhost:3000/api/subscriptions?email=you@example.com'
```

---

## Running Tests

```bash
# Run all unit tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

Tests use [Vitest](https://vitest.dev/) with all external dependencies mocked (`vi.mock()`). There are three test suites: subscription service, GitHub service, and scanner logic.

---

## Project Structure

```
src/
├── index.ts              # Entry: migrations → server → scanner
├── app.ts                # Express app, routes, middleware
├── config.ts             # Env var loading
├── types.ts              # Shared TypeScript interfaces
├── routes/               # Route handlers (one file per endpoint)
├── services/
│   ├── github.ts         # GitHub API client
│   ├── subscription.ts   # Subscription business logic
│   └── email.ts          # Nodemailer wrapper
├── scanner/index.ts      # Periodic release checker
├── db/
│   ├── pool.ts           # pg Pool instance
│   ├── subscriptions.ts  # Subscription SQL queries
│   └── repositories.ts   # Repository SQL queries
└── middleware/
    └── errorHandler.ts   # Global error handler

migrations/               # node-pg-migrate files (.cjs)
tests/unit/               # Vitest unit tests
```

---

## Design Decisions

**TypeScript with ES Modules** — `"type": "module"` throughout. All imports use `.js` extensions (TypeScript resolves them to `.ts` at compile time). Enables native ESM in Node.js without transform hacks.

**Raw SQL via `pg`** — No ORM. Queries are explicit and readable; the schema is simple enough that an ORM adds more indirection than value.

**Single-process architecture** — API, Scanner, and Notifier share one process and one database connection pool. Straightforward to deploy and reason about at this scale. The scanner uses `setInterval` rather than a separate worker.

**`node-pg-migrate` for migrations** — Runs automatically on startup before the server accepts connections. Migration files are `.cjs` (CommonJS) because `node-pg-migrate` loads them with `require()` — the rest of the project is ESM.

**Vitest over Jest** — Native ESM support with no configuration hacks. Same `describe/it/expect` API, faster execution.

**GitHub 429 handling** — On subscribe: returned to the client as a 429. During scanning: the scanner breaks out of the current cycle and retries on the next interval to avoid hammering the API.
