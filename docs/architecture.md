# Architecture — GitHub Release Notifier

This document is the visual, up-to-date architecture reference. It supersedes the ASCII
diagrams in [`sdd.md`](./sdd.md) and covers the orchestrated **Saga**, the **transactional
outbox**, and the **gRPC repo-verification transport**.

The service is a **modular monolith** in a single Node.js process: an Express REST API, a
main business gRPC server, a RepoVerification gRPC server, a background release scanner,
and a notification consumer. Modules are decoupled by **domain events** over a RabbitMQ
topic exchange and wired by **manual constructor injection** at one composition root
(`src/index.ts`).

---

## 1. System context

External actors around the process.

```mermaid
flowchart LR
  subscriber(["Subscriber<br/>(browser / email client)"])
  github[("GitHub REST API")]
  smtp[("SMTP server")]

  subgraph proc["GitHub Release Notifier — single Node.js process"]
    rest["REST API :3000"]
    grpc["gRPC API :50051"]
    scanner["Release scanner<br/>(interval)"]
    notif["Notification consumer"]
  end

  subscriber -->|"POST /api/subscribe<br/>GET /api/confirm, /unsubscribe"| rest
  subscriber -.->|"gRPC (optional client)"| grpc
  scanner -->|"GET /repos/:o/:r/releases/latest"| github
  rest -->|"GET /repos/:o/:r (verify)"| github
  notif -->|"send confirmation / release email"| smtp
  smtp -.->|"delivers mail"| subscriber
```

---

## 2. Container / component view

Transports drive application services, which depend only on **ports**; concrete adapters
bind those ports to infrastructure. The repo checker is swappable between an in-process
REST adapter and a gRPC adapter via the `REPO_CHECKER` env var.

```mermaid
flowchart TB
  subgraph transports["Transports (src/interfaces, routes)"]
    express["Express REST router<br/>/api/*, /metrics, /"]
    grpcMain["Main gRPC server :50051<br/>Subscribe / Confirm / Unsubscribe / GetSubscriptions"]
    grpcVerify["RepoVerification gRPC server :50052<br/>VerifyRepo"]
  end

  subgraph app["Application services (src/modules)"]
    subSvc["SubscriptionService"]
    scanSvc["ReleaseScanService (scanner)"]
    ghSvc["GitHub service<br/>checkRepoExists / getLatestRelease"]
    handlers["Notification handlers"]
  end

  subgraph saga["Saga layer (src/infra/saga, src/modules/sagas)"]
    orch["Saga Orchestrator"]
    registry["Saga registry<br/>CREATE_SUBSCRIPTION"]
    replier["Saga replier"]
    outboxPub["Outbox publisher (1s poll)"]
  end

  subgraph ports["Ports & adapters"]
    checker["RepositoryChecker port<br/>→ REST | gRPC adapter"]
    registrar["RepositoryRegistrar port"]
    fetcher["ReleaseFetcher port"]
    mailer["Mailer port → Nodemailer"]
    directory["SubscriberDirectory port"]
    bus["EventBus port → RabbitMQ bus"]
  end

  subgraph infra["Infrastructure"]
    pg[("PostgreSQL<br/>subscriptions, repositories,<br/>sagas, saga_steps, outbox")]
    redis[("Redis cache (optional)")]
    mq[["RabbitMQ<br/>exchange domain.events"]]
    smtp[("SMTP")]
    gh[("GitHub REST API")]
  end

  express --> subSvc
  express --> orch
  grpcMain --> subSvc
  grpcVerify --> ghSvc

  subSvc --> checker
  subSvc --> registrar
  subSvc --> bus
  scanSvc --> fetcher
  scanSvc --> bus
  handlers --> mailer
  handlers --> directory
  handlers --> bus
  handlers --> replier

  registry --> orch
  replier --> orch
  orch --> pg
  orch -->|"writes command"| pg
  outboxPub -->|"poll outbox"| pg
  outboxPub -->|"publish"| bus

  checker -->|"gRPC path"| grpcVerify
  checker -->|"REST path"| gh
  ghSvc --> gh
  ghSvc --> redis
  fetcher --> gh
  registrar --> pg
  directory --> pg
  subSvc --> pg
  mailer --> smtp
  bus --> mq
```

---

## 3. Bounded contexts & anti-corruption layer

Four contexts. GitHub sits behind an **ACL**: each consumer owns the port it needs and
GitHub adapters translate the API payload into domain terms. Notifications is downstream,
integrating via a **Published Language** (domain events) plus a `SubscriberDirectory`
read port. Mirrors [`adr/0001-bounded-contexts-and-acl.md`](./adr/0001-bounded-contexts-and-acl.md).

