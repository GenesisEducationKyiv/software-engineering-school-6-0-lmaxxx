# ADR-0001: Use Raw SQL (pg) Instead of an ORM

## Status

Accepted

## Context

The service requires persistent storage for two entities:

- **`subscriptions`** — tracks (email, repo) pairs with confirmation state and tokens
- **`repositories`** — tracks which repos are monitored and their last-seen release tag

The access patterns are simple:
- Insert / update / delete by primary key or unique constraint
- Lookup by individual columns (`email+repo`, `confirm_token`, `unsubscribe_token`)
- No complex joins, aggregations, or dynamic query building

Candidates evaluated:

| Option | Description |
|--------|-------------|
| **Raw `pg`** | Node.js PostgreSQL client; plain SQL strings, results typed manually |
| **Prisma** | Schema-first ORM with code generation; excellent type safety |
| **TypeORM** | Decorator-based ORM; mature, mirrors ActiveRecord/DataMapper |

## Decision

Use the `pg` package with raw SQL queries. All SQL lives in two thin data-access modules:
- `src/db/subscriptions.ts` — CRUD for the `subscriptions` table
- `src/db/repositories.ts` — upsert and tag-tracking for the `repositories` table

Database migrations are handled separately by `node-pg-migrate`, keeping schema evolution explicit and versioned.

## Consequences

### Positive

- **No magic.** Every query is visible and greppable. Debugging a misbehaving query means reading the query, not reverse-engineering what an ORM generated.
- **No build step.** `pg` requires no codegen or CLI setup. TypeScript compilation is enough to produce a runnable service.
- **No codegen phase.** Prisma requires `prisma generate` before every TypeScript build; the generated client must be kept in sync with the schema file. Raw `pg` has no generated artefacts to manage.
- **Minimal dependency surface.** One small client package instead of a full ORM runtime + CLI + reflection layer.
- **Full SQL control.** `ON CONFLICT DO UPDATE`, index hints, or any PostgreSQL-specific syntax are used directly without workarounds.

### Negative

- **Manual type mapping.** Query results are `Record<string, unknown>[]`; types must be asserted or validated manually. A mismatch between the TypeScript interface and the actual column type is a runtime error, not a compile-time error.
- **No auto-migrations.** Schema changes require writing migration files in `node-pg-migrate` rather than diffing a schema file. This is more explicit but also more work.
- **Repetitive boilerplate.** Simple CRUD functions (find-by-token, mark-confirmed, etc.) are more lines of code than the equivalent ORM one-liner.

## Considered Alternatives

| Option | Pros | Cons |
|--------|------|------|
| **Prisma** | End-to-end type safety (schema → generated client), excellent DX, auto-migration diffing | Requires `prisma generate` before every build; generated client adds ~15 MB to the dependency tree; schema-first model adds overhead for a 2-table project |
| **TypeORM** | Decorator-based mapping familiar to Java/C# developers; supports both ActiveRecord and DataMapper patterns | Requires `experimentalDecorators` and `emitDecoratorMetadata` tsconfig flags; larger runtime footprint; overkill for 2 tables |
| **Raw `pg`** *(chosen)* | Simple, explicit, ESM-compatible, zero build step | Manual type mapping, no auto-migrations |

For a service with two tables and a handful of queries, the explicitness of raw SQL outweighs the productivity gains an ORM would provide at larger scale.
