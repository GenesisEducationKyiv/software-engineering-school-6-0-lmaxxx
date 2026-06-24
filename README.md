# GitHub Release Notification API

Subscribe an email address to GitHub repository releases. When a new release is published, confirmed subscribers receive an email notification.

Three modules run in a **single Node.js process** (a modular monolith): an **API** (Express REST), a **Scanner** (periodic GitHub poller), and a **Notification** module (transactional email via SMTP). The Scanner and API don't send email directly — they publish **domain events** to a **RabbitMQ** topic exchange, and the Notification module consumes those events and sends the mail. This decouples the modules and keeps the email side asynchronous.

> **Live Preview:** [Frontend UI](https://github-notifier-production-f138.up.railway.app/)
>
> **⚠️ Current Status:** The frontend UI is deployed, but the backend logic is currently disabled. The project is built using a multi-container `docker-compose` architecture, and finding an affordable/free hosting platform that natively supports `docker-compose` (rather than a single `Dockerfile`) is an ongoing challenge.

---

## How It Works

### Subscription Flow

```
1. User fills in email + repo on the web UI (GET /)
   └─► POST /api/subscribe
         ├─ validate email format and "owner/repo" pattern
         ├─ check repo exists on GitHub API  (result cached in Redis)
         ├─ insert unconfirmed row into subscriptions table
         └─ publish `subscription.created` event
              └─► Notification module consumes it and sends the
                  confirmation email ──► link to GET /api/confirm/:token

2. User clicks the confirmation link
   └─► GET /api/confirm/:token
         └─ mark subscription confirmed in DB
              └─► release notifications now active
```

### Scanner Cycle

Runs on a `setInterval` (default every 5 minutes, controlled by `SCAN_INTERVAL_MS`).

```
setInterval fires
  └─ query repos WHERE confirmed subscriptions exist
       └─ for each repo:
            ├─ GET /repos/:owner/:repo/releases/latest  (Redis cached, default 10 min TTL)
            ├─ if tag_name ≠ last_seen_tag in DB:
            │    ├─ UPDATE repositories SET last_seen_tag = <new tag>
            │    └─ publish `release.published` { repo, tag } event
            └─ if GitHub returns 429 → break loop, retry on next interval
  └─ increment scans_total Prometheus counter

The Notification module consumes `release.published`, looks up the repo's
confirmed subscribers, and sends each a release notification email (with an
unsubscribe link).
```

### Messaging

```
exchange: domain.events   (topic, durable)
   ├─ subscription.created ─┐
   └─ release.published ────┴─► queue: notification  ─► Notification module
```

Publishers (API, Scanner) and the consumer (Notification module) talk only
through the broker. Messages are acked after the email is sent; a failed handler
nacks + requeues (at-least-once delivery).

### Startup Sequence

`src/index.ts` runs these steps in order before accepting traffic:

```
1. Run DB migrations (node-pg-migrate, auto-applied on every start)
2. Connect to RabbitMQ and start the Notification module consumer
3. Start HTTP server on PORT
4. Start scanner setInterval
5. Start gRPC server on GRPC_PORT
6. Register SIGTERM / SIGINT handlers for graceful shutdown
```

---

## Quick Start (Docker)

```bash
cp .env.example .env
# Optionally set GITHUB_TOKEN in .env to raise rate limit to 5000 req/hr
docker-compose up
```

| URL | What's there |
|-----|-------------|
| http://localhost:3000 | Web UI and REST API |
| http://localhost:8025 | Mailhog — inspect emails sent during development |
| http://localhost:8080 | Swagger UI — interactive API docs |
| http://localhost:15672 | RabbitMQ management UI (guest / guest) |

All services start automatically. PostgreSQL migrations run on app startup before the server accepts connections.

---

## Local Development Setup

**Prerequisites:** Node.js 20+, PostgreSQL, RabbitMQ, (optional) Redis

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — set DATABASE_URL, SMTP_HOST, SMTP_PORT, BASE_URL at minimum

# 3. Run database migrations
npm run migrate up

# 4. Start with hot reload
npm run dev
```

---

## Project Structure

```
src/
├── index.ts              # Entry: migrations → server → scanner → gRPC
├── app.ts                # Express app, routes, middleware
├── config.ts             # Env var loading and validation
├── types.ts              # Shared TypeScript interfaces
├── metrics.ts            # Prometheus counters and histograms
├── routes/               # One file per endpoint
├── services/
│   ├── github.ts         # GitHub API client (with Redis caching)
│   ├── subscription.ts   # Subscription business logic
│   └── email.ts          # Nodemailer wrapper
├── scanner/index.ts      # Periodic release checker (setInterval)
├── cache/
│   └── redis.ts          # Optional Redis client
├── grpc/
│   └── server.ts         # gRPC server
├── db/
│   ├── pool.ts           # pg Pool instance
│   ├── subscriptions.ts  # Subscription SQL queries
│   └── repositories.ts   # Repository SQL queries
├── middleware/
│   ├── errorHandler.ts   # Global error handler
│   └── metricsMiddleware.ts
└── public/index.html     # Frontend subscribe form

migrations/               # node-pg-migrate files (.cjs)
proto/                    # gRPC service definitions
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

**Redis is optional** — The app starts and runs without a Redis connection. GitHub API responses are fetched fresh on every scan cycle if caching is unavailable.