```mermaid
flowchart LR
  subgraph subs["Subscriptions (core)"]
    s1["Subscription aggregate<br/>command service + read model"]
  end
  subgraph repo["Repository Tracking (core)"]
    r1["TrackedRepository aggregate<br/>release-scan service"]
  end
  subgraph gh["GitHub (supporting / ACL, upstream)"]
    g1["RepositoryChecker adapter<br/>ReleaseFetcher adapter"]
  end
  subgraph notif["Notifications (downstream)"]
    n1["event-driven email policy"]
  end

  s1 -->|"ensureExists (RepositoryChecker port)"| g1
  r1 -->|"fetchLatestTag (ReleaseFetcher port)"| g1
  s1 -.->|"domain events<br/>(Published Language, RabbitMQ)"| n1
  r1 -.->|"domain events<br/>(Published Language, RabbitMQ)"| n1
  n1 -->|"SubscriberDirectory read port"| s1
```

---

## 4. Ports & adapters (hexagonal)

Application services depend on port interfaces; the compiler enforces the dependency
direction. Swapping a provider is a composition-root change plus a new adapter.

```mermaid
flowchart TB
  subgraph left["Driving adapters (inbound)"]
    rest["Express router"]
    grpcMain["Main gRPC server"]
  end

  subgraph core["Application core"]
    subSvc(["SubscriptionService"])
    scanSvc(["ReleaseScanService"])
    handlers(["Notification handlers"])
  end

  subgraph right["Driven adapters (outbound)"]
    restChecker["GitHubRepositoryChecker (REST)"]
    grpcChecker["GrpcRepositoryChecker (gRPC)"]
    regAdapter["RepositoryRegistrar adapter"]
    fetchAdapter["GitHubReleaseFetcher"]
    mailAdapter["Nodemailer mailer"]
    dirAdapter["SubscriberDirectory adapter"]
    busAdapter["RabbitMQ EventBus"]
  end

  rest --> subSvc
  grpcMain --> subSvc

  subSvc -->|"RepositoryChecker port"| restChecker
  subSvc -->|"RepositoryChecker port"| grpcChecker
  subSvc -->|"RepositoryRegistrar port"| regAdapter
  subSvc -->|"EventBus port"| busAdapter
  scanSvc -->|"ReleaseFetcher port"| fetchAdapter
  scanSvc -->|"EventBus port"| busAdapter
  handlers -->|"Mailer port"| mailAdapter
  handlers -->|"SubscriberDirectory port"| dirAdapter
  handlers -->|"EventBus port"| busAdapter
```

`REPO_CHECKER=grpc` injects `GrpcRepositoryChecker` (dials `localhost:50052`); the default
`rest` injects `GitHubRepositoryChecker` (in-process axios). The gRPC server itself wraps
the same REST `checkRepoExists`, so REST stays the single source of truth.

---

## 5. Create-subscription saga (end-to-end)

`CREATE_SUBSCRIPTION` has three steps: `reserve` (LOCAL) → `sendEmail` (ACTION, via
outbox) → `waitConfirmation` (WAIT, resumed by the confirmation HTTP request). Saga and
step state persist in Postgres, so a crash resumes from `recoverPendingSagas` on startup.

```mermaid
sequenceDiagram
  autonumber
  actor Client
  participant REST as Express /api
  participant Orch as Saga Orchestrator
  participant Svc as SubscriptionService
  participant DB as Postgres
  participant OutPub as Outbox publisher
  participant MQ as RabbitMQ domain.events
  participant Notif as Notification handler
  participant SMTP

  Client->>REST: POST /api/subscribe {email, repo}
  REST->>Orch: start(CREATE_SUBSCRIPTION, {email, repo})
  Orch->>DB: INSERT sagas row
  Note over Orch,Svc: Step 0 reserve (LOCAL)
  Orch->>Svc: reserve(email, repo)
  Svc->>Svc: ensureExists (REST/gRPC checker)
  Svc->>DB: save subscription + ensureTracked repo
  Svc-->>Orch: {subscriptionId, confirmToken, created}
  Note over Orch,DB: Step 1 sendEmail (ACTION)
  Orch->>DB: INSERT outbox (saga.email.send_confirmation)
  REST-->>Client: 200 {message, sagaId}

  OutPub->>DB: poll outbox (PENDING)
  OutPub->>MQ: publish saga.email.send_confirmation
  MQ->>Notif: onSagaEmailSendConfirmation
  Notif->>SMTP: send confirmation email
  Notif->>MQ: publish email.confirmation.sent
  MQ->>Orch: saga-replier → completeStep(sendEmail)
  Note over Orch: Step 2 waitConfirmation (WAIT) — paused

  Client->>REST: GET /api/confirm/:token?sagaId=...
  REST->>Svc: confirm(token)
  Svc->>DB: UPDATE subscriptions SET confirmed=true
  REST->>Orch: completeStep(waitConfirmation)
  Orch->>DB: saga status = COMPLETED
  REST-->>Client: 200 confirmed
```

