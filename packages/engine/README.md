# @perspectives/engine

The engine package is the **spine** of Perspectives — the layer between the UI and the database. It defines the seams that make local, self-hosted, and SaaS modes the same product, but it does not implement any of them. Concrete adapters and stores live in their own packages and are wired in by the bootstrapping layer.

## What lives here

| File | Role |
|---|---|
| [`src/adapter.ts`](src/adapter.ts) | The `DatabaseAdapter` interface and the shapes that pass through it: `SchemaSnapshot` (introspection result), `QueryPlan` / `MutationPlan` (structured queries — never raw SQL from the UI), `ResultSet`, `MutationResult`, `Cursor` (keyset pagination), `PageResult`, `ConnectionInfo`, `DialectMetadata`. References DSL types (`FilterGroup`, `SortDef`, `ColumnDef`, `JoinDef`) directly so a `PerspectiveDef` can be compiled into a `QueryPlan` without intermediate type plumbing. |
| [`src/metadata.ts`](src/metadata.ts) | The `MetadataStore` interface, the generic `CRUDStore<T>` / `AppendStore<T>` / `KVStore` building blocks, and the engine-level shapes those stores persist: `ConnectionProfile`, `Workspace`, `Membership`, `Share`. |
| [`src/audit.ts`](src/audit.ts) | The `AuditEvent` type — every write the engine performs against a target database produces exactly one. |
| [`src/errors.ts`](src/errors.ts) | The error hierarchy. `EngineError` is the base; `ConnectionError`, `PermissionDeniedError`, `ValidationError`, `NotFoundError`, and `ConflictError` (carries `expected` / `actual` snapshots for optimistic locking) are the concrete subclasses. Each carries a stable `code` so callers branch on the failure mode without string-matching messages. |
| [`src/index.ts`](src/index.ts) | Barrel re-export. |

## The rule

**No SQL is rendered here. No HTTP is opened here. No SQLite file is touched here.** Concrete adapters and stores live in sibling packages:

- `@perspectives/adapter-postgres` implements `DatabaseAdapter`. It is the only place in the whole repository that constructs SQL strings.
- `@perspectives/metadata-sqlite` / `@perspectives/metadata-postgres` / `@perspectives/metadata-remote` implement `MetadataStore` against, respectively, a local SQLite file, a server-side Postgres database, and a remote HTTP API.
- `InMemoryCredentialStore` (the test-grade `CredentialStore` implementation) lives in `@perspectives/metadata-sqlite`; the real `safeStorage`-backed one lives in `apps/desktop`.
- Future dialects (MySQL, MSSQL, …) plug in by adding new adapter packages that satisfy the same interface.

What *does* live here is [`EngineService`](src/service.ts) — orchestration: connection lifecycle, schema caching, plan compilation, error mapping. The service depends only on the engine's own interfaces and takes a `DatabaseAdapterFactory` so it never imports a concrete adapter package.

If you find yourself reaching for `pg`, `better-sqlite3`, `fetch`, or any other runtime concern inside this package, **stop** — it belongs somewhere downstream.

## How packages compose

```
@perspectives/ui
        │ tRPC
        ▼
@perspectives/engine ──────► @perspectives/dsl
        │
        ├── implements DatabaseAdapter ◄── @perspectives/adapter-postgres
        │
        └── implements MetadataStore   ◄── @perspectives/metadata-sqlite
                                       ◄── @perspectives/metadata-postgres
                                       ◄── @perspectives/metadata-remote
```

The engine takes an adapter and a metadata store at construction time. The bootstrapping layer (the Electron main process, the server entry point, a test harness) picks which concrete implementations to hand it; nothing inside this package depends on a specific one.

## Security-critical invariant: credentials never leave the device

`ConnectionProfile` (and its `ssl` / `sshTunnel` sub-objects) contain secrets. The `MetadataStore` surface exposes them through `connections: CRUDStore<ConnectionProfile>` because every store needs to read and write them *locally*, but the **remote** metadata store implementation MUST refuse to serialize this type. There is — per the plan — a test that fails if a `ConnectionProfile` ever appears in a remote-bound payload; it lives in the metadata-remote package once that exists. Phase 6 introduces a separate, encrypted, server-side type for shared connections; the local `ConnectionProfile` shape never leaves the user's machine.

## Tests

```sh
pnpm --filter @perspectives/engine test
```

The test suite is small on purpose: this package is interfaces and types, and the interesting checks are compile-time. The runtime assertions cover the error class hierarchy (subclass codes, names, `cause` propagation, optimistic-lock context); a type-only `surface(...)` function anchors every exported type so the typechecker confirms the public surface is complete.
