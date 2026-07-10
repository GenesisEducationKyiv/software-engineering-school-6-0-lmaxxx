# Software Design Document — GitHub Release Notifier

## 1. Overview

The GitHub Release Notifier is a Node.js service that lets users subscribe their email address to a GitHub repository. When a new release is published, all confirmed subscribers receive an email notification containing the release tag, title, and a direct link to the release page. The system is a **modular monolith** running inside a **single Node.js process**: a REST API, a background scanner, a gRPC server, and a notification module. Modules communicate asynchronously by publishing **domain events** to a **RabbitMQ** topic exchange; the notification module consumes those events and sends email.

---

## 2. High-Level Architecture

```mermaid
flowchart TB
  subgraph proc["Node.js process"]
    sub["subscription mod<br/>+ Express API"]
    scan["repository mod (scanner)<br/>every SCAN_INTERVAL_MS"]
    grpc["gRPC Server<br/>:GRPC_PORT (50051)"]
    bus["EventBus (RabbitMQ)<br/>exchange domain.events<br/>(topic, durable)"]
    notif["notification module<br/>consumes events,<br/>sends email (Nodemailer)"]
    db["DB (pg)<br/>infra/db/"]
    redis["Redis cache<br/>(optional)"]
    mailer["Nodemailer<br/>SMTP"]
  end

  pg[("PostgreSQL")]
  gh["GitHub REST API<br/>(via axios, cached)"]

  sub -- "publish subscription.created" --> bus
  scan -- "publish release.published" --> bus
  grpc --> bus
  bus -- "queue notif." --> notif

  notif --> db
  notif --> mailer
  sub --> db
  sub --> redis
  scan --> db
  scan --> redis

  db --> pg
  redis --> gh
```

Modules are decoupled through the **RabbitMQ** broker: publishers (subscription, scanner) emit domain events and never call the mailer directly; the notification module is the sole consumer. Delivery is at-least-once — the consumer acks after a successful send and nacks+requeues on failure. The scanner still runs in-process on a `setInterval`. Redis is optional; the service degrades gracefully to uncached GitHub API calls when Redis is unavailable.

---

## 3. Data Flow

### 3.1 Subscribe (POST /api/subscribe)

```mermaid
flowchart TB
  client["Client"] --> route["Express route (src/routes/subscribe.ts)<br/>validate: email format, owner/repo pattern"]
  route --> svc["SubscriptionService.createSubscription()"]

  svc --> check["GitHubService.checkRepoExists(repo)"]
  check --> redis{"Redis GET"}
  redis -- hit --> cached["return cached result"]
  redis -- miss --> ghapi["GitHub GET /repos/:owner/:repo<br/>then Redis SET (TTL 10 min)"]

  svc --> sel["DB: SELECT existing (email, repo) pair"]
  sel -- "confirmed already" --> c409["409"]
  sel -- unconfirmed --> upd["regenerate confirm_token, UPDATE row"]
  sel -- new --> ins["INSERT subscriptions row (confirmed=false)"]

  svc --> upsert["DB: UPSERT repositories row"]
  svc --> pub["publish subscription.created { email, repo, confirmToken }"]
  pub --> consume["notification module consumes → Nodemailer SMTP →<br/>confirmation link to GET /api/confirm/:token"]
  svc --> ok["200 { message: Confirmation email sent }"]
```

### 3.2 Confirm (GET /api/confirm/:token)

```mermaid
flowchart TB
  req["GET /api/confirm/:token"] --> sel["DB: SELECT subscription WHERE confirm_token = :token"]
  sel -- "not found" --> nf["404"]
  sel -- "already confirmed" --> idem["200 (idempotent)"]
  sel -- found --> upd["DB: UPDATE subscriptions SET confirmed = true"]
  upd --> ok["200 { message: Subscription confirmed }"]
```

### 3.3 Unsubscribe (GET /api/unsubscribe/:token)

```mermaid
flowchart TB
  req["GET /api/unsubscribe/:token"] --> val{"validate UUID format"}
  val -- invalid --> bad["400"]
  val -- valid --> sel["DB: SELECT subscription WHERE unsubscribe_token = :token"]
  sel -- "not found" --> nf["404"]
  sel -- found --> del["DB: DELETE subscription row"]
  del --> ok["200 { message: Unsubscribed successfully }"]
```

### 3.4 Scanner Cycle (every `SCAN_INTERVAL_MS`, default 5 min)

```mermaid
flowchart TB
  tick["setInterval fires"] --> distinct["DB: SELECT DISTINCT repo FROM subscriptions WHERE confirmed = true"]
  distinct --> loop["for each repo"]

  loop --> latest["GitHubService.getLatestRelease(repo)"]
  latest --> redis{"Redis GET"}
  redis -- hit --> tag["cached tag"]
  redis -- miss --> ghapi["GitHub GET /repos/:repo/releases/latest → Redis SET (TTL)"]
  ghapi -- "404 (no releases)" --> sentinel["cache NULL_SENTINEL, skip"]
  ghapi -- 429 --> brk["break loop, retry on next interval"]

  loop --> cmp{"tag_name == last_seen_tag ?"}
  cmp -- yes --> skip["skip"]
  cmp -- no --> upd["DB: UPDATE repositories SET last_seen_tag, last_checked_at"]
  upd --> pub["publish release.published { repo, tag }"]
  pub --> consume["notification module consumes"]
  consume --> subs["DB: SELECT confirmed subscribers for repo"]
  subs --> mail["for each subscriber: Nodemailer SMTP (includes unsubscribe link)"]

  loop --> metrics["metrics: scans_total++"]
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

---

## 6. Configuration

All configuration is loaded from environment variables in `src/config.ts`. The only required variable is `DATABASE_URL`; everything else has a default.

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | — | **yes** | PostgreSQL connection string |
| `PORT` | `3000` | no | HTTP server port |
| `GRPC_PORT` | `50051` | no | gRPC server port |
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
2. Connect to RabbitMQ and start the notification module consumer
3. Start HTTP server on `PORT`
4. Start scanner `setInterval` with period `SCAN_INTERVAL_MS`
5. Start gRPC server on `GRPC_PORT`

Steps are sequential: the broker connects before any publisher runs, and the server only accepts traffic after migrations complete.

### Graceful Shutdown (SIGTERM / SIGINT)

1. Clear scanner interval (stops future cycles; any in-progress cycle completes)
2. Arm a 10-second forced-exit timeout
3. Close HTTP server (stop accepting new connections; drain in-flight requests)
4. Close the RabbitMQ channel and connection (`bus.close()`)
5. Drain PostgreSQL connection pool (`pool.end()`)
6. Quit Redis client if connected (`redisClient.quit()`)
7. Process exits with code `0`
