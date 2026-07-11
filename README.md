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
confirmed subscribers, and fans out one `notification.send` message per
subscriber. Each is consumed separately and sends a single release notification
email (with an unsubscribe link).
```

### Messaging

```
exchange: domain.events   (topic, durable)
   ├─ subscription.created ─┐
   ├─ release.published ────┼─► queue: notification  ─► Notification module
   └─ notification.send ────┘
```

Publishers (API, Scanner) and the consumer (Notification module) talk only
through the broker. Messages are acked after the work succeeds; a failed handler
nacks + requeues (at-least-once delivery). Release emails are fanned out as one
`notification.send` per recipient, so a single failed send only requeues that
recipient instead of re-emailing the whole subscriber list.

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

## gRPC: Repo Verification (in-process call → gRPC migration)

The repo-existence check the subscription flow runs — `SubscriptionService`
(via the `subscription` module) calling into the `github` module's GitHub
repo lookup — is available over **two interchangeable transports**, selected
by the `REPO_CHECKER` env var. The two modules previously talked to each other
via a plain in-process function call (no network, no serialization); gRPC is
added alongside as a real network hop between the same two modules, without
removing the original call path.

| | In-process call (previous) | gRPC (new) |
|---|---|---|
| Transport | none — direct function call | HTTP/2 + Protobuf |
| Contract | implicit (`RepositoryChecker.ensureExists` TS interface) | explicit `.proto` (`proto/repo_verification/v1/repo_verification.proto`) |
| Adapter | `createGitHubRepositoryChecker` (calls `checkRepoExists` in-process) | `createGrpcRepositoryChecker` (gRPC client → `RepoVerificationService`) |
| Errors | thrown `AppError` (404 / 429 / ...) | gRPC status codes (see below) |
| Select | `REPO_CHECKER=rest` (default) | `REPO_CHECKER=grpc` |

Both adapters implement the same `RepositoryChecker` port, so the
`SubscriptionService` is unchanged regardless of transport. Under gRPC, the new
`RepoVerificationService` server (port `REPO_VERIFICATION_GRPC_PORT`, default
`50052`) wraps the *same* `checkRepoExists` call (which itself makes the actual
outbound REST call to api.github.com, unchanged on both paths) — so that logic
remains the single source of truth and is never duplicated.

**Contract** — one unary RPC:

```proto
service RepoVerificationService {
  rpc VerifyRepo(VerifyRepoRequest) returns (VerifyRepoResponse);
}
message VerifyRepoRequest  { string repo = 1; } // "owner/name"
message VerifyRepoResponse { bool   exists = 1; }
```

**buf** — `buf.yaml` (lint: STANDARD) + `buf.gen.yaml` (ts-proto, `@grpc/grpc-js`
output) drive codegen into `src/gen`:

```bash
npm run proto:lint       # buf lint
npm run proto:generate   # buf generate --path proto/repo_verification
```

**Error handling — gRPC status codes** (mapped both ways so behaviour is identical):

| Condition | AppError status (in-process) | gRPC status |
|---|---|---|
| repo exists | (no error) | `OK` |
| repo not found | 404 | `NOT_FOUND` (5) |
| empty/invalid repo | 400 | `INVALID_ARGUMENT` (3) |
| GitHub rate limit | 429 | `RESOURCE_EXHAUSTED` (8) |
| upstream unreachable | 5xx | `UNAVAILABLE` (14) |

### Throughput comparison ⭐

Both paths calling the same mock GitHub backend, 50 concurrent workers, 3s,
local (Node 22, M-series):

| Implementation | req/s |
|---|---|
| In-process call (direct call → backend) | ~16,500 |
| gRPC `VerifyRepo` | ~12,800 |

**Why the in-process call is faster here:** this app is a modular monolith. The
in-process path makes one direct function call straight to the backend call. The
gRPC path adds a *hop* — client → in-process gRPC server → the same direct call
— plus protobuf encode/decode over a loopback socket. So gRPC measures as pure
overhead in this topology, which is expected: there was never a network hop
here to begin with, so gRPC can only add cost, not remove it.

gRPC pays off when it replaces a *genuine cross-process call*: HTTP/2
multiplexes many calls over one connection, protobuf is smaller/faster to parse
than JSON, and the schema is enforced at compile time. Here the two modules
live in the same process, so there is no pre-existing network hop to amortise
those wins against — the result is the expected one, and it cleanly illustrates
*when* gRPC is worth it (replacing a real cross-process REST call, not an
in-process function call). Standard tooling for the measurement: `ghz` (gRPC)
and `autocannon` (in-process/HTTP baseline).