**Compensation.** Any step throw (or `email.confirmation.failed` → `failStep`) drives the
orchestrator into `COMPENSATING`: completed steps run their `compensate` in reverse. For
`reserve`/`waitConfirmation` this calls `service.cancel(subscriptionId)` **only** when the
saga actually created the row (`created === true`) — a pre-existing pending subscription is
left intact.

---

## 6. Messaging / event routing

One durable topic exchange `domain.events`; the notification module owns the single
`notification` queue and dispatches by routing key. Saga commands are published through the
**outbox** (write to DB in the same transaction as state, publish asynchronously) rather
than directly, so a command is never lost if the broker is briefly down.

```mermaid
flowchart LR
  subSvc["SubscriptionService"] -->|subscription.created| ex
  scanSvc["ReleaseScanService"] -->|release.published| ex
  outbox[("outbox table")] --> outPub["Outbox publisher"]
  outPub -->|saga.email.send_confirmation| ex

  ex[["exchange domain.events (topic)"]] --> q[["queue notification"]]
  q --> dispatch{"consumer dispatch"}

  dispatch -->|subscription.created| h1["onSubscriptionCreated → send confirmation"]
  dispatch -->|release.published| h2["onReleasePublished → fan-out"]
  h2 -->|notification.send per subscriber| ex
  dispatch -->|notification.send| h3["onNotificationSend → send release email"]
  dispatch -->|saga.email.send_confirmation| h4["send mail, then publish result"]
  h4 -->|email.confirmation.sent / .failed| ex
  dispatch -->|email.confirmation.sent| r1["saga-replier → completeStep(sendEmail)"]
  dispatch -->|email.confirmation.failed| r2["saga-replier → failStep(sendEmail)"]
```

Routing keys (`src/shared/events.ts`): `subscription.created`, `release.published`,
`notification.send`, `saga.email.send_confirmation`, `email.confirmation.sent`,
`email.confirmation.failed`. Delivery is at-least-once — the consumer acks on success,
nacks + requeues on handler failure.

---

## 7. Startup & shutdown

Startup is ordered so the broker connects before any publisher runs and the servers only
accept traffic after migrations and pending-saga recovery complete (`src/index.ts`).

```mermaid
sequenceDiagram
  autonumber
  participant Main as main()
  Main->>Postgres: run migrations (up)
  Main->>RabbitMQ: connectBus()
  Main->>gRPC50052: start RepoVerification server
  Main->>Main: select repo checker (REST | gRPC)
  Main->>Saga: registerDefinition + recoverPendingSagas
  Main->>RabbitMQ: start notification consumer
  Main->>Outbox: start outbox publisher (1s)
  Main->>HTTP: listen :3000
  Main->>Scanner: start interval (SCAN_INTERVAL_MS)
  Main->>gRPC50051: start main gRPC server

  Note over Main: SIGTERM / SIGINT
  Main->>Scanner: clearInterval (scanner + outbox)
  Main->>gRPC50051: forceShutdown (both gRPC servers)
  Main->>HTTP: close (drain in-flight)
  Main->>RabbitMQ: bus.close()
  Main->>Postgres: pool.end()
  Main->>Redis: quit (if connected)
```

---

## Source map

| Concern | Files |
|---|---|
| Composition root | `src/index.ts` |
| REST transport | `src/app.ts`, `src/modules/subscription/routes/index.ts` |
| gRPC transports | `src/interfaces/grpc.ts`, `src/interfaces/repo-verification.server.ts` |
| Subscription service | `src/modules/subscription/subscription.service.ts` |
| Saga | `src/infra/saga/orchestrator.ts`, `src/modules/sagas/create-subscription-saga.ts`, `src/modules/sagas/registry.ts`, `src/modules/sagas/saga-replier.ts` |
| Outbox | `src/infra/saga/outbox.repository.ts`, `src/infra/messaging/outbox-publisher.ts` |
| Messaging | `src/shared/events.ts`, `src/infra/messaging/rabbitmq-bus.ts`, `src/modules/notification/consumer.ts`, `src/modules/notification/handlers.ts` |
| Ports & adapters | `src/modules/*/ports/*`, `src/modules/github/*`, `src/modules/notification/nodemailer.mailer.ts` |
