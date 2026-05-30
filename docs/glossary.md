# Glossary

Vocabulary used throughout the Perspectives codebase. One sentence each. For the full definitions and the JSON shapes, see [`docs/architecture.md`](./architecture.md) and [`docs/dsl.md`](./dsl.md).

- **Perspective** — A saved, named, reusable presentation of data with its own columns, sort, filters, optional joins, and (in shared mode) permissions; the canonical user-facing artifact, expressed as a typed JSON document called a `PerspectiveDef`.

- **Relation** — A typed link between two tables, used for navigation and structured joins; persisted as a `RelationDef` and surfaced in two flavours: **schema** relations are derived automatically from foreign keys during introspection, and **custom** relations are defined by the user when no FK exists.

- **Display config** — A per-table setting (`DisplayConfig`) that chooses which column(s) represent a row in foreign-key pickers, breadcrumbs, and row-label badges — e.g. `users.full_name` rather than `users.id`.

- **Workspace** — A shared-mode collaboration container that owns perspectives, relations, display configs, and members; single-user / fully-local installations have none, and the engine only enforces permissions when a workspace is in play.

- **Environment tag** — A label on a connection (`production` / `staging` / `development` / `other`) that drives a prominent colour band in the UI and an extra confirmation step on writes against `production`.

- **Engine** — The package ([`@perspectives/engine`](../packages/engine/)) sitting between the UI and the database; defines the `DatabaseAdapter` and `MetadataStore` interfaces, compiles perspectives into structured query plans, enforces permissions in shared mode, and writes the audit log.

- **Adapter** — A concrete implementation of the engine's `DatabaseAdapter` interface for a specific dialect (PostgreSQL in v1, via [`@perspectives/adapter-postgres`](../packages/adapter-postgres/)); the only code in the repository allowed to construct dialect-specific SQL strings.

- **Metadata store** — A concrete implementation of the engine's `MetadataStore` interface that persists perspectives, relations, display configs, connections, audit events, and settings; three exist — `metadata-sqlite` for the local desktop app, `metadata-postgres` for the self-hostable server, and `metadata-remote` (HTTP client) for the desktop app once linked to a workspace.
