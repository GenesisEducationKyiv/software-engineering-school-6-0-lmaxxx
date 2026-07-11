# Software Design Document — GitHub Release Notifier

## 1. Overview

The GitHub Release Notifier is a Node.js service that lets users subscribe their email address to a GitHub repository. When a new release is published, all confirmed subscribers receive an email notification containing the release tag, title, and a direct link to the release page. The system is a **modular monolith** running inside a **single Node.js process**: a REST API, a background scanner, two gRPC servers (a business API and a RepoVerification service), and a notification module. Modules communicate asynchronously by publishing **domain events** to a **RabbitMQ** topic exchange; the notification module consumes those events and sends email.

Subscription creation runs as an **orchestrated saga** with a **transactional outbox**, so the multi-step flow (reserve → send confirmation email → wait for confirmation) is durable and compensatable across a crash. Repo existence checks can run in-process over the GitHub REST API or over a **gRPC RepoVerification transport**, selectable with the `REPO_CHECKER` env var.

> **Diagrams:** the up-to-date visual architecture (Mermaid) — including the saga, outbox, and gRPC transports — lives in [`architecture.md`](./architecture.md). The ASCII diagram below is a simplified event-flow overview.

---

## 2. High-Level Architecture

```
┌──────────────────────────────── Node.js process ────────────────────────────────┐
│                                                                                   │
│  ┌──────────────────┐  ┌────────────────────────────┐  ┌───────────────────┐   │
│  │ subscription mod │  │  repository mod (scanner)   │  │  gRPC Server      │   │
│  │ + Express API     │  │  every SCAN_INTERVAL_MS     │  │  :GRPC_PORT(50051)│   │
│  └────────┬──────────┘  └──────────────┬─────────────┘  └────────┬──────────┘   │
│           │ publish                     │ publish                  │              │
│           │ subscription.created        │ release.published        │              │
│           └─────────────┬───────────────┴──────────────────────────┘             │
│                         ▼                                                         │
│              ┌────────────────────────┐        ┌──────────────────────────┐      │
│              │  EventBus (RabbitMQ)     │ ─────► │  notification module      │      │
│              │  exchange domain.events  │ queue  │  consumes events,         │      │
│              │  (topic, durable)        │ notif. │  sends email (Nodemailer) │      │
│              └────────────────────────┘        └──────────────────────────┘      │
│                                     │                                             │
│                  ┌──────────────────┼──────────────────┐                        │
│                  ▼                  ▼                   ▼                        │
│           ┌────────────┐   ┌──────────────┐   ┌──────────────┐                 │
│           │  DB (pg)   │   │  Redis cache │   │  Nodemailer  │                 │
│           │  infra/db/ │   │  (optional)  │   │  SMTP        │                 │
│           └─────┬──────┘   └──────┬───────┘   └──────────────┘                 │
└─────────────────┼─────────────────┼───────────────────────────────────────────── ┘
                  ▼                 ▼
            PostgreSQL         GitHub REST API
                             (via axios, cached)
```

Modules are decoupled through the **RabbitMQ** broker: publishers (subscription, scanner) emit domain events and never call the mailer directly; the notification module is the sole consumer. Delivery is at-least-once — the consumer acks after a successful send and nacks+requeues on failure. The scanner still runs in-process on a `setInterval`. Redis is optional; the service degrades gracefully to uncached GitHub API calls when Redis is unavailable.

---

## 3. Data Flow

### 3.1 Subscribe (POST /api/subscribe) — orchestrated saga

`POST /api/subscribe` starts the `CREATE_SUBSCRIPTION` saga. Saga and step state persist in
Postgres and the confirmation command is dispatched through the transactional outbox, so
the flow survives a crash (resumed by `recoverPendingSagas` on startup).

```
Client
  │  POST /api/subscribe { email, repo }
  ▼
Express route → validate → orchestrator.start(CREATE_SUBSCRIPTION, { email, repo })
  │
  ├─ Step reserve (LOCAL) → SubscriptionService.reserve()
  │     ├─► RepositoryChecker.ensureExists(repo)   (REST or gRPC RepoVerification)
  │     ├─► DB: save subscription (INSERT/UPDATE, confirmed=false)
  │     └─► DB: ensureTracked repo (UPSERT repositories)
  │
  ├─ Step sendEmail (ACTION) → INSERT outbox row (saga.email.send_confirmation)
  │     │   (route returns 200 { message, sagaId } here)
  │     ▼
  │   Outbox publisher (1s poll) → RabbitMQ → notification handler
  │     ├─► Nodemailer SMTP: confirmation link GET /api/confirm/:token?sagaId=…
  │     └─► publish email.confirmation.sent → saga-replier → completeStep(sendEmail)
  │
  └─ Step waitConfirmation (WAIT, 24h) — paused until:
        GET /api/confirm/:token?sagaId=… → confirm subscription
          → completeStep(waitConfirmation) → saga COMPLETED
```

