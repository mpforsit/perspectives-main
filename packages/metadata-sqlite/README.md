# @perspectives/metadata-sqlite

A local SQLite implementation of the engine's `MetadataStore` interface, used by the desktop app for single-user, fully-offline operation. Persists perspectives, relations, display configs, connection profiles, settings, and the audit log.

## What's in here

- [`src/store.ts`](src/store.ts) — `SqliteMetadataStore`. Construct once with a file path + a `CredentialStore`; auto-runs migrations on open; exposes the six sub-stores the engine expects.
- [`src/credentials.ts`](src/credentials.ts) — the `CredentialStore` abstraction. Connection passwords go here, **never** into SQLite. An `InMemoryCredentialStore` ships for tests; the real Electron implementation (using `safeStorage`) lands in a later prompt.
- [`src/migrations.ts`](src/migrations.ts) — a small numbered-file migration runner. Each `src/migrations/NNNN_name.sql` is applied in lex order inside a transaction; applied files are recorded in `_migrations(filename, applied_at)` so re-runs are no-ops.
- One file per sub-store: [`connections.ts`](src/connections.ts), [`perspectives.ts`](src/perspectives.ts), [`relations.ts`](src/relations.ts), [`display-configs.ts`](src/display-configs.ts), [`audit.ts`](src/audit.ts), [`settings.ts`](src/settings.ts).

## Credential separation

**Connection passwords are not written to SQLite.** The flow is:

```
connections.create(profile)
  ├─ pull `password` off the profile in memory
  ├─ credentialStore.set(id, password)        ← user's keyring / safeStorage / test in-memory
  └─ INSERT the rest into SQLite              ← row never carries the secret
```

`connections.get(id)` reverses that: SELECT the profile shell, ask the credential store for the password, glue them together. If the credential store has no entry for that id, `password` comes back as `""` — the caller is responsible for treating that as "credential missing" rather than "empty password".

There is a regression test ([`test/credentials.test.ts`](test/credentials.test.ts)) that saves a profile with a random sentinel password, closes the database, and then scans every file in the database directory (including any `-wal` / `-shm` companions) as raw bytes for the sentinel. It fails if the sentinel appears anywhere. Run it whenever you touch the connection-write path.

> **Note on scope.** This prompt only redirects the `password` field. Other secret-bearing fields (`sshTunnel.password`, `sshTunnel.privateKey`, `sshTunnel.passphrase`, `ssl.clientKey`) are still stored in SQLite for now. They'll route through `CredentialStore` when SSH/SSL connection support actually lands (Phase 4). Until then, those fields shouldn't carry real secrets.

## DSL validation

Persisted DSL objects — `PerspectiveDef`, `RelationDef`, `DisplayConfig` — are stored as JSON text. They run through their respective `validate*` helper from `@perspectives/dsl` **on both write and read**:

- **Write**: an invalid value throws `ValidationError` from the engine before any SQL runs. The validated (and unknown-field-stripped) value is what gets saved.
- **Read**: stored rows are re-validated on the way out. A corrupted / stale row throws `ValidationError` with the Zod issues attached, rather than returning a malformed object. On `list()`, the first bad row throws — loud failure is better than silent loss.

## Workspaces

Single-user / local mode has no workspaces. The store deliberately does not expose `workspaces`, `members`, or `shares` (those live on the Postgres / remote metadata stores). `ListQuery.workspaceId` is accepted but ignored.

## Migrations

```
src/migrations/
└── 0001_initial.sql
```

The runner opens the file synchronously via `fs.readFileSync` (same process boundary as better-sqlite3) and applies each pending file inside a `BEGIN; … COMMIT;` transaction. Running it twice — same DB, same files — is a no-op because every applied filename is in `_migrations`. Tests verify both initial application and idempotency.

## Running the tests

No Docker, no Postgres — everything is in-process SQLite (file or `:memory:`).

```sh
pnpm --filter metadata-sqlite test
```
