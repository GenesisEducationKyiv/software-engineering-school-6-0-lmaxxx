# 1. Bounded contexts, ports, and the GitHub anti-corruption layer

- Status: Accepted
- Date: 2026-06-15

## Context

The service began as a modular monolith with an anemic model. Week 1 introduced
a tactical domain model (value objects + the `Subscription` and
`TrackedRepository` aggregates). The modules, however, were still wired by
direct cross-module imports and a static broker singleton:

- `subscription.service` imported `checkRepoExists` from the GitHub module.
- `repository/scanner` imported `getLatestRelease` from the GitHub module.
- `notification/handlers` imported `getConfirmedSubscribers` from the
  subscription module.
- Services published via the `getBus()` singleton rather than an injected
  dependency.

These couplings let one context's implementation leak into another and made the
dependency direction implicit. We want explicit bounded contexts with a clear
context map.

## Decision

### Bounded contexts

| Context | Role | Owns |
|---|---|---|
| **Subscriptions** | core | `Subscription` aggregate, subscription command service, subscriber read model |
| **Repository Tracking** | core | `TrackedRepository` aggregate, release-scan service |
| **GitHub** | supporting / generic (upstream) | adapters translating the GitHub API into domain terms |
| **Notifications** | supporting (downstream) | event-driven email policy |

### Context map

```
        ensureExists / fetchLatestTag (ports)
Subscriptions ───────────────►┐
                              ├──► GitHub  (Customer/Supplier + ACL)
Repository Tracking ─────────►┘

Subscriptions / Repository Tracking ──(Published Language: domain events
                                        over RabbitMQ)──► Notifications

Notifications ──(SubscriberDirectory port)──► Subscriptions
```

- **GitHub is behind an Anti-Corruption Layer.** Each consuming context owns the
  port it needs — `RepositoryChecker` (Subscriptions) and `ReleaseFetcher`
  (Repository Tracking). The GitHub context provides adapter classes
  (`GitHubRepositoryChecker`, `GitHubReleaseFetcher`) that implement those ports
  and translate the GitHub API payload (`tag_name`, axios errors) into domain
  types. The GitHub DTO never crosses the boundary.
- **Notifications is downstream.** It receives integration events as a
  **Published Language** (`src/shared/events.ts`) and looks up recipients through
  a `SubscriberDirectory` port and sends mail through a `Mailer` port — it does
  not import subscription internals or the SMTP infrastructure directly.
- **Publishing port.** The existing `EventBus` interface is reused as the output
  port; services receive it by injection instead of reaching the singleton.

### Integration style: shared database

All contexts share one Postgres instance. Cross-context reads that are pure
queries (`findConfirmedByEmail`, `findReposWithConfirmedSubscriptions`) remain as
explicitly labeled **read models** rather than being routed through ports. This
is a pragmatic choice for a single-deployable modular monolith; if a context is
ever extracted, these become the seams to replace.

### Dependency injection

Wiring is done with **manual constructor injection at a single composition root**
(`src/index.ts`). No DI container: the dependency graph is small, and explicit
wiring keeps the dependency direction visible and keeps framework annotations out
of domain/application code.

## Consequences

- Application code depends on **port interfaces**, never on another context's
  concrete implementation; the compiler enforces the dependency direction.
- Swapping GitHub for another source, or the broker/mailer, is a composition-root
  change plus a new adapter — no change to domain or application services.
- Tests inject fakes implementing the ports instead of mocking modules.
- The shared database remains a coupling point, accepted and documented here; a
  future step (transactional outbox, per-context schemas) can address it.
- Full repository interfaces / hexagonal layering are intentionally deferred to a
  later step; this ADR covers cross-context boundaries only.