**Compensation:** a step failure (or `email.confirmation.failed`) drives the saga into
`COMPENSATING`; completed steps compensate in reverse. `reserve`/`waitConfirmation` call
`SubscriptionService.cancel(subscriptionId)` only when the saga created the row
(`created === true`), leaving a pre-existing pending subscription intact.

> The non-saga `SubscriptionService.subscribe()` path (direct `subscription.created` event)
> still exists and is used by the gRPC business API; see [`architecture.md`](./architecture.md) §5.

### 3.2 Confirm (GET /api/confirm/:token)

```
GET /api/confirm/:token
  │
  ▼
DB: SELECT subscription WHERE confirm_token = :token
  │  not found → 404
  │  already confirmed → 200 (idempotent)
  ▼
DB: UPDATE subscriptions SET confirmed = true
  │
200 { message: "Subscription confirmed" }
```

### 3.3 Unsubscribe (GET /api/unsubscribe/:token)

```
GET /api/unsubscribe/:token
  │  validate UUID format → 400 if invalid
  ▼
DB: SELECT subscription WHERE unsubscribe_token = :token → 404 if not found
  ▼
DB: DELETE subscription row
  │
200 { message: "Unsubscribed successfully" }
```

### 3.4 Scanner Cycle (every `SCAN_INTERVAL_MS`, default 5 min)

```
setInterval fires
  │
  ▼
DB: SELECT DISTINCT repo FROM subscriptions WHERE confirmed = true
  │
  └─► for each repo:
        │
        ├─► GitHubService.getLatestRelease(repo)
        │       └─► Redis GET → hit: cached tag
        │                   → miss: GitHub GET /repos/:repo/releases/latest
        │                             └─► Redis SET (TTL)
        │                             └─► 404 (no releases): cache NULL_SENTINEL, skip
        │                             └─► 429: break loop, retry on next interval
        │
        ├─► if tag_name == last_seen_tag → skip
        │
        ├─► DB: UPDATE repositories SET last_seen_tag, last_checked_at
        │
        └─► publish `release.published` { repo, tag }
              └─► notification module consumes:
                    ├─► DB: SELECT confirmed subscribers for repo
                    └─► for each subscriber:
                          └─► Nodemailer SMTP (includes unsubscribe link)
  │
  ▼
metrics: scans_total++
```

---

## 4. External Integrations

| Integration | Library | Key env vars | Caching | Error handling |
|-------------|---------|-------------|---------|----------------|
| **GitHub REST API** | `axios` | `GITHUB_TOKEN` | Redis, 10 min TTL (`REDIS_TTL_SECONDS`) | 404 → cached as null sentinel; 429 → return `AppError(429)` to caller; scanner breaks loop |
| **SMTP (email)** | `nodemailer` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | — | Throws on transport error; propagates to caller |
| **Redis** | `ioredis` | `REDIS_URL`, `REDIS_TTL_SECONDS` | — | Connection errors caught at startup; cache layer returns `null`, app continues uncached |
| **PostgreSQL** | `pg` (pool) | `DATABASE_URL` | — | Pool errors propagate as unhandled rejections; pool drained on shutdown |
| **RabbitMQ** | `amqplib` | `RABBITMQ_URL` | — | Topic exchange `domain.events`; consumer acks on success, nacks+requeues on handler failure (at-least-once); connection closed on shutdown |
| **RepoVerification gRPC** | `@grpc/grpc-js` | `REPO_CHECKER`, `REPO_VERIFICATION_GRPC_PORT` | — | Thin gRPC front (`:50052`) over the REST GitHub checker; used only when `REPO_CHECKER=grpc`. HTTP status ↔ gRPC status mapping preserved both ways |

---

## 5. API Reference

### REST Endpoints

| Method | Path | Purpose | Success response |
|--------|------|---------|-----------------|
| `GET` | `/` | Serve subscription web UI | `200 text/html` |
| `POST` | `/api/subscribe` | Create unconfirmed subscription | `200 { message }` |
| `GET` | `/api/confirm/:token` | Confirm a subscription | `200 { message }` |
| `GET` | `/api/unsubscribe/:token` | Delete a subscription | `200 { message }` |
| `GET` | `/api/subscriptions?email=` | List confirmed subscriptions for an email | `200 [{ email, repo, confirmed, last_seen_tag }]` |
| `GET` | `/metrics` | Prometheus metrics | `200 text/plain` |

Interactive docs are available via Swagger UI at `http://localhost:8080` when running with `docker-compose`.

### gRPC Service (`github_notifier.proto`)

| RPC | Request | Response |
|-----|---------|---------|
| `Subscribe` | `SubscribeRequest { email, repo }` | `MessageResponse { message }` |
| `ConfirmSubscription` | `TokenRequest { token }` | `MessageResponse { message }` |
| `Unsubscribe` | `TokenRequest { token }` | `MessageResponse { message }` |
| `GetSubscriptions` | `GetSubscriptionsRequest { email }` | `GetSubscriptionsResponse { subscriptions[] }` |

See `proto/github_notifier.proto` for the full message definitions.

### gRPC Service (`repo_verification/v1/repo_verification.proto`)

Internal transport for repo-existence checks, used when `REPO_CHECKER=grpc`. Runs on
`REPO_VERIFICATION_GRPC_PORT` (default `50052`) and delegates to the same REST
`checkRepoExists`, so REST remains the single source of truth.

| RPC | Request | Response |
|-----|---------|---------|
| `VerifyRepo` | `VerifyRepoRequest { repo }` | `VerifyRepoResponse { exists }` |

---

## 6. Configuration

All configuration is loaded from environment variables in `src/config.ts`. The only required variable is `DATABASE_URL`; everything else has a default.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | — | **yes** | PostgreSQL connection string |
| `PORT` | `3000` | no | HTTP server port |
| `GRPC_PORT` | `50051` | no | Main business gRPC server port |
| `REPO_CHECKER` | `rest` | no | Repo-verification transport: `rest` (in-process axios) or `grpc` (RepoVerification service) |
| `REPO_VERIFICATION_GRPC_PORT` | `50052` | no | RepoVerification gRPC server port |
| `NODE_ENV` | `development` | no | Runtime environment label |
| `GITHUB_TOKEN` | `null` | no | GitHub personal access token (raises rate limit from 60 to 5000 req/hr) |
| `REDIS_URL` | `null` | no | Redis connection URL; caching is disabled when absent |
| `REDIS_TTL_SECONDS` | `600` | no | GitHub API cache TTL in seconds |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5672` | no | RabbitMQ broker connection URL |
| `SMTP_HOST` | `smtp.gmail.com` | no | SMTP server hostname |
| `SMTP_PORT` | `587` | no | SMTP server port |
| `SMTP_USER` | `""` | no | SMTP username |
| `SMTP_PASS` | `""` | no | SMTP password |
| `SMTP_FROM` | `noreply@github-notifier.local` | no | Sender address on outgoing emails |
| `SCAN_INTERVAL_MS` | `300000` | no | Scanner polling interval in milliseconds (default 5 min) |
| `BASE_URL` | `http://localhost:3000` | no | Public base URL used in confirmation and unsubscribe links |

---

## 7. Observability

Metrics are collected by `src/middleware/metricsMiddleware.ts` and the service layer, then exposed at `GET /metrics` in Prometheus text format.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `http_requests_total` | Counter | `method`, `route`, `status_code` | Total HTTP requests completed |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status_code` | Request latency; buckets: 0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5 s |
| `scans_total` | Counter | — | Scanner cycles completed |
| `emails_sent_total` | Counter | `type` (`confirmation`, `release`) | Emails dispatched |
| `github_api_calls_total` | Counter | `endpoint` (`checkRepoExists`, `getLatestRelease`) | GitHub API calls made |

Unmatched routes are normalized to the label value `unknown` to prevent high-cardinality label explosion.

---

## 8. Startup & Shutdown Sequence

### Startup (`src/index.ts`)

1. Run pending database migrations (node-pg-migrate, direction: up)
2. Connect to RabbitMQ (`connectBus`)
3. Start the RepoVerification gRPC server on `REPO_VERIFICATION_GRPC_PORT`
4. Select the repo checker transport (`REPO_CHECKER`: `rest` or `grpc`)
5. Register saga definitions and recover pending sagas (`recoverPendingSagas`)
6. Start the notification module consumer
7. Start the outbox publisher (1s poll interval)
8. Start HTTP server on `PORT`
9. Start scanner `setInterval` with period `SCAN_INTERVAL_MS`
10. Start the main business gRPC server on `GRPC_PORT`

Steps are sequential: the broker connects before any publisher runs, pending sagas are recovered before traffic is accepted, and the servers only accept traffic after migrations complete.

### Graceful Shutdown (SIGTERM / SIGINT)

1. Clear scanner and outbox-publisher intervals (stops future cycles; any in-progress cycle completes)
2. Force-shutdown both gRPC servers (main + RepoVerification)
3. Arm a 10-second forced-exit timeout
4. Close HTTP server (stop accepting new connections; drain in-flight requests)
5. Close the RabbitMQ channel and connection (`bus.close()`)
6. Drain PostgreSQL connection pool (`pool.end()`)
7. Quit Redis client if connected (`redisClient.quit()`)
8. Process exits with code `0`
